package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetOutput(os.Stdout)
	addr := env("LEVELBOARD_ADDR", "127.0.0.1:8081")
	var commit *string
	if c := os.Getenv("LEVELBOARD_COMMIT"); c != "" {
		commit = &c
	}
	store, err := openStore()
	if err != nil {
		log.Fatalf("Speicher nicht verfügbar: %v", err)
	}
	srv := &Server{store: store, runID: env("RUN_ID", "lokal"), commit: commit, now: time.Now}
	hs := &http.Server{Addr: addr, Handler: srv.Routes(), ReadHeaderTimeout: 10 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	errCh := make(chan error, 1)
	go func() {
		log.Printf("Levelboard-Backend lauscht auf %s", addr)
		if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()
	select {
	case err := <-errCh:
		if err != nil {
			log.Fatalf("Server-Fehler: %v", err)
		}
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := hs.Shutdown(shutdownCtx); err != nil {
		log.Printf("Shutdown: %v", err)
	}
	if err := store.Close(); err != nil {
		log.Printf("Schließen: %v", err)
	}
	log.Printf("beendet")
}

func openStore() (Store, error) {
	return openSQLStore(env("LEVELBOARD_DB", ".run/levelboard.db"))
}
