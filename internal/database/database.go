// Package database runs user-supplied SQL against the Patroni-managed
// PostgreSQL nodes using pgx. It connects directly to a specific node, or uses
// target_session_attrs to reach a leader/replica across all hosts.
package database

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Credentials are the PostgreSQL connection settings for a user.
type Credentials struct {
	Username string            // database user
	Password string            // database password
	Dbname   string            // database name, defaults to "postgres"
	Params   map[string]string // extra connection parameters (sslmode, application_name, ...)
}

// Node is a PostgreSQL member discovered from the Patroni /cluster endpoint.
type Node struct {
	Name string
	Role string
	Host string
	Port int
}

// Result is the normalized query outcome for the Web UI.
type Result struct {
	Operation   string   `json:"operation"` // "query" or "exec"
	Columns     []string `json:"columns,omitempty"`
	ColumnTypes []string `json:"column_types,omitempty"`
	Rows        [][]any  `json:"rows,omitempty"`
	Affected    int64    `json:"affected,omitempty"`
	DurationMs  int64    `json:"duration_ms"`
	Error       string   `json:"error,omitempty"`
}

// Execute connects to the selected target and runs sql. target is "leader",
// "replica", or "node" (in which case nodeName selects the node).
func Execute(ctx context.Context, nodes []Node, creds Credentials, target, nodeName, sql string, limit int) Result {
	start := time.Now()

	if limit <= 0 {
		limit = 100
	}

	connNodes, tsa, err := resolveTarget(nodes, target, nodeName)
	if err != nil {
		return Result{DurationMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}

	dsn, err := buildDSN(connNodes, creds, tsa)
	if err != nil {
		return Result{DurationMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}

	queryCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	conn, err := pgx.Connect(queryCtx, dsn)
	if err != nil {
		return Result{DurationMs: time.Since(start).Milliseconds(), Error: fmt.Sprintf("connect: %v", err)}
	}
	defer conn.Close(context.Background())

	if isQueryStatement(conn, queryCtx, sql) {
		columns, oids, rows, err := runQuery(conn, queryCtx, sql, limit, cancel)
		if err != nil {
			return Result{DurationMs: time.Since(start).Milliseconds(), Error: err.Error()}
		}
		columnTypes := resolveTypeNames(ctx, dsn, oids)
		return Result{Operation: "query", Columns: columns, ColumnTypes: columnTypes, Rows: rows, DurationMs: time.Since(start).Milliseconds()}
	}

	tag, err := conn.Exec(queryCtx, sql)
	if err != nil {
		return Result{DurationMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}
	return Result{Operation: "exec", Affected: tag.RowsAffected(), DurationMs: time.Since(start).Milliseconds()}
}

func resolveTarget(nodes []Node, target, nodeName string) ([]Node, string, error) {
	switch target {
	case "node":
		for _, n := range nodes {
			if n.Name == nodeName {
				return []Node{n}, "", nil
			}
		}
		return nil, "", fmt.Errorf("node %q not found", nodeName)
	case "leader":
		return nodes, "read-write", nil
	case "replica":
		return nodes, "prefer-standby", nil
	default:
		return nil, "", fmt.Errorf("invalid target %q", target)
	}
}

func buildDSN(nodes []Node, creds Credentials, tsa string) (string, error) {
	hosts := make([]string, 0, len(nodes))
	ports := make([]string, 0, len(nodes))
	for _, n := range nodes {
		if n.Host == "" || n.Port == 0 {
			continue
		}
		hosts = append(hosts, n.Host)
		ports = append(ports, strconv.Itoa(n.Port))
	}
	if len(hosts) == 0 {
		return "", fmt.Errorf("no database host available")
	}

	dbname := creds.Dbname
	if dbname == "" {
		dbname = "postgres"
	}

	params := map[string]string{
		"host":            strings.Join(hosts, ","),
		"port":            strings.Join(ports, ","),
		"user":            creds.Username,
		"password":        creds.Password,
		"dbname":          dbname,
		"connect_timeout": "5",
	}
	// User-supplied connection parameters override the defaults above.
	for k, v := range creds.Params {
		params[k] = v
	}
	if tsa != "" {
		params["target_session_attrs"] = tsa
	}

	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+dsnValue(params[k]))
	}
	return strings.Join(parts, " "), nil
}

// dsnValue quotes a connection-string value when it contains spaces.
func dsnValue(v string) string {
	if strings.ContainsAny(v, " \t") {
		return "'" + strings.ReplaceAll(v, "'", "''") + "'"
	}
	return v
}

// isQueryStatement reports whether sql returns rows (a SELECT). It runs EXPLAIN
// and inspects the "Operation" field. Statements that cannot be explained
// (DDL/utility) are treated as queries as well: they are executed and, since
// they return no rows, the UI reports "no results".
func isQueryStatement(conn *pgx.Conn, ctx context.Context, sql string) bool {
	var explain string
	if err := conn.QueryRow(ctx, "EXPLAIN (FORMAT JSON, VERBOSE) "+sql).Scan(&explain); err != nil {
		return true
	}
	return isSelectOperation([]byte(explain))
}

func isSelectOperation(explainJSON []byte) bool {
	var root any
	if err := json.Unmarshal(explainJSON, &root); err != nil {
		return false
	}
	switch findOperation(root) {
	case "Insert", "Update", "Delete", "Merge":
		return false
	default:
		return true
	}
}

func findOperation(v any) string {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if k == "Operation" {
				if s, ok := val.(string); ok {
					return s
				}
			}
			if op := findOperation(val); op != "" {
				return op
			}
		}
	case []any:
		for _, item := range t {
			if op := findOperation(item); op != "" {
				return op
			}
		}
	}
	return ""
}

