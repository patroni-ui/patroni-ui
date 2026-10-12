package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"patroni-ui/internal/auth"
	"patroni-ui/internal/clusterdb"
	"patroni-ui/internal/dispatch"
)

func (s *Server) currentUsername(r *http.Request) string {
	username, _ := s.auth.Verify(r)
	return username
}

// adminOnly guards a handler so that only admins can reach it.
func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.IsAdmin(s.currentUsername(r)) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
			return
		}
		next(w, r)
	}
}

func (s *Server) handleExecute(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read request body: " + err.Error()})
		return
	}
	var req dispatch.Request
	if err := json.Unmarshal(raw, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body: " + err.Error()})
		return
	}

	// Non-admin users may only issue GET requests.
	if !s.auth.IsAdmin(s.currentUsername(r)) && strings.ToUpper(req.Method) != http.MethodGet {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}

	result := dispatch.Execute(r.Context(), req, s.patroniConfig())
	// The HTTP envelope is always 200; the Patroni status code and any error
	// are carried in the body so the UI can render the complete result.
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	username := s.currentUsername(r)
	writeJSON(w, http.StatusOK, map[string]any{"username": username, "admin": s.auth.IsAdmin(username)})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	username := s.currentUsername(r)
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	if req.NewPassword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "new password is required"})
		return
	}
	if err := s.auth.ChangePassword(username, req.CurrentPassword, req.NewPassword); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if s.saveUsers != nil {
		if err := s.saveUsers(s.auth.Users()); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist password: " + err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- user management (admin only) ----

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users := s.auth.Users()
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		item := map[string]any{"username": u.Username, "admin": u.Admin}
		if u.Database.Username != "" {
			item["database"] = u.Database
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string         `json:"username"`
		Password string         `json:"password"`
		Admin    bool           `json:"admin"`
		Database *auth.Database `json:"database"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "username is required"})
		return
	}
	if req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "password is required"})
		return
	}
	var db auth.Database
	if req.Database != nil {
		db = *req.Database
	}
	if err := s.auth.AddUser(req.Username, req.Password, req.Admin, db); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if err := s.persistUsers(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist user: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	var req struct {
		Password string         `json:"password"`
		Admin    *bool          `json:"admin"`
		Database *auth.Database `json:"database"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}

	admin := s.auth.IsAdmin(username)
	if req.Admin != nil {
		admin = *req.Admin
	}
	db, _ := s.auth.Database(username)
	if req.Database != nil {
		db = *req.Database
	}

	if err := s.auth.SetUser(username, req.Password, admin, db); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if err := s.persistUsers(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist user: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if err := s.auth.RemoveUser(username); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if err := s.persistUsers(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist user: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) persistUsers() error {
	if s.saveUsers == nil {
		return nil
	}
	return s.saveUsers(s.auth.Users())
}

// ---- cluster connection (admin only) ----

func (s *Server) handleClusterStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"configured": s.clusters.Configured()})
}

func (s *Server) handleGetCluster(w http.ResponseWriter, r *http.Request) {
	c := s.clusters.Get()
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": s.clusters.Configured(),
		"hosts":      c.Hosts,
		"username":   c.Username,
		"password":   c.Password,
		"insecure":   c.Insecure,
		"ca":         c.CA,
	})
}

func (s *Server) handlePutCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Hosts    []string `json:"hosts"`
		Username string   `json:"username"`
		Password string   `json:"password"`
		Insecure bool     `json:"insecure"`
		CA       string   `json:"ca"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}

	hosts := cleanHosts(req.Hosts)
	if len(hosts) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "at least one Patroni host is required"})
		return
	}

	cfg := clusterdb.Config{
		Hosts:    hosts,
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
		Insecure: req.Insecure,
		CA:       strings.TrimSpace(req.CA),
	}
	if err := s.clusters.Set(cfg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist cluster: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleTestCluster runs a GET /cluster request against the supplied settings
// without saving them, so an admin can verify the connection before applying.
func (s *Server) handleTestCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Hosts    []string `json:"hosts"`
		Username string   `json:"username"`
		Password string   `json:"password"`
		Insecure bool     `json:"insecure"`
		CA       string   `json:"ca"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}

	hosts := cleanHosts(req.Hosts)
	if len(hosts) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "at least one Patroni host is required"})
		return
	}

	cfg := dispatch.Config{
		Hosts:    hosts,
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
		Insecure: req.Insecure,
		CA:       strings.TrimSpace(req.CA),
	}
	result := dispatch.Execute(r.Context(), dispatch.Request{Method: http.MethodGet, Path: "/cluster"}, cfg)
	writeJSON(w, http.StatusOK, result)
}

func cleanHosts(hosts []string) []string {
	out := make([]string, 0, len(hosts))
	for _, h := range hosts {
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	return out
}

func (s *Server) handleDeleteCluster(w http.ResponseWriter, r *http.Request) {
	if err := s.clusters.Clear(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to delete cluster: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
