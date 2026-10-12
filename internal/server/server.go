// Package server wires the HTTP API and static frontend together.
package server

import (
	"io/fs"
	"log/slog"
	"net/http"

	patroni "github.com/pgsty/go-patroni"

	"patroni-ui/internal/auth"
	"patroni-ui/internal/clusterdb"
	"patroni-ui/internal/dispatch"
)

// Server bundles the router dependencies.
type Server struct {
	static    fs.FS
	auth      *auth.Store
	clusters  *clusterdb.DB
	saveUsers func([]auth.User) error
	logger    *slog.Logger
}

// New builds the top-level http.Handler.
func New(static fs.FS, store *auth.Store, clusters *clusterdb.DB, saveUsers func([]auth.User) error, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{static: static, auth: store, clusters: clusters, saveUsers: saveUsers, logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.Handle("GET /api/catalog", s.auth.Wrap(http.HandlerFunc(s.handleCatalog)))
	mux.Handle("POST /api/execute", s.auth.Wrap(http.HandlerFunc(s.handleExecute)))
	mux.Handle("POST /api/query", s.auth.Wrap(http.HandlerFunc(s.handleQuery)))
	mux.Handle("GET /api/me", s.auth.Wrap(http.HandlerFunc(s.handleMe)))
	mux.Handle("POST /api/password", s.auth.Wrap(http.HandlerFunc(s.handleChangePassword)))
	mux.Handle("GET /api/users", s.auth.Wrap(s.adminOnly(s.handleListUsers)))
	mux.Handle("POST /api/users", s.auth.Wrap(s.adminOnly(s.handleCreateUser)))
	mux.Handle("PUT /api/users/{username}", s.auth.Wrap(s.adminOnly(s.handleUpdateUser)))
	mux.Handle("DELETE /api/users/{username}", s.auth.Wrap(s.adminOnly(s.handleDeleteUser)))
	mux.Handle("GET /api/cluster", s.auth.Wrap(s.adminOnly(s.handleGetCluster)))
	mux.Handle("PUT /api/cluster", s.auth.Wrap(s.adminOnly(s.handlePutCluster)))
	mux.Handle("DELETE /api/cluster", s.auth.Wrap(s.adminOnly(s.handleDeleteCluster)))
	mux.Handle("POST /api/cluster/test", s.auth.Wrap(s.adminOnly(s.handleTestCluster)))
	mux.Handle("GET /api/cluster/status", s.auth.Wrap(http.HandlerFunc(s.handleClusterStatus)))

	// Static frontend is also guarded by Basic auth.
	fileServer := http.FileServer(http.FS(s.static))
	mux.Handle("/", s.auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/history", "/config", "/query", "/users", "/cluster-config":
			serveIndex(s.static, w)
			return
		}
		fileServer.ServeHTTP(w, r)
	})))

	return logRequests(logger, mux)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// patroniConfig returns the current cluster connection settings as a dispatch
// config. The settings may change at runtime when an admin saves the cluster
// form, so this is read on every request.
func (s *Server) patroniConfig() dispatch.Config {
	c := s.clusters.Get()
	return dispatch.Config{
		Hosts:    c.Hosts,
		Username: c.Username,
		Password: c.Password,
		Insecure: c.Insecure,
		CA:       c.CA,
	}
}

// catalogPaths is the subset of Patroni REST endpoints exposed in the UI.
var catalogPaths = map[string]bool{
	"/cluster":      true,
	"/patroni":      true,
	"/history":      true,
	"/config":       true,
	"/metrics":      true,
	"/reload":       true,
	"/restart":      true,
	"/reinitialize": true,
	"/failover":     true,
	"/switchover":   true,
}

// hiddenCatalogIDs are write operations surfaced through the cluster nodes
// instead of the sidebar.
var hiddenCatalogIDs = map[string]bool{
	"post-reload":       true,
	"post-restart":      true,
	"post-reinitialize": true,
	"post-failover":     true,
	"post-switchover":   true,
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	all := patroni.EndpointCatalog()
	filtered := make([]patroni.Endpoint, 0, len(all))
	for _, ep := range all {
		if catalogPaths[ep.Path] && !hiddenCatalogIDs[ep.ID] {
			filtered = append(filtered, ep)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": filtered})
}

func serveIndex(fsys fs.FS, w http.ResponseWriter) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		//if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
		//	logger.Info("request", "method", r.Method, "path", r.URL.Path)
		//}
		next.ServeHTTP(w, r)
	})
}
