// Package userdb stores Web UI user accounts in a binary file. Accounts are
// serialized with encoding/gob and written to disk with 0600 permissions. On
// first use the database is seeded with a default admin account (admin:admin)
// which should be changed by the operator.
package userdb

import (
	"bytes"
	"encoding/gob"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/crypto/bcrypt"

	"patroni-ui/internal/auth"
)

const (
	defaultAdminUser     = "admin"
	defaultAdminPassword = "admin"
	formatVersion        = 1
)

type fileFormat struct {
	Version int
	Users   []auth.User
}

// DB is a persistent collection of user accounts.
type DB struct {
	mu    sync.Mutex
	path  string
	users []auth.User
}

// Open loads the user database from path. When path does not exist it is
// created and seeded with the default admin account; in that case the returned
// created flag is true.
func Open(path string) (*DB, bool, error) {
	db := &DB{path: path}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		db.users = defaultUsers()
		if err := db.Save(db.users); err != nil {
			return nil, false, err
		}
		return db, true, nil
	} else if err != nil {
		return nil, false, fmt.Errorf("stat users db: %w", err)
	}
	if err := db.load(); err != nil {
		return nil, false, err
	}
	return db, false, nil
}

// Users returns a copy of the current accounts.
func (db *DB) Users() []auth.User {
	db.mu.Lock()
	defer db.mu.Unlock()
	return append([]auth.User(nil), db.users...)
}

// Save atomically persists the given accounts.
func (db *DB) Save(users []auth.User) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.users = append([]auth.User(nil), users...)

	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(fileFormat{Version: formatVersion, Users: db.users}); err != nil {
		return err
	}
	if dir := filepath.Dir(db.path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return os.WriteFile(db.path, buf.Bytes(), 0o600)
}

func (db *DB) load() error {
	raw, err := os.ReadFile(db.path)
	if err != nil {
		return fmt.Errorf("read users db: %w", err)
	}
	var ff fileFormat
	if err := gob.NewDecoder(bytes.NewReader(raw)).Decode(&ff); err != nil {
		return fmt.Errorf("parse users db: %w", err)
	}
	db.users = ff.Users
	if db.users == nil {
		db.users = []auth.User{}
	}
	return nil
}

func defaultUsers() []auth.User {
	hash, err := bcrypt.GenerateFromPassword([]byte(defaultAdminPassword), bcrypt.DefaultCost)
	if err != nil {
		// Hashing a constant with the default cost cannot fail in practice.
		hash = []byte{}
	}
	return []auth.User{{Username: defaultAdminUser, PasswordHash: string(hash), Admin: true}}
}
