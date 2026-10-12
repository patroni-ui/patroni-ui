// Command patroni-ui is a web UI for the Patroni REST API, built on the
// go-patroni SDK. It serves a static single-page frontend and a small JSON API
// guarded by HTTP Basic authentication. Web UI users and the Patroni cluster
// connection are stored on disk in binary databases, configured at runtime
// through the UI.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"patroni-ui/internal/auth"
	"patroni-ui/internal/clusterdb"
	"patroni-ui/internal/server"
	"patroni-ui/internal/userdb"
)

//go:embed web
var webFS embed.FS

const (
	defaultDataDir = "./patroni-ui-data"
	portStart      = 8000
	portEnd        = 8010
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	flag.Usage = usage
	listen := flag.String("listen", envOr("LISTEN", ""), "HTTP listen address (host:port); when empty, the first available port in 8000-8010 is used")
	dataDir := flag.String("data-dir", envOr("DATA_DIR", defaultDataDir), "directory for the users and cluster databases")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	usersDB := filepath.Join(*dataDir, "users.db")
	clusterDB := filepath.Join(*dataDir, "cluster.db")

	db, created, err := userdb.Open(usersDB)
	if err != nil {
		return err
	}
	clusters, err := clusterdb.Open(clusterDB)
	if err != nil {
		return err
	}
	store, err := auth.NewStore(db.Users())
	if err != nil {
		return err
	}

	staticFS, err := fs.Sub(webFS, "web")
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	handler := server.New(staticFS, store, clusters, db.Save, logger)

	ln, err := netListen(*listen)
	if err != nil {
		return err
	}
	defer ln.Close()

	url := "http://" + displayHostPort(ln.Addr())
	defaultCreds := store.Authenticate("admin", "admin")
	printStartupBanner(url, created, defaultCreds)
	logger.Info("patroni-ui started", "url", url, "data-dir", *dataDir)
	return http.Serve(ln, handler)
}

// netListen binds to the requested address. When addr is empty it tries each
// port in the 8000-8010 range and returns the first that is free.
func netListen(addr string) (net.Listener, error) {
	if addr != "" {
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("listen on %s: %w", addr, err)
		}
		return ln, nil
	}
	for port := portStart; port <= portEnd; port++ {
		candidate := fmt.Sprintf(":%d", port)
		ln, err := net.Listen("tcp", candidate)
		if err == nil {
			return ln, nil
		}
	}
	return nil, fmt.Errorf("no available port in range %d-%d", portStart, portEnd)
}

// displayHostPort renders a bound listener address as host:port, replacing
// wildcard binds (0.0.0.0, ::) with localhost for a friendlier URL.
func displayHostPort(addr net.Addr) string {
	host, port, err := net.SplitHostPort(addr.String())
	if err != nil {
		return addr.String()
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

// printStartupBanner writes a visually distinct informational block with the
// service URL and, on first run or while the default admin:admin credentials
// are still active, a reminder about the login.
func printStartupBanner(url string, firstRun, defaultCreds bool) {
	const bar = "=============================================================="
	fmt.Fprintln(os.Stdout)
	fmt.Fprintln(os.Stdout, bar)
	fmt.Fprintln(os.Stdout, "  patroni-ui is running")
	fmt.Fprintf(os.Stdout, "  URL:  %s\n", url)
	if firstRun || defaultCreds {
		fmt.Fprintln(os.Stdout, bar)
		if firstRun {
			fmt.Fprintln(os.Stdout, "  FIRST RUN — no users found")
			fmt.Fprintln(os.Stdout, "  For the initial login use the account admin:admin,")
			fmt.Fprintln(os.Stdout, "  then change the password.")
		} else {
			fmt.Fprintln(os.Stdout, "  The default admin:admin account is still active.")
			fmt.Fprintln(os.Stdout, "  Please change the password.")
		}
	}
	fmt.Fprintln(os.Stdout, bar)
	fmt.Fprintln(os.Stdout)
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func usage() {
	fmt.Fprintf(os.Stderr, `patroni-ui — web UI for the Patroni REST API

Usage:
  patroni-ui [flags]

Flags:
`)
	flag.PrintDefaults()
}
