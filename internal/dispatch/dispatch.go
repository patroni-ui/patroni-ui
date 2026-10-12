// Package dispatch turns generic REST requests from the Web UI into calls on
// the go-patroni client, covering every endpoint in patroni.EndpointCatalog().
package dispatch

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	patroni "github.com/pgsty/go-patroni"
)

// Request is a single Patroni REST call as issued by the Web UI.
type Request struct {
	BaseURL  string            `json:"base_url"`
	Username string            `json:"username"`
	Password string            `json:"password"`
	Insecure bool              `json:"insecure"`
	CA       string            `json:"ca"`
	Method   string            `json:"method"`
	Path     string            `json:"path"`
	Query    map[string]string `json:"query"`
	Body     json.RawMessage   `json:"body"`
	Timeout  int               `json:"timeout"` // seconds, 0 uses SDK default
}

// Result is a normalized response suitable for the Web UI.
type Result struct {
	StatusCode int               `json:"status_code"`
	Headers    map[string]string `json:"headers"`
	Data       any               `json:"data"`
	Raw        string            `json:"raw"`
	DurationMs int64             `json:"duration_ms"`
	Error      string            `json:"error,omitempty"`
}

// Config holds the Patroni connection settings configured on the backend.
type Config struct {
	Hosts    []string
	Username string
	Password string
	Insecure bool
	CA       string
}

// Execute validates the request, builds a patroni.Client and dispatches the
// call to the matching typed method. Read requests fail over across the
// configured hosts when one is unreachable.
func Execute(ctx context.Context, req Request, cfg Config) Result {
	start := time.Now()
	req.Username = cfg.Username
	req.Password = cfg.Password
	req.Insecure = cfg.Insecure
	req.CA = cfg.CA
	if req.Method == "" {
		return failure(http.StatusBadRequest, "method is required", start)
	}
	if req.Path == "" {
		req.Path = "/"
	}

	client, err := buildClient(req)
	if err != nil {
		return failure(http.StatusBadRequest, err.Error(), start)
	}

	var hosts []string
	if req.BaseURL != "" {
		hosts = []string{req.BaseURL}
	} else {
		if len(cfg.Hosts) == 0 {
			return failure(http.StatusBadRequest, "no Patroni host configured", start)
		}
		hosts = cfg.Hosts
	}

	// Read requests try each host until one responds.
	if isReadMethod(strings.ToUpper(req.Method)) {
		var last Result
		for _, host := range hosts {
			req.BaseURL = host
			last = dispatchRequest(ctx, client, req, start)
			if !hostUnreachable(last) {
				return last
			}
		}
		return last
	}

	req.BaseURL = hosts[0]
	return dispatchRequest(ctx, client, req, start)
}

func isReadMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

func hostUnreachable(result Result) bool {
	return result.StatusCode == 0 && result.Error != ""
}

