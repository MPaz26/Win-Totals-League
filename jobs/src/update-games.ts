// NBA schedule and scores for League Pass (scheduled GitHub Actions workflow, or `make games`).
//
// The schedule is loaded into nba_games once per season and stays there; the app only ever
// reads it from the database.
//   MODE=season   the whole season, October through June (~1,230 games). Run once after the
//                 schedule is out, and again only if the NBA reshuffles it. Safe to repeat.
//   MODE=recent   (default, daily) yesterday's finals and anything just added or moved: the
//                 last 3 days through tomorrow. Corrects scores and statuses, picks up new
//                 playoff games, and leaves the rest of the stored schedule alone.
// ESPN's scoreboard only answers one day per request, so a season load is ~270 small requests.
// Any surprise exits non-zero without writing.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  required unless DRY_RUN=1
//   NBA_SEASON    ESPN season year, i.e. the year the season ends (2027 = 2026-27)
//   MODE          recent (default) | season
//   DRY_RUN=1     fetch + validate + print, write nothing

import { createClient } from "@supabase/supabase-js";
import { fetchJson, nbaDate, requireEnv } from "./lib.ts";

const SEASON = Number(process.env.NBA_SEASON ?? "2027");
const MODE = process.env.MODE ?? "recent";
const DRY_RUN = process.env.DRY_RUN === "1";
const SEASON_TYPES = new Set([2, 3]); // regular season, playoffs (not preseason or All-Star)
const PARALLEL = 6;

interface Game {
  id: string;
  season: number;
  season_type: number;
  game_date: string;
  tipoff: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  national_tv: string | null;
}

interface EspnScoreboard {
  events?: {
    id: string;
    date: string;
    season: { year: number; type: number };
    status: { type: { name: string; state: string; completed: boolean } };
    competitions: {
      competitors: { homeAway: string; team: { id: string; abbreviation: string }; score?: string }[];
      broadcasts?: { market: string; names: string[] }[];
    }[];
  }[];
}

/** Every calendar day from `from` to `to` inclusive, as YYYY-MM-DD. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function status(name: string, state: string, completed: boolean): Game["status"] {
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED") return "canceled";
  if (state === "post" && completed) return "final";
  if (state === "in" || state === "post") return "in_progress";
  return "scheduled";
}

function parse(day: string, data: EspnScoreboard): Game[] {
  const games: Game[] = [];
  for (const e of data.events ?? []) {
    if (!SEASON_TYPES.has(e.season.type) || e.season.year !== SEASON) continue;
    const comp = e.competitions[0];
    const side = (homeAway: string) => {
      const c = comp?.competitors.find((x) => x.homeAway === homeAway);
      if (!c) throw new Error(`${day} event ${e.id}: no ${homeAway} team`);
      return c;
    };
    const home = side("home");
    const away = side("away");
    const homeId = Number(home.team.id);
    const awayId = Number(away.team.id);
    // All-Star and other exhibition teams have ids outside the 30 franchises.
    if (![homeId, awayId].every((id) => Number.isInteger(id) && id >= 1 && id <= 30)) {
      console.log(`  skipping ${day} event ${e.id}: ${away.team.abbreviation} @ ${home.team.abbreviation} isn't two NBA teams`);
      continue;
    }
    if (homeId === awayId) throw new Error(`${day} event ${e.id}: team ${homeId} plays itself`);

    const st = status(e.status.type.name, e.status.type.state, e.status.type.completed);
    const score = (c: typeof home) => {
      if (st === "scheduled" || st === "postponed" || st === "canceled") return null;
      const n = Number(c.score);
      if (c.score === undefined || !Number.isInteger(n) || n < 0) {
        if (st === "final") throw new Error(`${day} event ${e.id}: final with bad score ${c.score}`);
        return null;
      }
      return n;
    };
    if (Number.isNaN(Date.parse(e.date))) throw new Error(`${day} event ${e.id}: bad tipoff ${e.date}`);
    const national = (comp.broadcasts ?? []).filter((b) => b.market === "national").flatMap((b) => b.names);

    games.push({
      id: e.id,
      season: e.season.year,
      season_type: e.season.type,
      game_date: day,
      tipoff: new Date(e.date).toISOString(),
      home_team_id: homeId,
      away_team_id: awayId,
      home_score: score(home),
      away_score: score(away),
      status: st,
      national_tv: national.length ? [...new Set(national)].join(", ") : null,
    });
  }
  return games;
}

async function fetchDays(dates: string[]): Promise<Game[]> {
  const byId = new Map<string, Game>();
  for (let i = 0; i < dates.length; i += PARALLEL) {
    const batch = dates.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(async (day) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}`;
        return parse(day, (await fetchJson(url)) as EspnScoreboard);
      }),
    );
    // A postponed game can show up on its old and new dates; the later day wins.
    for (const g of results.flat()) byId.set(g.id, g);
  }
  return [...byId.values()].sort((a, b) => a.tipoff.localeCompare(b.tipoff));
}

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
  const games = await fetchDays(dates);
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
