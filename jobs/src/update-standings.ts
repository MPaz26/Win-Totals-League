// Daily standings refresh (scheduled GitHub Actions workflow, or `make standings`). During games
// the update-scores Edge Function keeps team_standings current; this run is the safety net,
// and the only writer of the dated history rows the weekly recap compares against.
//
// Pulls regular-season W-L from ESPN, sanity-checks it, then upserts team_standings
// (what the scoreboard reads) and a dated row in team_standings_history.
// Any surprise exits non-zero without writing, so the scoreboard keeps the last
// good numbers and the failed workflow run sends an email.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  required unless DRY_RUN=1
//   NBA_SEASON          ESPN season year, i.e. the year the season ends (2027 = 2026-27)
//   DRY_RUN=1           fetch + validate + print, write nothing
//   ALLOW_WIN_DECREASE=1  accept a team's wins going down (ESPN correction)

import { createClient } from "@supabase/supabase-js";
import { fetchStandings, nbaDate } from "../../supabase/functions/_shared/espn.mts";
import { requireEnv } from "./lib.ts";

const SEASON = Number(process.env.NBA_SEASON ?? "2027");
const DRY_RUN = process.env.DRY_RUN === "1";
const ALLOW_WIN_DECREASE = process.env.ALLOW_WIN_DECREASE === "1";

async function main() {
  const rows = await fetchStandings(SEASON);
  console.log(`ESPN ${SEASON} regular season: ${rows.reduce((n, r) => n + r.wins, 0)} total wins across 30 teams`);
  console.table(rows.map(({ abbr, wins, losses }) => ({ team: abbr, wins, losses })));

  if (DRY_RUN) {
    console.log("DRY_RUN=1, nothing written.");
    return;
  }

  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data: current, error: readError } = await db
    .from("team_standings")
    .select("team_id, season, wins")
    .eq("season", SEASON);
  if (readError) throw readError;
  const previous = new Map(current.map((r) => [r.team_id as number, r.wins as number]));
  const decreased = rows.filter((r) => (previous.get(r.team_id) ?? 0) > r.wins);
  if (decreased.length && !ALLOW_WIN_DECREASE) {
    throw new Error(
      `Wins went down for ${decreased.map((r) => `${r.abbr} (${previous.get(r.team_id)} -> ${r.wins})`).join(", ")}. ` +
        "Re-run with ALLOW_WIN_DECREASE=1 if ESPN corrected a result.",
    );
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await db
    .from("team_standings")
    .upsert(rows.map(({ team_id, wins, losses }) => ({ team_id, season: SEASON, wins, losses, updated_at: now })));
  if (upsertError) throw upsertError;

  const snapshot_date = nbaDate();
  const { error: historyError } = await db
    .from("team_standings_history")
    .upsert(rows.map(({ team_id, wins, losses }) => ({ snapshot_date, team_id, season: SEASON, wins, losses })));
  if (historyError) throw historyError;

  console.log(`Wrote standings for ${rows.length} teams (snapshot ${snapshot_date}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
