# Everything runs in Docker, so the only local requirement is Docker itself.

PG_IMAGE   := postgres:17-alpine
NODE_IMAGE := node:24-alpine
TEST_DB    := nba-wins-league-test-db

.PHONY: dev prod-preview check test-db standings standings-dry games games-dry games-backfill recap recap-dry recap-test vapid-keys

dev:
	docker compose -f compose.dev.yaml up --build web

prod-preview:
	docker compose -f compose.dev.yaml --profile prod up --build web-prod

# Typecheck + lint the web app and typecheck the jobs.
check:
	docker run --rm -v "$(CURDIR)/web":/app -w /app $(NODE_IMAGE) sh -c 'npm ci --no-audit --no-fund && npm run typecheck && npm run lint'
	docker run --rm -v "$(CURDIR)/jobs":/app -w /app $(NODE_IMAGE) sh -c 'npm ci --no-audit --no-fund && npm run typecheck'

# Applies the migrations to a throwaway plain Postgres (with supabase_shim.sql standing in
# for Supabase's roles and auth schema) and runs the draft and League Pass scenarios. The pg_cron and pg_net migrations
# are skipped: plain Postgres ships neither. The test drives the autopick backstop directly, and the
# shim's net.http_post records push requests instead of sending them.
test-db:
	@docker rm -f $(TEST_DB) >/dev/null 2>&1 || true
	@docker run -d --name $(TEST_DB) -e POSTGRES_PASSWORD=test -v "$(CURDIR)/supabase":/supabase:ro $(PG_IMAGE) >/dev/null
	@until docker exec $(TEST_DB) pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done
	@docker exec $(TEST_DB) sh -c ' \
	  set -e; run() { psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q -f "$$1"; }; \
	  run /supabase/tests/supabase_shim.sql; \
	  for f in /supabase/migrations/*.sql; do case "$$f" in *cron*|*pg_net*) ;; *) run "$$f";; esac; done; \
	  run /supabase/tests/draft_test.sql; \
	  run /supabase/tests/league_pass_test.sql' \
	; status=$$?; docker rm -f $(TEST_DB) >/dev/null; exit $$status

# Daily standings refresh, reading SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NBA_SEASON from .env.
standings:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env nba-wins-league-jobs

# Fetch and validate ESPN standings without writing anything (no credentials needed).
standings-dry:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm -e DRY_RUN=1 nba-wins-league-jobs

# League Pass schedule and scores. `games` is the daily run (last 3 days through tomorrow);
# `games-backfill` loads the whole season's schedule, once per season. MODE=season make games-dry
# previews the backfill without credentials.
games:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env nba-wins-league-jobs node src/update-games.ts

games-dry:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm -e DRY_RUN=1 -e MODE=$${MODE:-recent} nba-wins-league-jobs node src/update-games.ts

games-backfill:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env -e MODE=season nba-wins-league-jobs node src/update-games.ts

# Weekly recap emails, reading Supabase, GMAIL_USER, GMAIL_APP_PASSWORD and APP_URL from .env.
recap:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env nba-wins-league-jobs node src/weekly-recap.ts

# Build the recaps without sending; each email's HTML lands in recap-preview/.
recap-dry:
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env -e DRY_RUN=1 -e PREVIEW_DIR=/out -v "$(CURDIR)/recap-preview":/out nba-wins-league-jobs node src/weekly-recap.ts

# Send one sample recap per league to TO=you@example.com (FORCE=1 so it works preseason or in a quiet week).
recap-test:
	@test -n "$(TO)" || (echo "usage: make recap-test TO=you@example.com" && exit 1)
	docker build -q -t nba-wins-league-jobs jobs >/dev/null
	docker run --rm --env-file .env -e TEST_TO="$(TO)" -e FORCE=1 nba-wins-league-jobs node src/weekly-recap.ts

# A new VAPID key pair for push notifications (see README: Push notifications).
vapid-keys:
	docker run --rm $(NODE_IMAGE) npx --yes web-push@3.6.7 generate-vapid-keys
