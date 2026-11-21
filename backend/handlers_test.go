package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	st := newTestStore(t)
	s := &Server{store: st, runID: "test", now: func() time.Time { return time.Date(2026, 11, 21, 9, 14, 0, 0, time.UTC) }}
	return s, s.Routes()
}

func do(h http.Handler, method, path, ctype, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func post(h http.Handler, n int, body string) *httptest.ResponseRecorder {
	return do(h, "POST", fmt.Sprintf("/api/levels/%d/result", n), "application/json", body)
}

const okBody = `{"checks":[{"name":"a","ok":true}],"durationMs":10}`
const failBody = `{"checks":[{"name":"a","ok":false}],"durationMs":5}`

func decodeResults(t *testing.T, rec *httptest.ResponseRecorder) Results {
	t.Helper()
	var r Results
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		t.Fatalf("JSON: %v (%s)", err, rec.Body.String())
	}
	return r
}

func TestHealth(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "GET", "/api/health", "", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != `{"status":"ok","version":"0.1.0","commit":null}` {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestStartState(t *testing.T) {
	_, h := newTestServer(t)
	r := decodeResults(t, do(h, "GET", "/api/levels", "", ""))
	if r.Run.ID != "test" || r.Run.Version != "0.1.0" || r.Run.UpdatedAt != nil || r.Run.Commit != nil {
		t.Fatalf("run %+v", r.Run)
	}
	if len(r.Levels) != 10 {
		t.Fatal("not 10 levels")
	}
	for i, l := range r.Levels {
		if l.Level != i+1 || l.Status != StOffen || l.Title != Titles[i] || l.CheckedAt != nil || len(l.Checks) != 0 || string(l.Metrics) != "{}" {
			t.Fatalf("level %+v", l)
		}
	}
}

func TestReportPassAndFail(t *testing.T) {
	_, h := newTestServer(t)
	rec := post(h, 1, okBody)
	if rec.Code != 200 {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	r := decodeResults(t, rec)
	if r.Levels[0].Status != StBestanden || *r.Levels[0].CheckedAt != "2026-11-21T09:14:00.000Z" || *r.Levels[0].DurationMs != 10 {
		t.Fatalf("level1 %+v", r.Levels[0])
	}
	if *r.Run.UpdatedAt != "2026-11-21T09:14:00.000Z" {
		t.Fatal("updatedAt")
	}
	for _, l := range r.Levels[1:] {
		if l.Status != StOffen {
			t.Fatalf("expected offen: %+v", l)
		}
	}
	r = decodeResults(t, post(h, 2, `{"checks":[{"name":"x","ok":true}],"durationMs":3,"metrics":{"a":1}}`))
	if r.Levels[1].Status != StBestanden || string(r.Levels[1].Metrics) != `{"a":1}` {
		t.Fatalf("level2 %+v", r.Levels[1])
	}
	r = decodeResults(t, post(h, 1, failBody))
	if r.Levels[0].Status != StFehlgeschlagen {
		t.Fatal("level1 not failed")
	}
	for _, l := range r.Levels[1:] {
		if l.Status != StGesperrt || l.CheckedAt != nil || l.DurationMs != nil || len(l.Checks) != 0 || string(l.Metrics) != "{}" {
			t.Fatalf("expected gesperrt: %+v", l)
		}
	}
	rec = post(h, 2, okBody)
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "error") {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
	r = decodeResults(t, do(h, "GET", "/api/levels", "", ""))
	if r.Levels[1].Status != StGesperrt {
		t.Fatal("409 changed state")
	}
}

func TestBadRequests(t *testing.T) {
	_, h := newTestServer(t)
	bad := []string{
		`{kaputt`, ``, `[]`, `null`, `{}`,
		`{"durationMs":1}`,
		`{"checks":[],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}]}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1.5}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":-1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":"1"}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":null}`,
		`{"checks":[{"name":"","ok":true}],"durationMs":1}`,
		`{"checks":[{"name":null,"ok":true}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":null}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":"true"}],"durationMs":1}`,
		`{"checks":[{"name":"a"}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true,"x":1}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"extra":1}`,
		`{"Checks":[{"name":"a","ok":true}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"metrics":[]}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"metrics":5}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1} {}`,
	}
	many := make([]string, 101)
	for i := range many {
		many[i] = `{"name":"a","ok":true}`
	}
	bad = append(bad, `{"checks":[`+strings.Join(many, ",")+`],"durationMs":1}`)
	for _, b := range bad {
		rec := post(h, 1, b)
		if rec.Code != 400 || rec.Header().Get("Content-Type") != "application/json" || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("body %q: got %d %s", b, rec.Code, rec.Body.String())
		}
	}
	if rec := post(h, 1, `{"checks":[{"name":"a","ok":true}],"durationMs":0,"metrics":null}`); rec.Code != 200 {
		t.Errorf("metrics null should be ok: %d", rec.Code)
	}
}

func TestErrorOrder(t *testing.T) {
	_, h := newTestServer(t)
	cases := []struct {
		method, path, ctype, body string
		code                      int
		allow                     string
	}{
		{"GET", "/api/levels/0", "", "", 404, ""},
		{"GET", "/api/levels/11", "", "", 404, ""},
		{"GET", "/api/levels/abc", "", "", 404, ""},
		{"GET", "/api/levels/01", "", "", 404, ""},
		{"GET", "/api/unbekannt", "", "", 404, ""},
		{"GET", "/", "", "", 404, ""},
		{"POST", "/api/levels/0/result", "text/plain", "x", 404, ""},
		{"GET", "/api/levels/1/result", "", "", 405, "POST"},
		{"DELETE", "/api/levels", "", "", 405, "GET"},
		{"POST", "/api/health", "", "", 405, "GET"},
		{"PUT", "/api/levels/3", "", "", 405, "GET"},
		{"POST", "/api/levels/1/history", "", "", 405, "GET"},
		{"POST", "/api/levels/1/result", "text/plain", okBody, 415, ""},
		{"POST", "/api/levels/1/result", "", okBody, 415, ""},
		{"POST", "/api/levels/1/result", "application/json; charset=utf-8", okBody, 200, ""},
		{"POST", "/api/levels/1/result", "application/json", `{"checks":[{"name":"` + strings.Repeat("x", 70000) + `","ok":true}],"durationMs":1}`, 413, ""},
		{"POST", "/api/levels/3/result", "application/json", `{kaputt`, 400, ""},
		{"POST", "/api/levels/3/result", "application/json", okBody, 409, ""},
	}
	for _, c := range cases {
		rec := do(h, c.method, c.path, c.ctype, c.body)
		if rec.Code != c.code {
			t.Errorf("%s %s: got %d want %d", c.method, c.path, rec.Code, c.code)
		}
		if rec.Header().Get("Content-Type") != "application/json" {
			t.Errorf("%s %s: content-type %q", c.method, c.path, rec.Header().Get("Content-Type"))
		}
		if c.allow != "" && rec.Header().Get("Allow") != c.allow {
			t.Errorf("%s %s: allow %q", c.method, c.path, rec.Header().Get("Allow"))
		}
	}
}

func TestSingleLevel(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "GET", "/api/levels/10", "", "")
	var l Level
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil || l.Level != 10 || l.Title != "Metriken veröffentlicht" {
		t.Fatalf("level 10: %s", rec.Body.String())
	}
}

func TestConcurrentReports(t *testing.T) {
	_, h := newTestServer(t)
	if rec := post(h, 1, okBody); rec.Code != 200 {
		t.Fatal("setup")
	}
	var wg sync.WaitGroup
	codes := make(chan int, 100)
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			n := 1 + i%3
			body := okBody
			if i%7 == 0 {
				body = failBody
			}
			codes <- post(h, n, body).Code
		}(i)
	}
	wg.Wait()
	close(codes)
	for c := range codes {
		if c != 200 && c != 409 {
			t.Fatalf("unexpected code %d", c)
		}
	}
	r := decodeResults(t, do(h, "GET", "/api/levels", "", ""))
	failed := false
	for _, l := range r.Levels {
		if failed && l.Status != StGesperrt {
			t.Fatalf("inconsistent: %+v", r.Levels)
		}
		if l.Status == StFehlgeschlagen {
			failed = true
		}
	}
}

func mustJSON(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("JSON: %v (%s)", err, b)
	}
}
