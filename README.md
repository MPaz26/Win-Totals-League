# Win Totals League

Draft all 30 NBA teams among friends. Each owner's score is the combined regular-season wins of the teams they drafted.

- **web/**: React + Vite + Tailwind single-page app, hosted on GitHub Pages.
- **supabase/**: Postgres schema, row-level security, and the draft RPCs. Clients never write tables directly; every change goes through a `SECURITY DEFINER` function that checks the caller and locks the league row.
- **supabase/functions/send-push**: an Edge Function that sends Web Push notifications.
- **supabase/functions/update-scores**: an Edge Function that refreshes scores and standings from ESPN while games are on.
- **jobs/**: a daily job that pulls standings and game scores from ESPN into `team_standings` and `nba_games` (the safety net behind live scores), and a weekly recap email sent from a Gmail account. The ESPN parsing is shared with `update-scores`, in `supabase/functions/_shared/espn.mts`.

## How a league works

1. Sign in with Google (or an email link) and pick a username.
2. Create a league and share its invite link. Anyone with the link can join until the draft starts (2–30 members).
3. The commissioner sets the pick timer, snake vs. linear order, and random vs. manual order, then starts the draft.
4. The draft room updates live (Supabase Realtime). When the clock runs out, the best remaining team by last season's wins is picked automatically. Open browsers trigger this the moment time expires; a pg_cron job every 15 seconds is the backstop.
5. After the draft, the league page shows the standings, updated within minutes of each game ending.

## League Pass

A separate tool, not tied to any league, under **League Pass** in the header:

- **My rankings**: order all 30 teams by how much you want to watch them. Drag the handle (touch and keyboard work too) or use the ↑/↓/Top buttons, then save.
- **Games**: each night's games, scored 0–100 for you and sorted best first, with the reasons behind each score. After a game ends (or 2.5 hours after tipoff), rate it 1–5 stars. Final scores are hidden behind a tap unless you turn that off on your profile.
- **Game threads**: tap a game's comment button to talk about it. Anyone signed in can read, post and reply (one level of replies), and delete their own comments. Comments update live. If you hide scores, comments on a game that has started stay behind a tap too, since they can give the result away. A reply notifies the thread's starter and everyone else who has replied (turn it off on your profile); notifications leave out the reply's text if you hide scores and the game has started.
- **Community**: everyone's average rank for each team, and the average rating of its games.

The score (`private.lp_scores`, last redefined in `supabase/migrations/20261019000000_watch_score_rank_weight.sql`) weighs how high you rank both teams (75%), how close together you rank them (10%), and how good and evenly matched their records are (15%), then nudges it up or down by up to 10 points for your recent ratings of their games and 5 for everyone's. The weights are at the top of that function.

If you've ranked your teams and turned on notifications, you get the night's best game at 21:00 UTC, and an alert about 30 minutes before any game you'd score 80+. Both can be turned off on your profile. They're sent by pg_cron (`20261018000100_league_pass_cron.sql`).

The schedule is stored in `nba_games`. Load the whole season once, by running the Standings workflow by hand with **games_mode: season** (or `make games-backfill`). After that, the daily run only fetches the last three days through tomorrow: it updates scores and statuses, and adds games that weren't known yet (NBA Cup knockouts, playoffs). The app reads from the database only and never calls ESPN.

### Live scores

During games, scores and standings update every 5 minutes. A `pg_cron` job checks the stored schedule and only calls the `update-scores` Edge Function when a game is on (or tips off within 10 minutes), or when a game went final and standings haven't caught up yet. That run fetches just the scoreboard for that day (one ESPN request) and, as games go final, the standings. Off nights and daytime make no ESPN requests; a busy night is roughly 70 scoreboard and a dozen standings requests. Open pages refresh through Realtime. The daily job still runs as the safety net and writes the history snapshots the weekly recap uses. Live scores need the **Edge functions** workflow (below) to have run.

Username, notification and email settings are on the profile page (the avatar at the top right). The **Get the app** button in the header explains how to add the site to a phone's Home Screen; on iPhone that's required for notifications.

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
| `make test-db` | Run the migrations and the draft and League Pass scenarios (`supabase/tests/*_test.sql`) on a throwaway Postgres |
| `make standings-dry` | Fetch and validate ESPN standings without writing anything |
| `make standings` | Refresh standings in the database from `.env` |
| `make games-dry` | Fetch and validate recent ESPN games without writing (`MODE=season make games-dry` for the whole schedule) |
| `make games` | Update the last three days' games through tomorrow in the database from `.env` |
| `make games-backfill` | Load the whole season's schedule into `nba_games` (once per season) |
| `make recap-dry` | Build the weekly recap emails without sending; HTML previews land in `recap-preview/` |
| `make recap-test TO=you@example.com` | Send one sample recap per league to that address only |
| `make recap` | Send the weekly recap to every opted-in member |
| `make vapid-keys` | Generate a key pair for push notifications |

### Weekly recap email

Recaps go out over Gmail SMTP, so no domain is needed. Gmail allows about 500 recipients a day, plenty for a few leagues. Use an account dedicated to this, since its app password ends up in GitHub secrets.

1. In that Google account, turn on 2-Step Verification (Security), then search the account settings for **App passwords** and create one.
2. Put `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `APP_URL` (your Pages URL) in `.env`.
3. `make recap-dry` to check the output, then `make recap-test TO=you@example.com`.

Members can turn recaps off from their profile page, or with the unsubscribe link in each email (no sign-in needed). Re-running the job never double-sends: every email sent is logged in `recap_sends`, so a re-run only retries the failures.

### Push notifications

Members who turn on notifications (Profile → Notifications) get one when they're on the clock in a draft, and a one-line recap on Mondays. On iPhone and iPad (iOS 16.4+) this only works after adding the app to the Home Screen and opening it from there; Android and desktop browsers work in a tab.

How it fits together: each device's subscription is saved in `push_subscriptions`. When `leagues.current_pick` changes, a trigger queues a call (via `pg_net`) to the `send-push` Edge Function, which encrypts and sends the push and deletes subscriptions the push service says are gone. The weekly recap job calls the same function. Nothing is sent until `private.push_config` is filled in, which the workflow below does.

1. `make vapid-keys` and keep both keys. Make a push secret: `openssl rand -hex 32`.
2. Create a Supabase access token (Account → Access Tokens).
3. Add repository **variables** `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`mailto:you@example.com`), `SUPABASE_PROJECT_REF`, and **secrets** `VAPID_PRIVATE_KEY`, `PUSH_SECRET`, `SUPABASE_ACCESS_TOKEN`.
4. Run **Migrate database**, then **Edge functions** from the Actions tab, then let CI redeploy the site (it bakes in the public key).
5. On your phone: Get the app → open it from the Home Screen → Profile → turn on notifications → **Send a test**.

For local dev, put `VITE_VAPID_PUBLIC_KEY` and `PUSH_SECRET` in `.env`. Keep the same keys afterwards: changing the VAPID pair invalidates every saved subscription, and everyone has to turn notifications on again.

## Deploying (GitHub)

Five workflows live in `.github/workflows/`:

- **CI** checks every push and PR, and deploys `main` to GitHub Pages (Settings → Pages → Source: **GitHub Actions**).
- **Standings** runs daily at 11:00 UTC (GitHub often starts it hours late). It refreshes standings, then League Pass games and scores, catching any corrections the live updates missed. If a step fails (ESPN is down, or the data looks wrong), that step writes nothing, so the last good numbers stay. Run it by hand with **games_mode: season** to load a season's schedule.
- **Weekly recap** emails every member of a drafted league on Mondays at 14:00 UTC: league standings, their teams, and wins gained since the snapshot a week earlier. It skips the preseason and weeks with no games. Run it by hand to send a test to one address, or as a dry run.
- **Migrate database** applies new migrations; run it by hand from the Actions tab.
- **Edge functions** deploys `send-push` and `update-scores` and their secrets, and points the database at them. It runs when a function changes, or by hand. Until it has run, there are no notifications and scores only update daily.

In Settings → Secrets and variables → Actions, add **variables** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `APP_URL`, `GMAIL_USER` and **secrets** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GMAIL_APP_PASSWORD` (plus the push notification ones above). Free accounts can only use Pages on public repos; that's fine, since no secrets are in the code.

If ESPN corrects a result and a team's win total goes down, the job refuses to write. Re-run it with `ALLOW_WIN_DECREASE=1`.

## Each new season

- Set `NBA_SEASON` (ESPN uses the year the season ends: 2027 = 2026-27), and `SEASON` in `web/src/lib/queries.ts`.
- Update `nba_teams.last_season_wins` (used for autopicks) in a new migration.
- Once the schedule is out, run the Standings workflow with **games_mode: season** to load League Pass games.
