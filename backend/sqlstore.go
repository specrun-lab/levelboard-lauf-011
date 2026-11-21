package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const schemaSQL = `
CREATE TABLE levels (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  status       TEXT    NOT NULL CHECK (status IN ('offen','bestanden','fehlgeschlagen','gesperrt')),
  checked_at   TEXT,
  duration_ms  INTEGER,
  checks       TEXT    NOT NULL DEFAULT '[]',
  metrics      TEXT    NOT NULL DEFAULT '{}'
);
CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL REFERENCES levels(level),
  status       TEXT    NOT NULL CHECK (status IN ('bestanden','fehlgeschlagen')),
  checked_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  checks       TEXT    NOT NULL,
  metrics      TEXT    NOT NULL
);
CREATE INDEX reports_level ON reports(level, id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`

// sqlStore speichert den Stand in einer SQLite-Datei.
type sqlStore struct {
	db *sql.DB
}

func openSQLStore(path string) (*sqlStore, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &sqlStore{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *sqlStore) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v >= 1 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(schemaSQL); err != nil {
		return fmt.Errorf("Schema: %w", err)
	}
	for i := 1; i <= 10; i++ {
		if _, err := tx.Exec(`INSERT INTO levels (level, status) VALUES (?, 'offen')`, i); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`PRAGMA user_version = 1`); err != nil {
		return err
	}
	return tx.Commit()
}

type querier interface {
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
}

func readLevels(ctx context.Context, q querier) ([]Level, *string, error) {
	rows, err := q.QueryContext(ctx, `SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels ORDER BY level`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var out []Level
	for rows.Next() {
		l, err := scanLevel(rows)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if len(out) != 10 {
		return nil, nil, fmt.Errorf("erwartet 10 Levels, gefunden %d", len(out))
	}
	var upd sql.NullString
	err = q.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'updated_at'`).Scan(&upd)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, err
	}
	var updatedAt *string
	if upd.Valid {
		updatedAt = &upd.String
	}
	return out, updatedAt, nil
}

type scanner interface{ Scan(dest ...any) error }

func scanLevel(r scanner) (Level, error) {
	var l Level
	var checkedAt sql.NullString
	var dur sql.NullInt64
	var checks, metrics string
	if err := r.Scan(&l.Level, &l.Status, &checkedAt, &dur, &checks, &metrics); err != nil {
		return l, err
	}
	if l.Level < 1 || l.Level > 10 {
		return l, fmt.Errorf("ungültiges Level %d", l.Level)
	}
	l.Title = Titles[l.Level-1]
	if checkedAt.Valid {
		l.CheckedAt = &checkedAt.String
	}
	if dur.Valid {
		l.DurationMs = &dur.Int64
	}
	if err := json.Unmarshal([]byte(checks), &l.Checks); err != nil {
		return l, err
	}
	if l.Checks == nil {
		l.Checks = []Check{}
	}
	l.Metrics = json.RawMessage(metrics)
	return l, nil
}

func (s *sqlStore) Levels() ([]Level, *string, error) {
	return readLevels(context.Background(), s.db)
}

func (s *sqlStore) Level(n int) (Level, error) {
	row := s.db.QueryRow(`SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels WHERE level = ?`, n)
	return scanLevel(row)
}

func (s *sqlStore) Report(n int, r Report, now time.Time) ([]Level, *string, error) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()
	levels, _, err := readLevels(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	ts := ISO(now)
	if err := ApplyReport(levels, n, r, ts); err != nil {
		return nil, nil, err
	}
	checksJSON, err := json.Marshal(r.Checks)
	if err != nil {
		return nil, nil, err
	}
	st := levels[n-1].Status
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO reports (level, status, checked_at, duration_ms, checks, metrics) VALUES (?, ?, ?, ?, ?, ?)`,
		n, st, ts, r.DurationMs, string(checksJSON), string(r.Metrics)); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE levels SET status = ?, checked_at = ?, duration_ms = ?, checks = ?, metrics = ? WHERE level = ?`,
		st, ts, r.DurationMs, string(checksJSON), string(r.Metrics), n); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE levels SET status = ?, checked_at = NULL, duration_ms = NULL, checks = '[]', metrics = '{}' WHERE level > ?`,
		levels[min(n, 9)].Status, n); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ts); err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return levels, &ts, nil
}

func (s *sqlStore) History(n, limit int) ([]HistoryEntry, error) {
	rows, err := s.db.Query(
		`SELECT id, status, checked_at, duration_ms, checks, metrics FROM reports WHERE level = ? ORDER BY id DESC LIMIT ?`, n, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistoryEntry{}
	for rows.Next() {
		var e HistoryEntry
		var checks, metrics string
		if err := rows.Scan(&e.ID, &e.Status, &e.CheckedAt, &e.DurationMs, &checks, &metrics); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(checks), &e.Checks); err != nil {
			return nil, err
		}
		if e.Checks == nil {
			e.Checks = []Check{}
		}
		e.Metrics = json.RawMessage(metrics)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *sqlStore) Close() error { return s.db.Close() }
