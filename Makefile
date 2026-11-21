SHELL := /bin/bash

RUN_ID ?= lokal
GITHUB_REPO ?= specrun-lab/levelboard-$(RUN_ID)
LIVE_DOMAIN ?=
LIVE_URL ?= https://$(RUN_ID).$(LIVE_DOMAIN)
URL ?= http://127.0.0.1:8080
API_URL ?= http://127.0.0.1:8081

# höchstes gebautes Level (Standard für `make check` ohne .run/level)
MAX_LEVEL := 5

RUN := .run
DB := $(RUN)/levelboard.db

.PHONY: level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 \
	check down stop-backend restart-backend \
	_frontend _backend-build _vite _nginx _nginx-api _backend-start _wait-web _wait-api _wait-proxy _fresh-db _api-config

# ---------- Bausteine ----------

_frontend:
	@mkdir -p $(RUN)
	cd frontend && npm ci && npm run build

_backend-build:
	cd backend && go build -o bin/levelboard-backend .

_vite:
	@mkdir -p $(RUN)
	@cd frontend && { nohup node node_modules/vite/bin/vite.js preview </dev/null >../$(RUN)/frontend.log 2>&1 & echo $$! > ../$(RUN)/frontend.pid; }

_nginx:
	@mkdir -p $(RUN)/nginx-tmp
	nginx -p "$(CURDIR)/" -e $(RUN)/nginx-error.log -c frontend/nginx.conf

_nginx-api:
	@mkdir -p $(RUN)/nginx-tmp
	nginx -p "$(CURDIR)/" -e $(RUN)/nginx-error.log -c frontend/nginx-api.conf

_fresh-db:
	@rm -f $(DB) $(DB)-wal $(DB)-shm

_backend-start:
	@mkdir -p $(RUN)
	@LEVELBOARD_DB=$(DB) nohup backend/bin/levelboard-backend </dev/null >>$(RUN)/backend.log 2>&1 & echo $$! > $(RUN)/backend.pid

_api-config:
	@printf '{"source":"api"}\n' > frontend/dist/config.json

