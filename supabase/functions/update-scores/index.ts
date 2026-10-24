// Refreshes live scores and standings from ESPN while games are on.
//
// Called only by the database: private.refresh_live_scores() (pg_cron, every 5 minutes, and only
// when something needs refreshing) posts header x-push-secret and body
//   { season, dates: ["YYYY-MM-DD", ...], standings: boolean }
// This fetches each date's scoreboard (usually one request) and upserts nba_games. If a
// regular-season game just went final, or the caller says standings are behind, it fetches
// standings too and writes only the teams whose record changed, so team_standings.updated_at
// says when ESPN last caught up (the caller relies on that). The dated history snapshots are
// left to the daily job. Anything surprising writes nothing and returns 500; the next run retries.
//
// Secrets: PUSH_SECRET (shared with send-push, set by the "Edge functions" workflow).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { fetchGames, fetchStandings, type Game } from "../_shared/espn.mts";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = env("PUSH_SECRET");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-push-secret") !== SECRET) return json({ error: "Unauthorized" }, 401);

  const { season, dates, standings } = await req.json();
  if (!Number.isInteger(season) || !Array.isArray(dates) || dates.length > 3 ||
      !dates.every((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return json({ error: "Expected { season, dates: up to 3 YYYY-MM-DD, standings }" }, 400);
  }

  try {
    const now = new Date().toISOString();
    const games = dates.length ? await fetchGames(season, dates) : [];
    const newlyFinal = games.length ? await saveGames(games, now) : 0;
    const teamsChanged = standings || newlyFinal ? await saveStandings(season, now) : null;
    const result = { games: games.length, newlyFinal, teamsChanged };
    console.log(JSON.stringify({ dates, ...result }));
    return json(result);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Upserts the games and returns how many regular-season games went final since the last save. */
async function saveGames(games: Game[], now: string): Promise<number> {
  const { data: before, error: readError } = await db.from("nba_games").select("id, status").in("id", games.map((g) => g.id));
  if (readError) throw readError;
  const was = new Map(before.map((r) => [r.id as string, r.status as string]));

  const { error } = await db.from("nba_games").upsert(games.map((g) => ({ ...g, updated_at: now })));
  if (error) throw error;
  return games.filter((g) => g.status === "final" && g.season_type === 2 && was.get(g.id) !== "final").length;
}

/** Writes the teams whose record changed and returns how many. Refuses if wins went down. */
async function saveStandings(season: number, now: string): Promise<number> {
  const rows = await fetchStandings(season);
  const { data: current, error: readError } = await db.from("team_standings").select("team_id, season, wins, losses");
  if (readError) throw readError;
  const previous = new Map(current.map((r) => [r.team_id as number, r as { season: number; wins: number; losses: number }]));

  // Same rule as the daily job: a correction that takes wins away needs a person to accept it.
  const decreased = rows.filter((r) => {
    const p = previous.get(r.team_id);
    return p?.season === season && p.wins > r.wins;
  });
  if (decreased.length) {
    throw new Error(`Wins went down for ${decreased.map((r) => r.abbr).join(", ")}; left for the daily job (ALLOW_WIN_DECREASE=1).`);
  }

  const changed = rows.filter((r) => {
    const p = previous.get(r.team_id);
    return !p || p.season !== season || p.wins !== r.wins || p.losses !== r.losses;
  });
  if (changed.length) {
    const { error } = await db
      .from("team_standings")
      .upsert(changed.map(({ team_id, wins, losses }) => ({ team_id, season, wins, losses, updated_at: now })));
    if (error) throw error;
  }
  return changed.length;
}
