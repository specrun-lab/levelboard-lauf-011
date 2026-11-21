package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const maxBody = 65536

// Server bündelt die Handler.
type Server struct {
	store  Store
	runID  string
	commit *string
	now    func() time.Time
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		code = http.StatusInternalServerError
		b = []byte(`{"error":"interner Fehler"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(b)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
}

var levelRe = regexp.MustCompile(`^(10|[1-9])$`)

func levelParam(r *http.Request) (int, bool) {
	s := r.PathValue("n")
	if !levelRe.MatchString(s) {
		return 0, false
	}
	n, _ := strconv.Atoi(s)
	return n, true
}

// Routes liefert den Router.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/levels", s.levels)
	mux.HandleFunc("/api/levels/{n}", s.level)
	mux.HandleFunc("/api/levels/{n}/result", s.result)
	mux.HandleFunc("/api/levels/{n}/history", s.history)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "nicht gefunden")
	})
	return logRequests(mux)
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(code int) {
	w.code = code
	w.ResponseWriter.WriteHeader(code)
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		h.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.RequestURI(), sw.code, time.Since(start).Round(time.Microsecond))
	})
}

func (s *Server) results(levels []Level, updatedAt *string) Results {
	return Results{Run: Run{ID: s.runID, Version: Version, Commit: s.commit, UpdatedAt: updatedAt}, Levels: levels}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	writeJSON(w, 200, struct {
		Status  string  `json:"status"`
		Version string  `json:"version"`
		Commit  *string `json:"commit"`
	}{"ok", Version, s.commit})
}

func (s *Server) levels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	lv, upd, err := s.store.Levels()
	if err != nil {
		writeError(w, 500, "interner Fehler")
		return
	}
	writeJSON(w, 200, s.results(lv, upd))
}

func (s *Server) level(w http.ResponseWriter, r *http.Request) {
	n, ok := levelParam(r)
	if !ok {
		writeError(w, 404, "unbekanntes Level")
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	l, err := s.store.Level(n)
	if err != nil {
		writeError(w, 500, "interner Fehler")
		return
	}
	writeJSON(w, 200, l)
}

func (s *Server) result(w http.ResponseWriter, r *http.Request) {
	n, ok := levelParam(r)
	if !ok {
		writeError(w, 404, "unbekanntes Level")
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return
	}
	if r.ContentLength > maxBody {
		writeError(w, http.StatusRequestEntityTooLarge, "Body größer als 64 KB")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		writeError(w, 400, "Body nicht lesbar")
		return
	}
	if len(body) > maxBody {
		writeError(w, http.StatusRequestEntityTooLarge, "Body größer als 64 KB")
		return
	}
	rep, msg := ParseReport(body)
	if msg != "" {
		writeError(w, 400, msg)
		return
	}
	lv, upd, err := s.store.Report(n, rep, s.now())
	if errors.Is(err, ErrConflict) {
		writeError(w, http.StatusConflict, ErrConflict.Error())
		return
	}
	if err != nil {
		log.Printf("Meldung fehlgeschlagen: %v", err)
		writeError(w, 500, "interner Fehler")
		return
	}
	writeJSON(w, 200, s.results(lv, upd))
}

func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	n, ok := levelParam(r)
	if !ok {
		writeError(w, 404, "unbekanntes Level")
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	limit := 50
	if q := r.URL.Query(); q.Has("limit") {
		v := q.Get("limit")
		l, err := strconv.Atoi(v)
		if err != nil || !regexp.MustCompile(`^[0-9]+$`).MatchString(v) || l < 1 || l > 500 {
			writeError(w, 400, "ungültiges limit (1 bis 500)")
			return
		}
		limit = l
	}
	entries, err := s.store.History(n, limit)
	if err != nil {
		writeError(w, 500, "interner Fehler")
		return
	}
	if entries == nil {
		entries = []HistoryEntry{}
	}
	writeJSON(w, 200, History{Level: n, Entries: entries})
}

var intRe = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

// ParseReport prüft den Body streng. Bei Fehler ist msg nicht leer.
func ParseReport(body []byte) (Report, string) {
	var rep Report
	dec := json.NewDecoder(bytes.NewReader(body))
	var top map[string]json.RawMessage
	if err := dec.Decode(&top); err != nil || top == nil {
		return rep, "ungültiges JSON"
	}
	if _, err := dec.Token(); err != io.EOF {
		return rep, "ungültiges JSON"
	}
	for k := range top {
		if k != "checks" && k != "durationMs" && k != "metrics" {
			return rep, "unbekanntes Feld: " + k
		}
	}
	rawChecks, ok := top["checks"]
	if !ok {
		return rep, "checks fehlt"
	}
	var items []json.RawMessage
	if err := json.Unmarshal(rawChecks, &items); err != nil || items == nil {
		return rep, "checks muss ein Array sein"
	}
	if len(items) < 1 || len(items) > 100 {
		return rep, "checks muss 1 bis 100 Einträge haben"
	}
	rep.Checks = make([]Check, 0, len(items))
	for _, it := range items {
		var m map[string]json.RawMessage
		if err := json.Unmarshal(it, &m); err != nil || m == nil {
			return rep, "Check muss ein Objekt sein"
		}
		for k := range m {
			if k != "name" && k != "ok" {
				return rep, "unbekanntes Feld im Check: " + k
			}
		}
		rn, ok1 := m["name"]
		ro, ok2 := m["ok"]
		if !ok1 || !ok2 {
			return rep, "Check braucht name und ok"
		}
		var name string
		if string(bytes.TrimSpace(rn)) == "null" || json.Unmarshal(rn, &name) != nil || name == "" {
			return rep, "name muss ein nicht leerer Text sein"
		}
		t := string(bytes.TrimSpace(ro))
		if t != "true" && t != "false" {
			return rep, "ok muss true oder false sein"
		}
		rep.Checks = append(rep.Checks, Check{Name: name, OK: t == "true"})
	}
	rd, ok := top["durationMs"]
	if !ok {
		return rep, "durationMs fehlt"
	}
	ds := string(bytes.TrimSpace(rd))
	if !intRe.MatchString(ds) {
		return rep, "durationMs muss eine ganze Zahl ≥ 0 sein"
	}
	d, err := strconv.ParseInt(ds, 10, 64)
	if err != nil {
		return rep, "durationMs ist zu groß"
	}
	rep.DurationMs = d
	rep.Metrics = emptyObject
	if rm, ok := top["metrics"]; ok {
		t := bytes.TrimSpace(rm)
		if string(t) != "null" {
			var mo map[string]json.RawMessage
			if len(t) == 0 || t[0] != '{' || json.Unmarshal(t, &mo) != nil {
				return rep, "metrics muss ein Objekt sein"
			}
			var buf bytes.Buffer
			if err := json.Compact(&buf, t); err != nil {
				return rep, "metrics muss ein Objekt sein"
			}
			rep.Metrics = json.RawMessage(buf.Bytes())
		}
	}
	return rep, ""
}
