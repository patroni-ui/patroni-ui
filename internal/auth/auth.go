// Package auth implements HTTP Basic authentication backed by a list of users
// with bcrypt password hashes.
package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

// User is a single account.
type User struct {
	Username     string   `yaml:"username" json:"username"`
	PasswordHash string   `yaml:"password_hash" json:"password_hash"`
	Admin        bool     `yaml:"admin" json:"admin"`
	Database     Database `yaml:"database,omitempty" json:"database,omitempty"`
}

// Database holds the PostgreSQL connection settings used to run SQL queries on
// behalf of a user. Username/password are credentials, dbname is the target
// database, and every other key is passed through as a connection parameter.
type Database struct {
	Username string            `yaml:"username" json:"username"`
	Password string            `yaml:"password" json:"password,omitempty"`
	Dbname   string            `yaml:"dbname" json:"dbname,omitempty"`
	Params   map[string]string `yaml:"-" json:"-"`
}

func (d *Database) UnmarshalYAML(value *yaml.Node) error {
	var raw map[string]any
	if err := value.Decode(&raw); err != nil {
		return err
	}
	d.Username = asString(raw["username"])
	d.Password = asString(raw["password"])
	d.Dbname = asString(raw["dbname"])
	d.Params = map[string]string{}
	for k, v := range raw {
		switch k {
		case "username", "password", "dbname":
		default:
			d.Params[k] = asString(v)
		}
	}
	return nil
}

func (d Database) MarshalYAML() (interface{}, error) {
	out := map[string]string{}
	if d.Username != "" {
		out["username"] = d.Username
	}
	if d.Password != "" {
		out["password"] = d.Password
	}
	if d.Dbname != "" {
		out["dbname"] = d.Dbname
	}
	for k, v := range d.Params {
		out[k] = v
	}
	return out, nil
}

// MarshalJSON flattens the database connection settings into a single JSON
// object so arbitrary connection parameters (sslmode, application_name, ...)
// survive a JSON round-trip.
func (d Database) MarshalJSON() ([]byte, error) {
	out := map[string]string{}
	if d.Username != "" {
		out["username"] = d.Username
	}
	if d.Password != "" {
		out["password"] = d.Password
	}
	if d.Dbname != "" {
		out["dbname"] = d.Dbname
	}
	for k, v := range d.Params {
		out[k] = v
	}
	return json.Marshal(out)
}

// UnmarshalJSON parses a JSON object, collecting the well-known keys into the
// dedicated fields and every other key into Params.
func (d *Database) UnmarshalJSON(data []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	d.Username = asString(raw["username"])
	d.Password = asString(raw["password"])
	d.Dbname = asString(raw["dbname"])
	d.Params = map[string]string{}
	for k, v := range raw {
		switch k {
		case "username", "password", "dbname":
		default:
			d.Params[k] = asString(v)
		}
	}
	return nil
}

func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}

// Store validates Basic credentials against a fixed set of users.
type Store struct {
	realm     string
	users     map[string][]byte // username -> bcrypt hash
	admins    map[string]bool   // username -> is admin
	databases map[string]Database
}

// NewStore builds a store from a list of users. Plaintext password_hash
// values are hashed on load so subsequent logins are consistent.
func NewStore(users []User) (*Store, error) {
	s := &Store{realm: "patroni-ui", users: map[string][]byte{}, admins: map[string]bool{}, databases: map[string]Database{}}
	for _, u := range users {
		username := strings.TrimSpace(u.Username)
		if username == "" {
			continue
		}
		hash := strings.TrimSpace(u.PasswordHash)
		if hash == "" {
			continue
		}
		if _, err := bcrypt.Cost([]byte(hash)); err != nil {
			if strings.HasPrefix(hash, "$2") {
				return nil, fmt.Errorf("user %q: invalid bcrypt hash: %w", username, err)
			}
			hashed, err := bcrypt.GenerateFromPassword([]byte(hash), bcrypt.DefaultCost)
			if err != nil {
				return nil, fmt.Errorf("user %q: hash password: %w", username, err)
			}
			hash = string(hashed)
		}
		s.users[username] = []byte(hash)
		if u.Admin {
			s.admins[username] = true
		}
		if u.Database.Username != "" {
			s.databases[username] = u.Database
		}
	}
	return s, nil
}

// AddUser creates a new account, returning an error if the username already
// exists.
func (s *Store) AddUser(username, plainPassword string, admin bool, db Database) error {
	if s.HasUser(username) {
		return fmt.Errorf("user %q already exists", username)
	}
	s.ensureMaps()
	hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.users[username] = hash
	s.setAdmin(username, admin)
	s.setDatabase(username, db)
	return nil
}