func runQuery(conn *pgx.Conn, ctx context.Context, sql string, limit int, cancel context.CancelFunc) ([]string, []uint32, [][]any, error) {
	rows, err := conn.Query(ctx, sql)
	if err != nil {
		return nil, nil, nil, err
	}

	fields := rows.FieldDescriptions()
	columns := make([]string, len(fields))
	oids := make([]uint32, len(fields))
	for i, fd := range fields {
		columns[i] = string(fd.Name)
		oids[i] = fd.DataTypeOID
	}

	var data [][]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		norm := make([]any, len(values))
		for i, v := range values {
			norm[i] = normalizeValue(v)
		}
		data = append(data, norm)
		if len(data) >= limit {
			cancel() // stop pulling more rows once we have the limit
			break
		}
	}
	readErr := rows.Err()
	rows.Close()

	if readErr != nil && len(data) < limit {
		return nil, nil, nil, readErr
	}

	return columns, oids, data, nil
}

// resolveTypeNames looks up PostgreSQL type names by OID. It uses a separate
// short-lived connection because the main connection may have been cancelled
// after reaching the row limit. This also covers custom extension types (e.g.
// pgvector's "vector") that pgx's type map doesn't know about.
func resolveTypeNames(ctx context.Context, dsn string, oids []uint32) []string {
	names := make([]string, len(oids))
	if len(oids) == 0 {
		return names
	}

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return names
	}
	defer conn.Close(context.Background())

	parts := make([]string, len(oids))
	for i, oid := range oids {
		parts[i] = strconv.FormatUint(uint64(oid), 10)
	}
	q := "SELECT oid::int8, typname FROM pg_type WHERE oid IN (" + strings.Join(parts, ",") + ")"
	rows, err := conn.Query(ctx, q)
	if err != nil {
		return names
	}
	defer rows.Close()

	m := map[uint32]string{}
	for rows.Next() {
		var oid int64
		var typname string
		if err := rows.Scan(&oid, &typname); err == nil {
			m[uint32(oid)] = typname
		}
	}
	for i, oid := range oids {
		if name, ok := m[oid]; ok {
			names[i] = name
		}
	}
	return names
}

func normalizeValue(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case time.Time:
		return t.Format(time.RFC3339Nano)
	case []byte:
		return string(t)
	case pgtype.Numeric:
		if dv, err := t.Value(); err == nil {
			return dv
		}
		return nil
	default:
		if s, ok := v.(fmt.Stringer); ok {
			return s.String()
		}
		return v
	}
}
