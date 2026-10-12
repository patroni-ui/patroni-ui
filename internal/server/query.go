package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"patroni-ui/internal/database"
	"patroni-ui/internal/dispatch"
)

func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	username := s.currentUsername(r)

	var req struct {
		Target string `json:"target"`
		Node   string `json:"node"`
		Limit  int    `json:"limit"`
		SQL    string `json:"sql"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body: " + err.Error()})
		return
	}
	if strings.TrimSpace(req.SQL) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "sql is required"})
		return
	}
	if req.Limit <= 0 {
		req.Limit = 100
	}
	if req.Limit > 10000 {
		req.Limit = 10000
	}

	dbCreds, ok := s.auth.Database(username)
	if !ok || dbCreds.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no database configured for user " + username})
		return
	}
	creds := database.Credentials{
		Username: dbCreds.Username,
		Password: dbCreds.Password,
		Dbname:   dbCreds.Dbname,
		Params:   dbCreds.Params,
	}

	nodes, err := s.clusterNodes(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	result := database.Execute(r.Context(), nodes, creds, req.Target, req.Node, req.SQL, req.Limit)
	writeJSON(w, http.StatusOK, result)
}

// clusterNodes fetches the Patroni /cluster endpoint and extracts the
// PostgreSQL host/port of each member.
func (s *Server) clusterNodes(ctx context.Context) ([]database.Node, error) {
	result := dispatch.Execute(ctx, dispatch.Request{Method: http.MethodGet, Path: "/cluster"}, s.patroniConfig())
	if result.Error != "" || result.StatusCode >= 400 {
		msg := result.Error
		if msg == "" {
			msg = fmt.Sprintf("cluster request failed (status %d)", result.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	var cluster struct {
		Members []struct {
			Name string `json:"name"`
			Role string `json:"role"`
			Host string `json:"host"`
			Port int    `json:"port"`
		} `json:"members"`
	}
	if err := json.Unmarshal([]byte(result.Raw), &cluster); err != nil {
		return nil, fmt.Errorf("parse cluster response: %w", err)
	}

	nodes := make([]database.Node, 0, len(cluster.Members))
	for _, m := range cluster.Members {
		nodes = append(nodes, database.Node{Name: m.Name, Role: m.Role, Host: m.Host, Port: m.Port})
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no members in cluster response")
	}
	return nodes, nil
}
