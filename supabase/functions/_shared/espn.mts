// ESPN fetching and parsing, shared by the Node jobs (jobs/src) and the update-scores Edge
// Function (Deno). Plain TypeScript with no runtime-specific APIs, so both can import it.
// Every parser throws on anything surprising, so callers write nothing rather than bad data.

/** ESPN seasontype; without it ESPN serves preseason records in October. */
export const REGULAR_SEASON = 2;
const GAMES = 82;
const SEASON_TYPES = new Set([2, 3]); // regular season, playoffs (not preseason or All-Star)

export interface Standing {
  team_id: number;
  abbr: string;
  wins: number;
  losses: number;
}

export interface Game {
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

// The NBA's calendar day, so a 1am-ET run doesn't file results under the wrong date.
export function nbaDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/** Every calendar day from `from` to `to` inclusive, as YYYY-MM-DD. */
export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ESPN answers Deno's default User-Agent with 403, so say who we are (from Node too).
const USER_AGENT = "win-totals-league (+https://github.com/MPaz26/Win-Totals-League)";

/** GET a JSON endpoint (ESPN), retrying with backoff before giving up. */
export async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw new Error(`ESPN fetch failed after ${attempts} tries: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

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

export function standingsUrl(season: number): string {
  return `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${season}&seasontype=${REGULAR_SEASON}`;
}

/** Regular-season W-L for all 30 teams, best record first. */
export async function fetchStandings(season: number): Promise<Standing[]> {
  return parseStandings(season, (await fetchJson(standingsUrl(season))) as EspnStandings);
}

function parseStandings(season: number, data: EspnStandings): Standing[] {
  const conferences = data.children ?? [];
  if (conferences.length !== 2) throw new Error(`Expected 2 conferences, got ${conferences.length}`);

  const rows: Standing[] = [];
  for (const conf of conferences) {
    const { season: got, seasonType, entries } = conf.standings;
    if (got !== season || seasonType !== REGULAR_SEASON) {
      throw new Error(`${conf.abbreviation}: got season ${got} type ${seasonType}, wanted ${season} type ${REGULAR_SEASON}`);
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

// ---------------------------------------------------------------------------
// Scoreboard (games)
// ---------------------------------------------------------------------------

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

/**
 * Every game on the given (Eastern) days, by tipoff. ESPN's scoreboard answers one day per
 * request, so this makes one request per day, `parallel` at a time.
 */
export async function fetchGames(season: number, dates: string[], parallel = 6): Promise<Game[]> {
  const byId = new Map<string, Game>();
  for (let i = 0; i < dates.length; i += parallel) {
    const batch = dates.slice(i, i + parallel);
    const results = await Promise.all(
      batch.map(async (day) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}`;
        return parseScoreboard(season, day, (await fetchJson(url)) as EspnScoreboard);
      }),
    );
    // A postponed game can show up on its old and new dates; the later day wins.
    for (const g of results.flat()) byId.set(g.id, g);
  }
  return [...byId.values()].sort((a, b) => a.tipoff.localeCompare(b.tipoff));
}

function status(name: string, state: string, completed: boolean): Game["status"] {
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED") return "canceled";
  if (state === "post" && completed) return "final";
  if (state === "in" || state === "post") return "in_progress";
  return "scheduled";
}

function parseScoreboard(season: number, day: string, data: EspnScoreboard): Game[] {
  const games: Game[] = [];
  for (const e of data.events ?? []) {
    if (!SEASON_TYPES.has(e.season.type) || e.season.year !== season) continue;
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
