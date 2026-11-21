package main

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTestStore(t *testing.T) Store {
	t.Helper()
	s, err := openSQLStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestHistoryNewestFirstAndLimit(t *testing.T) {
	_, h := newTestServer(t)
	post(h, 1, `{"checks":[{"name":"a","ok":true}],"durationMs":101}`)
	post(h, 1, `{"checks":[{"name":"a","ok":true}],"durationMs":102,"metrics":{"x":1}}`)
	var hist History
	rec := do(h, "GET", "/api/levels/1/history", "", "")
	if rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	mustJSON(t, rec.Body.Bytes(), &hist)
	if hist.Level != 1 || len(hist.Entries) != 2 || hist.Entries[0].DurationMs != 102 || hist.Entries[1].DurationMs != 101 ||
		hist.Entries[0].ID <= hist.Entries[1].ID || string(hist.Entries[0].Metrics) != `{"x":1}` || string(hist.Entries[1].Metrics) != `{}` {
		t.Fatalf("history %+v", hist)
	}
	mustJSON(t, do(h, "GET", "/api/levels/1/history?limit=1", "", "").Body.Bytes(), &hist)
	if len(hist.Entries) != 1 {
		t.Fatal("limit=1")
	}
	for _, q := range []string{"0", "501", "abc", "", "1.5", "-1"} {
		if rec := do(h, "GET", "/api/levels/1/history?limit="+q, "", ""); rec.Code != 400 {
			t.Errorf("limit=%q: %d", q, rec.Code)
		}
	}
	rec = do(h, "GET", "/api/levels/5/history", "", "")
	if rec.Body.String() != `{"level":5,"entries":[]}` {
		t.Fatalf("empty: %s", rec.Body.String())
	}
	if rec := do(h, "GET", "/api/levels/11/history", "", ""); rec.Code != 404 {
		t.Fatal("404 expected")
	}
}

func TestConflictNotInHistory(t *testing.T) {
	_, h := newTestServer(t)
	post(h, 1, failBody)
	if rec := post(h, 2, okBody); rec.Code != 409 {
		t.Fatal("expected 409")
	}
	var hist History
	mustJSON(t, do(h, "GET", "/api/levels/2/history", "", "").Body.Bytes(), &hist)
	if len(hist.Entries) != 0 {
		t.Fatal("409 in history")
	}
}

func TestPersistenceAndSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "p.db")
	s1, err := openSQLStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, _, err := s1.Report(1, Report{Checks: []Check{{"a", true}}, DurationMs: 7, Metrics: emptyObject}, now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s1.Report(2, Report{Checks: []Check{{"b", false}}, DurationMs: 8, Metrics: []byte(`{"k":[1]}`)}, now); err != nil {
		t.Fatal(err)
	}
	_ = s1.Close()
	s2, err := openSQLStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	lv, upd, err := s2.Levels()
	if err != nil {
		t.Fatal(err)
	}
	if *upd != "2026-01-02T03:04:05.000Z" || lv[0].Status != StBestanden || lv[1].Status != StFehlgeschlagen || lv[2].Status != StGesperrt || string(lv[1].Metrics) != `{"k":[1]}` {
		t.Fatalf("after reopen: %+v", lv[:3])
	}
	hist, _ := s2.History(2, 50)
	if len(hist) != 1 || hist[0].Status != StFehlgeschlagen {
		t.Fatalf("history %+v", hist)
	}
	var v int
	_ = s2.db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != 1 {
		t.Fatal("user_version")
	}
	want := map[string]string{
		"levels":  "level,status,checked_at,duration_ms,checks,metrics",
		"reports": "id,level,status,checked_at,duration_ms,checks,metrics",
		"meta":    "key,value",
	}
	for tbl, cols := range want {
		if got := columns(t, s2.db, tbl); got != cols {
			t.Errorf("%s: %s", tbl, got)
		}
	}
}

func columns(t *testing.T, db *sql.DB, tbl string) string {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, tbl))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return strings.Join(names, ",")
}

func TestConcurrentHistoryCount(t *testing.T) {
	_, h := newTestServer(t)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if rec := post(h, 1, fmt.Sprintf(`{"checks":[{"name":"c","ok":true}],"durationMs":%d}`, i)); rec.Code != 200 {
				t.Errorf("code %d %s", rec.Code, rec.Body.String())
			}
		}(i)
	}
	wg.Wait()
	var hist History
	mustJSON(t, do(h, "GET", "/api/levels/1/history?limit=500", "", "").Body.Bytes(), &hist)
	if len(hist.Entries) != 100 {
		t.Fatalf("got %d entries", len(hist.Entries))
	}
}
