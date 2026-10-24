// NBA schedule and scores for League Pass (scheduled GitHub Actions workflow, or `make games`).
//
// The schedule is loaded into nba_games once per season and stays there; the app only ever
// reads it from the database.
//   MODE=season   the whole season, October through June (~1,230 games). Run once after the
//                 schedule is out, and again only if the NBA reshuffles it. Safe to repeat.
//   MODE=recent   (default, daily) yesterday's finals and anything just added or moved: the
//                 last 3 days through tomorrow. Corrects scores and statuses, picks up new
//                 playoff games, and leaves the rest of the stored schedule alone. Live scores
//                 come from the update-scores Edge Function; this is the safety net.
// ESPN's scoreboard only answers one day per request, so a season load is ~270 small requests.
// Any surprise exits non-zero without writing.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  required unless DRY_RUN=1
//   NBA_SEASON    ESPN season year, i.e. the year the season ends (2027 = 2026-27)
//   MODE          recent (default) | season
//   DRY_RUN=1     fetch + validate + print, write nothing

import { createClient } from "@supabase/supabase-js";
import { days, fetchGames, nbaDate } from "../../supabase/functions/_shared/espn.mts";
import { requireEnv } from "./lib.ts";

const SEASON = Number(process.env.NBA_SEASON ?? "2027");
const MODE = process.env.MODE ?? "recent";
const DRY_RUN = process.env.DRY_RUN === "1";

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

async function main() {
  let dates: string[];
  if (MODE === "season") dates = days(`${SEASON - 1}-10-01`, `${SEASON}-06-30`);
  else if (MODE === "recent") dates = days(nbaDate(-3), nbaDate(1));
  else throw new Error(`MODE must be recent or season, got ${MODE}`);

  console.log(`ESPN ${SEASON} ${MODE}: ${dates[0]} to ${dates.at(-1)} (${dates.length} days)`);
  const games = await fetchGames(SEASON, dates);
  const byStatus = countBy(games, (g) => g.status);
  console.log(`${games.length} games: ${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
  if (MODE === "season") {
    console.table(countBy(games, (g) => g.game_date.slice(0, 7)));
  } else {
    console.table(
      games.map((g) => ({
        date: g.game_date,
        game: `${g.away_team_id} @ ${g.home_team_id}`,
        status: g.status,
        score: g.home_score === null ? "" : `${g.away_score}-${g.home_score}`,
        tv: g.national_tv ?? "",
      })),
    );
  }

  if (DRY_RUN) {
    console.log("DRY_RUN=1, nothing written.");
    return;
  }

  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const now = new Date().toISOString();
  for (let i = 0; i < games.length; i += 500) {
    const { error } = await db.from("nba_games").upsert(games.slice(i, i + 500).map((g) => ({ ...g, updated_at: now })));
    if (error) throw error;
  }
  console.log(`Wrote ${games.length} games.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
