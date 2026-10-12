// Package clusterdb stores the Patroni cluster connection settings in a binary
// file. Settings are serialized with encoding/gob and written to disk with
// 0600 permissions. The cluster is configured at runtime by an administrator
// through the Web UI, replacing the former config.yaml file.
package clusterdb

import (
	"bytes"
	"encoding/gob"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const formatVersion = 1

// Config holds the Patroni REST connection settings.
type Config struct {
	Hosts    []string
	Username string
	Password string
	Insecure bool
	CA       string
}

type fileFormat struct {
	Version int
	Config  Config
}

// DB is a persistent collection of cluster connection settings.
type DB struct {
	mu   sync.RWMutex
	path string
	cfg  Config
}

// Open loads the cluster database from path. When path does not exist it is
// created with an empty (unconfigured) cluster.
func Open(path string) (*DB, error) {
	db := &DB{path: path, cfg: Config{Hosts: []string{}}}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := db.save(); err != nil {
			return nil, err
		}
		return db, nil
	} else if err != nil {
		return nil, fmt.Errorf("stat cluster db: %w", err)
	}
	if err := db.load(); err != nil {
		return nil, err
	}
	return db, nil
}

// Get returns a copy of the current cluster settings.
func (db *DB) Get() Config {
	db.mu.RLock()
	defer db.mu.RUnlock()
	cfg := db.cfg
	cfg.Hosts = append([]string(nil), db.cfg.Hosts...)
	if cfg.Hosts == nil {
		cfg.Hosts = []string{}
	}
	return cfg
}

// Configured reports whether at least one Patroni host is set.
func (db *DB) Configured() bool {
	db.mu.RLock()
	defer db.mu.RUnlock()
	return len(db.cfg.Hosts) > 0
}

// Set atomically persists the given cluster settings.
func (db *DB) Set(cfg Config) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.cfg = cfg
	db.cfg.Hosts = append([]string(nil), cfg.Hosts...)
	if db.cfg.Hosts == nil {
		db.cfg.Hosts = []string{}
	}
	return db.save()
}

// Clear removes the configured cluster, leaving the database in the
// unconfigured state.
func (db *DB) Clear() error {
	return db.Set(Config{})
}

func (db *DB) save() error {
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(fileFormat{Version: formatVersion, Config: db.cfg}); err != nil {
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
		return fmt.Errorf("read cluster db: %w", err)
	}
	var ff fileFormat
	if err := gob.NewDecoder(bytes.NewReader(raw)).Decode(&ff); err != nil {
		return fmt.Errorf("parse cluster db: %w", err)
	}
	db.cfg = ff.Config
	if db.cfg.Hosts == nil {
		db.cfg.Hosts = []string{}
	}
	return nil
}
