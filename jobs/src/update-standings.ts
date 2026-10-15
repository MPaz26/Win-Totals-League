// Daily standings refresh (GitLab scheduled pipeline, or `make standings`).
//
// Pulls regular-season W-L from ESPN, sanity-checks it, then upserts team_standings
// (what the scoreboard reads) and a dated row in team_standings_history.
// Any surprise exits non-zero without writing, so the scoreboard keeps the last
// good numbers and the failed pipeline sends an email.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  required unless DRY_RUN=1
//   NBA_SEASON          ESPN season year, i.e. the year the season ends (2027 = 2026-27)
//   DRY_RUN=1           fetch + validate + print, write nothing
//   ALLOW_WIN_DECREASE=1  accept a team's wins going down (ESPN correction)

import { createClient } from "@supabase/supabase-js";

const SEASON = Number(process.env.NBA_SEASON ?? "2027");
const DRY_RUN = process.env.DRY_RUN === "1";
const ALLOW_WIN_DECREASE = process.env.ALLOW_WIN_DECREASE === "1";
const REGULAR_SEASON = 2; // ESPN seasontype; without it ESPN serves preseason records in October
const GAMES = 82;
const URL = `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${SEASON}&seasontype=${REGULAR_SEASON}`;

interface Standing {
  team_id: number;
  abbr: string;
  wins: number;
  losses: number;
}

interface EspnStandings {
  children?: {
    abbreviation: string;
    standings: {
      season: number;
      seasonType: number;
      entries: {
        team: { id: string; abbreviation: string };
        stats: { name: string; value?: number }[];
      }[];
    };
  }[];
}

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw new Error(`ESPN fetch failed after ${attempts} tries: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}

function parse(data: EspnStandings): Standing[] {
  const conferences = data.children ?? [];
  if (conferences.length !== 2) throw new Error(`Expected 2 conferences, got ${conferences.length}`);

  const rows: Standing[] = [];
  for (const conf of conferences) {
    const { season, seasonType, entries } = conf.standings;
    if (season !== SEASON || seasonType !== REGULAR_SEASON) {
      throw new Error(`${conf.abbreviation}: got season ${season} type ${seasonType}, wanted ${SEASON} type ${REGULAR_SEASON}`);
    }
    for (const { team, stats } of entries) {
      const stat = (name: string) => {
        const v = stats.find((s) => s.name === name)?.value;
        if (v === undefined || !Number.isInteger(v) || v < 0) throw new Error(`${team.abbreviation}: bad ${name} ${v}`);
        return v;
      };
      rows.push({ team_id: Number(team.id), abbr: team.abbreviation, wins: stat("wins"), losses: stat("losses") });
    }
  }

  const ids = new Set(rows.map((r) => r.team_id));
  if (rows.length !== 30 || ids.size !== 30 || [...ids].some((id) => !(id >= 1 && id <= 30))) {
    throw new Error(`Expected ESPN team ids 1-30 exactly once, got ${[...ids].sort((a, b) => a - b).join(",")}`);
  }
  for (const r of rows) {
    if (r.wins + r.losses > GAMES) throw new Error(`${r.abbr}: ${r.wins}-${r.losses} is more than ${GAMES} games`);
  }
  return rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}

// The NBA's calendar day, so a 1am-ET run doesn't file results under the wrong date.
function nbaDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main() {
  const rows = parse((await fetchJson(URL)) as EspnStandings);
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
