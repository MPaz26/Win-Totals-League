# Everything runs in Docker, so the only local requirement is Docker itself.

PG_IMAGE   := postgres:17-alpine
NODE_IMAGE := node:24-alpine
TEST_DB    := nba-wins-league-test-db

.PHONY: dev prod-preview check test-db standings standings-dry

dev:
	docker compose -f compose.dev.yaml up --build web

prod-preview:
	docker compose -f compose.dev.yaml --profile prod up --build web-prod

# Typecheck + lint the web app and typecheck the jobs.
check:
	docker run --rm -v "$(CURDIR)/web":/app -w /app $(NODE_IMAGE) sh -c 'npm ci --no-audit --no-fund && npm run typecheck && npm run lint'
	docker run --rm -v "$(CURDIR)/jobs":/app -w /app $(NODE_IMAGE) sh -c 'npm ci --no-audit --no-fund && npm run typecheck'

# Applies the migrations to a throwaway plain Postgres (with supabase_shim.sql standing in
# for Supabase's roles and auth schema) and runs the draft scenario. The pg_cron migration is
# skipped: plain Postgres doesn't ship pg_cron, and the test drives the backstop function directly.
test-db:
	@docker rm -f $(TEST_DB) >/dev/null 2>&1 || true
	@docker run -d --name $(TEST_DB) -e POSTGRES_PASSWORD=test -v "$(CURDIR)/supabase":/supabase:ro $(PG_IMAGE) >/dev/null
	@until docker exec $(TEST_DB) pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done
	@docker exec $(TEST_DB) sh -c ' \
	  set -e; run() { psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q -f "$$1"; }; \
	  run /supabase/tests/supabase_shim.sql; \
	  for f in /supabase/migrations/*.sql; do case "$$f" in *cron*) ;; *) run "$$f";; esac; done; \
	  run /supabase/tests/draft_test.sql' \
	; status=$$?; docker rm -f $(TEST_DB) >/dev/null; exit $$status

# Daily standings refresh, reading SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NBA_SEASON from .env.
standings:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env nba-wins-league-jobs

# Fetch and validate ESPN standings without writing anything (no credentials needed).
standings-dry:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm -e DRY_RUN=1 nba-wins-league-jobs