define wait_for
	ok=0; for i in $$(seq 1 120); do \
	  if curl -fsS -o /dev/null --max-time 2 "$(1)"; then ok=1; break; fi; sleep 0.5; \
	done; \
	if [ $$ok -ne 1 ]; then \
	  echo "Keine Antwort von $(1) innerhalb von 60 s"; \
	  for f in $(RUN)/*.log; do [ -f "$$f" ] && { echo "== $$f"; tail -n 50 "$$f"; }; done; \
	  exit 1; \
	fi
endef

_wait-web:
	@$(call wait_for,http://127.0.0.1:8080/)

_wait-api:
	@$(call wait_for,http://127.0.0.1:8081/api/health)

_wait-proxy:
	@$(call wait_for,http://127.0.0.1:8080/api/health)

# ---------- Levels ----------

level1:
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory _frontend
	@$(MAKE) --no-print-directory _vite
	@echo 1 > $(RUN)/level
	@$(MAKE) --no-print-directory _wait-web
	@echo "Levelboard läuft auf http://127.0.0.1:8080"

level2:
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory _frontend
	@$(MAKE) --no-print-directory _nginx
	@echo 2 > $(RUN)/level
	@$(MAKE) --no-print-directory _wait-web
	@echo "Levelboard läuft auf http://127.0.0.1:8080"

# gemeinsamer Ablauf für Level 3 und 4
define start_l3
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory _frontend
	@$(MAKE) --no-print-directory _backend-build
	@$(MAKE) --no-print-directory _nginx
	@$(MAKE) --no-print-directory _fresh-db
	@$(MAKE) --no-print-directory _backend-start
	@echo $(1) > $(RUN)/level
	@$(MAKE) --no-print-directory _wait-web
	@$(MAKE) --no-print-directory _wait-api
	@echo "Levelboard läuft auf http://127.0.0.1:8080"
	@echo "Backend läuft auf http://127.0.0.1:8081"
endef

level3:
	$(call start_l3,3)

level4:
	$(call start_l3,4)
	@echo "Datenbank: $(DB)"

# gemeinsamer Ablauf ab Level 5
define start_l5
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory _frontend
	@$(MAKE) --no-print-directory _backend-build
	@$(MAKE) --no-print-directory _nginx-api
	@$(MAKE) --no-print-directory _fresh-db
	@$(MAKE) --no-print-directory _backend-start
	@$(MAKE) --no-print-directory _api-config
	@echo $(1) > $(RUN)/level
	@$(MAKE) --no-print-directory _wait-proxy
	@echo "Levelboard läuft auf http://127.0.0.1:8080 (Quelle: Backend)"
	@echo "Backend läuft auf http://127.0.0.1:8081"
	@echo "Datenbank: $(DB)"
endef

level5:
	$(call start_l5,5)

level6:
	$(call start_l5,6)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"

level7:
	$(call start_l5,7)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"

level8:
	$(call start_l5,8)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"

level9:
	$(call start_l5,9)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"
	@echo "Live-Prüfung gegen $(LIVE_URL)"

level10:
	$(call start_l5,10)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"
	@echo "Live-Prüfung gegen $(LIVE_URL)"
	@echo "Abschlussbericht: $(LIVE_URL)"

# ---------- Prüfsuite ----------

check:
	@N=$$(cat $(RUN)/level 2>/dev/null || echo $(MAX_LEVEL)); \
	cd checks || exit 1; \
	if [ ! -d node_modules ]; then npm ci || exit 1; fi; \
	npx playwright install chromium || exit 1; \
	rm -f .out/loadtest.json; \
	files=""; levels=""; \
	for i in $$(seq 1 $$N); do files="$$files tests/level$$i.spec.ts"; levels="$$levels $$i"; done; \
	BASE_URL="$(URL)" API_URL="$(API_URL)" GITHUB_REPO="$(GITHUB_REPO)" LIVE_URL="$(LIVE_URL)" RUN_ID="$(RUN_ID)" \
	  npx playwright test $$files; tr=$$?; \
	rep=""; [ $$N -ge 5 ] && rep="REPORT_API=1"; \
	live=""; [ $$N -ge 9 ] && live="REPORT_LIVE=1"; \
	env GITHUB_REPO="$(GITHUB_REPO)" RUN_ID="$(RUN_ID)" API_URL="$(API_URL)" LIVE_URL="$(LIVE_URL)" $$rep $$live \
	  node write-results.mjs $$levels; wr=$$?; \
	lr=0; \
	if [ $$N -ge 10 ]; then \
	  if [ $$wr -eq 0 ]; then \
	    LIVE_URL="$(LIVE_URL)" RUN_ID="$(RUN_ID)" npx playwright test tests/live-report.spec.ts --reporter=list; lr=$$?; \
	  else lr=1; fi; \
	fi; \
	if [ $$tr -eq 0 ] && [ $$wr -eq 0 ] && [ $$lr -eq 0 ]; then exit 0; else exit 1; fi

# ---------- Stoppen ----------

define stop_pid
	if [ -f $(1) ]; then \
	  pid=$$(cat $(1)); \
	  if [ -n "$$pid" ] && kill -0 $$pid 2>/dev/null; then \
	    kill $$pid 2>/dev/null; \
	    for i in $$(seq 1 50); do kill -0 $$pid 2>/dev/null || break; sleep 0.1; done; \
	    kill -0 $$pid 2>/dev/null && kill -9 $$pid 2>/dev/null; \
	  fi; \
	  rm -f $(1); \
	fi; true
endef

stop-backend:
	@$(call stop_pid,$(RUN)/backend.pid)

restart-backend:
	@$(call stop_pid,$(RUN)/backend.pid)
	@$(MAKE) --no-print-directory _backend-start
	@$(MAKE) --no-print-directory _wait-api
	@echo "Backend neu gestartet (Datenbank erhalten)"

down:
	@$(call stop_pid,$(RUN)/frontend.pid)
	@$(call stop_pid,$(RUN)/nginx.pid)
	@$(call stop_pid,$(RUN)/backend.pid)
	@rm -f $(RUN)/level
