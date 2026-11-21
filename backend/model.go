package main

import (
	"encoding/json"
	"errors"
	"time"
)

// Version ist die feste Version des Levelboards.
const Version = "0.1.0"

// Titles sind die festen Titel der 10 Levels.
var Titles = [10]string{
	"Statische Seite",
	"Webserver",
	"REST-Backend",
	"Datenbank",
	"Frontend + Backend",
	"Repo + CI",
	"Images in der Pipeline",
	"Deployment",
	"Live-Prüfung",
	"Metriken veröffentlicht",
}

// Status-Werte.
const (
	StOffen          = "offen"
	StBestanden      = "bestanden"
	StFehlgeschlagen = "fehlgeschlagen"
	StGesperrt       = "gesperrt"
)

// ErrConflict: ein niedrigeres Level ist nicht bestanden.
var ErrConflict = errors.New("ein niedrigeres Level ist nicht bestanden")

// Check ist ein einzelner Prüfpunkt.
type Check struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
}

// Level ist der Stand eines Levels.
type Level struct {
	Level      int             `json:"level"`
	Title      string          `json:"title"`
	Status     string          `json:"status"`
	CheckedAt  *string         `json:"checkedAt"`
	DurationMs *int64          `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

// Run beschreibt den Durchlauf.
type Run struct {
	ID        string  `json:"id"`
	Version   string  `json:"version"`
	Commit    *string `json:"commit"`
	UpdatedAt *string `json:"updatedAt"`
}

// Results ist der Gesamtstand (Format von results.json).
type Results struct {
	Run    Run     `json:"run"`
	Levels []Level `json:"levels"`
}

// Report ist eine gültige Meldung.
type Report struct {
	Checks     []Check
	DurationMs int64
	Metrics    json.RawMessage
}

// HistoryEntry ist ein Eintrag der Historie.
type HistoryEntry struct {
	ID         int64           `json:"id"`
	Status     string          `json:"status"`
	CheckedAt  string          `json:"checkedAt"`
	DurationMs int64           `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

// History ist die Antwort der Historie.
type History struct {
	Level   int            `json:"level"`
	Entries []HistoryEntry `json:"entries"`
}

// Store speichert den Stand.
type Store interface {
	Levels() ([]Level, *string, error)
	Level(n int) (Level, error)
	Report(n int, r Report, now time.Time) ([]Level, *string, error)
	History(n, limit int) ([]HistoryEntry, error)
	Close() error
}

// ISO formatiert wie JavaScript toISOString().
func ISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

var emptyObject = json.RawMessage(`{}`)

// InitialLevels liefert den Startzustand.
func InitialLevels() []Level {
	out := make([]Level, 10)
	for i := range out {
		out[i] = Level{Level: i + 1, Title: Titles[i], Status: StOffen, Checks: []Check{}, Metrics: emptyObject}
	}
	return out
}

// ReportStatus liefert den Status für eine Meldung.
func ReportStatus(checks []Check) string {
	for _, c := range checks {
		if !c.OK {
			return StFehlgeschlagen
		}
	}
	return StBestanden
}

// ApplyReport wendet die Regeln aus 04-api.md auf levels an (in place).
func ApplyReport(levels []Level, n int, r Report, ts string) error {
	for i := 0; i < n-1; i++ {
		if levels[i].Status != StBestanden {
			return ErrConflict
		}
	}
	st := ReportStatus(r.Checks)
	d := r.DurationMs
	t := ts
	levels[n-1] = Level{Level: n, Title: Titles[n-1], Status: st, CheckedAt: &t, DurationMs: &d, Checks: r.Checks, Metrics: r.Metrics}
	for i := n; i < 10; i++ {
		s := StOffen
		if st != StBestanden {
			s = StGesperrt
		}
		levels[i] = Level{Level: i + 1, Title: Titles[i], Status: s, Checks: []Check{}, Metrics: emptyObject}
	}
	return nil
}