// SetUser updates an existing user's admin flag and database settings. When
// plainPassword is non-empty the password is replaced as well.
func (s *Store) SetUser(username, plainPassword string, admin bool, db Database) error {
	if !s.HasUser(username) {
		return fmt.Errorf("user %q not found", username)
	}
	if s.admins[username] && !admin && len(s.admins) == 1 {
		return errors.New("cannot remove admin rights from the last admin user")
	}
	s.ensureMaps()
	if plainPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		s.users[username] = hash
	}
	s.setAdmin(username, admin)
	s.setDatabase(username, db)
	return nil
}

// SetPassword replaces a user's password.
func (s *Store) SetPassword(username, plainPassword string) error {
	if !s.HasUser(username) {
		return fmt.Errorf("user %q not found", username)
	}
	s.ensureMaps()
	hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.users[username] = hash
	return nil
}

// RemoveUser deletes an account, refusing to remove the last remaining admin.
func (s *Store) RemoveUser(username string) error {
	if !s.HasUser(username) {
		return fmt.Errorf("user %q not found", username)
	}
	if s.admins[username] && len(s.admins) == 1 {
		return errors.New("cannot remove the last admin user")
	}
	delete(s.users, username)
	delete(s.admins, username)
	delete(s.databases, username)
	return nil
}

// HasUser reports whether username exists.
func (s *Store) HasUser(username string) bool {
	if s == nil {
		return false
	}
	_, ok := s.users[username]
	return ok
}

func (s *Store) ensureMaps() {
	if s.users == nil {
		s.users = map[string][]byte{}
	}
	if s.admins == nil {
		s.admins = map[string]bool{}
	}
	if s.databases == nil {
		s.databases = map[string]Database{}
	}
}

func (s *Store) setAdmin(username string, admin bool) {
	if admin {
		s.admins[username] = true
	} else {
		delete(s.admins, username)
	}
}

func (s *Store) setDatabase(username string, db Database) {
	if db.Username != "" {
		s.databases[username] = db
	} else {
		delete(s.databases, username)
	}
}

// IsAdmin reports whether the user has admin privileges.
func (s *Store) IsAdmin(username string) bool {
	return s != nil && s.admins[username]
}

// Database returns the PostgreSQL connection settings configured for a user.
func (s *Store) Database(username string) (Database, bool) {
	if s == nil {
		return Database{}, false
	}
	d, ok := s.databases[username]
	return d, ok
}

// ChangePassword verifies the current password and replaces it with a new one.
func (s *Store) ChangePassword(username, oldPassword, newPassword string) error {
	if !s.Authenticate(username, oldPassword) {
		return errors.New("current password is incorrect")
	}
	return s.SetPassword(username, newPassword)
}

// Users returns the accounts sorted by username.
func (s *Store) Users() []User {
	users := make([]User, 0, len(s.users))
	for name, hash := range s.users {
		users = append(users, User{Username: name, PasswordHash: string(hash), Admin: s.admins[name], Database: s.databases[name]})
	}
	sort.Slice(users, func(i, j int) bool { return users[i].Username < users[j].Username })
	return users
}

// Empty reports whether the store has no accounts.
func (s *Store) Empty() bool {
	return s == nil || len(s.users) == 0
}

// Authenticate validates a username/password pair.
func (s *Store) Authenticate(username, password string) bool {
	if s == nil {
		return false
	}
	hash, ok := s.users[username]
	if !ok {
		// Perform a dummy comparison to reduce username-enumeration timing.
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$7EqJtq98hPqEX7fNZaFWoOhi1YXJHhl9Zw2U7CVQxO6MWdJxJ1l1K"), []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
}

// ErrUnauthorized is returned by Verify for missing or invalid credentials.
var ErrUnauthorized = errors.New("unauthorized")

// Verify extracts and checks the Authorization header from a request.
func (s *Store) Verify(r *http.Request) (string, error) {
	username, password, ok := r.BasicAuth()
	if !ok {
		return "", ErrUnauthorized
	}
	if !s.Authenticate(username, password) {
		return "", ErrUnauthorized
	}
	return username, nil
}

// Wrap guards handler with Basic authentication. If the store is empty the
// handler is not protected (useful for bring-up; the caller should still
// refuse empty stores when auth is expected).
func (s *Store) Wrap(next http.Handler) http.Handler {
	if s == nil || s.Empty() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.Verify(r); err != nil {
			w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Basic realm=%q, charset="UTF-8"`, s.realm))
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