// dispatchRequest routes a single resolved request to the matching typed
// client method.
func dispatchRequest(ctx context.Context, client *patroni.Client, req Request, start time.Time) Result {
	method := strings.ToUpper(req.Method)
	path := req.Path

	// Health aliases (GET/HEAD/OPTIONS across the well-known paths).
	if isHealthAlias(path) {
		return dispatchHealth(ctx, client, method, path, req, start)
	}

	switch method + " " + path {
	case http.MethodGet + " /liveness":
		resp, err := client.GetLiveness(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /readiness":
		resp, err := client.GetReadiness(ctx, req.BaseURL, readinessQuery(req.Query))
		return toResult(resp, err, start)
	case http.MethodGet + " /patroni":
		resp, err := client.GetPatroni(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /cluster":
		resp, err := client.GetCluster(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /history":
		resp, err := client.GetHistory(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /config":
		resp, err := client.GetConfig(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /metrics":
		resp, err := client.GetMetrics(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodGet + " /failsafe":
		resp, err := client.GetFailsafe(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodPatch + " /config":
		cfg, err := decodeDynamicConfig(req.Body)
		if err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PatchConfig(ctx, req.BaseURL, cfg)
		return toResult(resp, err, start)
	case http.MethodPut + " /config":
		cfg, err := decodeDynamicConfig(req.Body)
		if err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PutConfig(ctx, req.BaseURL, cfg)
		return toResult(resp, err, start)
	case http.MethodPost + " /reload":
		resp, err := client.PostReload(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodPost + " /failsafe":
		var body patroni.FailsafePeerRequest
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostFailsafe(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodPost + " /sigterm":
		resp, err := client.PostSigterm(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodPost + " /restart":
		var body patroni.RestartRequest
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostRestart(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodDelete + " /restart":
		resp, err := client.DeleteRestart(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodDelete + " /switchover":
		resp, err := client.DeleteSwitchover(ctx, req.BaseURL)
		return toResult(resp, err, start)
	case http.MethodPost + " /reinitialize":
		var body patroni.ReinitializeRequest
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostReinitialize(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodPost + " /failover":
		var body patroni.FailoverRequest
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostFailover(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodPost + " /switchover":
		var body patroni.FailoverRequest
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostSwitchover(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodPost + " /citus":
		var body patroni.MPPEvent
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostCitus(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	case http.MethodPost + " /mpp":
		var body patroni.MPPEvent
		if err := decode(req.Body, &body); err != nil {
			return failure(http.StatusBadRequest, err.Error(), start)
		}
		resp, err := client.PostMPP(ctx, req.BaseURL, body)
		return toResult(resp, err, start)
	default:
		return failure(http.StatusNotFound, fmt.Sprintf("unknown endpoint %s %s", method, path), start)
	}
}

func buildClient(req Request) (*patroni.Client, error) {
	options := patroni.ClientOptions{}
	if req.Timeout > 0 {
		options.Timeout = time.Duration(req.Timeout) * time.Second
	}
	if req.Insecure || req.CA != "" {
		transport, err := buildTransport(req.Insecure, req.CA)
		if err != nil {
			return nil, fmt.Errorf("build TLS transport: %w", err)
		}
		options.Transport = transport
	}
	if req.Username != "" || req.Password != "" {
		options.Authorizer = patroni.NewBasicAuth(req.Username, req.Password)
	}
	return patroni.NewClient(options)
}

// buildTransport clones the default transport and applies verification
// settings. A provided CA is appended to the system root pool; the insecure
// flag disables certificate verification entirely.
func buildTransport(insecure bool, caPEM string) (*http.Transport, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	configuration := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: insecure}
	if caPEM != "" {
		roots, err := x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM([]byte(caPEM)) {
			return nil, errors.New("no CA certificate found in provided PEM")
		}
		configuration.RootCAs = roots
	}
	transport.TLSClientConfig = configuration
	return transport, nil
}

func dispatchHealth(ctx context.Context, client *patroni.Client, method, path string, req Request, start time.Time) Result {
	alias := patroni.HealthAlias(path)
	query := healthQuery(req.Query)
	switch method {
	case http.MethodGet:
		resp, err := client.GetHealth(ctx, req.BaseURL, alias, query)
		return toResult(resp, err, start)
	case http.MethodHead:
		resp, err := client.HeadHealth(ctx, req.BaseURL, alias, query)
		return toResult(resp, err, start)
	case http.MethodOptions:
		resp, err := client.OptionsHealth(ctx, req.BaseURL, alias)
		return toResult(resp, err, start)
	default:
		return failure(http.StatusNotFound, fmt.Sprintf("unsupported method %s for health alias %s", method, path), start)
	}
}

func isHealthAlias(path string) bool {
	for _, alias := range patroni.HealthAliases() {
		if string(alias) == path {
			return true
		}
	}
	return false
}

func healthQuery(query map[string]string) patroni.HealthQuery {
	hq := patroni.HealthQuery{}
	for key, value := range query {
		if key == "lag" {
			hq.Lag = value
			continue
		}
		if strings.HasPrefix(key, "tag_") {
			if hq.Tags == nil {
				hq.Tags = map[string]string{}
			}
			hq.Tags[strings.TrimPrefix(key, "tag_")] = value
		}
	}
	return hq
}

func readinessQuery(query map[string]string) patroni.ReadinessQuery {
	rq := patroni.ReadinessQuery{}
	for key, value := range query {
		switch key {
		case "lag":
			rq.Lag = value
		case "mode":
			rq.Mode = value
		}
	}
	return rq
}

func decode(raw json.RawMessage, dst any) error {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return dec.Decode(dst)
}

func decodeDynamicConfig(raw json.RawMessage) (patroni.DynamicConfig, error) {
	cfg := patroni.DynamicConfig{}
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return cfg, nil
	}
	if err := decode(raw, &cfg); err != nil {
		return nil, fmt.Errorf("config body must be a JSON object: %w", err)
	}
	return cfg, nil
}

func toResult[T any](resp patroni.Response[T], err error, start time.Time) Result {
	r := Result{
		StatusCode: resp.StatusCode,
		Headers:    flattenHeaders(resp.Header),
		Raw:        string(resp.Raw),
		DurationMs: time.Since(start).Milliseconds(),
	}
	if err != nil {
		r.Error = err.Error()
	}
	if r.StatusCode >= 200 && r.StatusCode < 300 {
		r.Data = resp.Data
	}
	return r
}

// failure builds a Result for a local (pre-flight) error.
func failure(status int, message string, start time.Time) Result {
	return Result{
		StatusCode: status,
		Headers:    map[string]string{},
		Error:      message,
		DurationMs: time.Since(start).Milliseconds(),
	}
}

func flattenHeaders(header http.Header) map[string]string {
	out := make(map[string]string, len(header))
	for key, values := range header {
		out[key] = strings.Join(values, ", ")
	}
	return out
}
