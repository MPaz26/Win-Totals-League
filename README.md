# Win Totals League

Draft all 30 NBA teams among friends. Each owner's score is the combined regular-season wins of the teams they drafted.

- **web/**: React + Vite + Tailwind single-page app, hosted on GitHub Pages.
- **supabase/**: Postgres schema, row-level security, and the draft RPCs. Clients never write tables directly; every change goes through a `SECURITY DEFINER` function that checks the caller and locks the league row.
- **jobs/**: a daily job that pulls standings from ESPN into `team_standings`.

## How a league works

1. Sign in with Google (or an email link) and pick a username.
2. Create a league and share its invite link. Anyone with the link can join until the draft starts (2–30 members).
3. The commissioner sets the pick timer, snake vs. linear order, and random vs. manual order, then starts the draft.
4. The draft room updates live (Supabase Realtime). When the clock runs out, the best remaining team by last season's wins is picked automatically. Open browsers trigger this the moment time expires; a pg_cron job every 15 seconds is the backstop.
5. After the draft, the league page shows the standings, updated daily.

## Setup

You only need Docker locally.

1. Create a Supabase project, then apply the migrations: `supabase db push`, or run the **Migrate database** workflow from the Actions tab.
2. In Supabase → Authentication → URL Configuration, set the Site URL to your Pages URL (e.g. `https://<user>.github.io/win-totals-league/`) and add it with `**` appended to the redirect URLs, along with `http://localhost:5173/**` for local dev. Without it, sign-in links send people back to the wrong place.
3. Enable Google sign-in: create an OAuth client in Google Cloud (redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`), then paste its ID and secret into Supabase → Authentication → Sign In / Providers → Google.
4. `cp .env.example .env` and fill it in.

| Command | What it does |
| --- | --- |
| `make dev` | Dev server with hot reload on http://localhost:5173 |
| `make prod-preview` | Production build behind nginx on http://localhost:8080 |
| `make check` | Typecheck and lint the web app and the jobs |
| `make test-db` | Run the migrations and the draft scenario (`supabase/tests/draft_test.sql`) on a throwaway Postgres |
| `make standings-dry` | Fetch and validate ESPN standings without writing anything |
| `make standings` | Refresh standings in the database from `.env` |

## Deploying (GitHub)

Three workflows live in `.github/workflows/`:

- **CI** checks every push and PR, and deploys `main` to GitHub Pages (Settings → Pages → Source: **GitHub Actions**).
- **Standings** runs daily at 11:00 UTC. If it fails (ESPN is down, or the data looks wrong), nothing is written, so the scoreboard keeps the last good numbers.
- **Migrate database** applies new migrations; run it by hand from the Actions tab.

In Settings → Secrets and variables → Actions, add **variables** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` and **secrets** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Free accounts can only use Pages on public repos; that's fine, since no secrets are in the code.

If ESPN corrects a result and a team's win total goes down, the job refuses to write. Re-run it with `ALLOW_WIN_DECREASE=1`.

## Each new season

- Set `NBA_SEASON` (ESPN uses the year the season ends: 2027 = 2026-27), and `SEASON` in `web/src/lib/queries.ts`.
- Update `nba_teams.last_season_wins` (used for autopicks) in a new migration.
