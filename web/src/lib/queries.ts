import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { rows, rpc, supabase } from "./supabase";
import type { CommunityRank, Game, GameComment, League, LeaguePreview, LpSettings, Member, Pick, ScoreRow, Standing, Suggestion, Team } from "./types";

// ESPN convention: 2027 = the 2026-27 season. Keep in step with NBA_SEASON in the standings job.
export const SEASON = 2027;

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    staleTime: Infinity,
    queryFn: () => rows<Team[]>(supabase.from("nba_teams").select("*").order("name")),
  });
}

export function useStandings() {
  return useQuery({
    queryKey: ["standings"],
    staleTime: 5 * 60_000,
    queryFn: () => rows<Standing[]>(supabase.from("team_standings").select("*").eq("season", SEASON)),
  });
}

/** Whether the user gets the weekly recap email. No row yet means subscribed. */
export function useWeeklyRecap(userId: string) {
  return useQuery({
    queryKey: ["emailPrefs", userId],
    queryFn: async () => {
      const row = await rows<{ weekly_recap: boolean } | null>(
        supabase.from("email_preferences").select("weekly_recap").eq("user_id", userId).maybeSingle(),
      );
      return row?.weekly_recap ?? true;
    },
  });
}

// League Pass. Games and scores change once a day (the morning load), so these stay fresh a while.

/** The caller's saved order as team ids, favorite first; null until they've saved one. */
export function useLpRankings(userId: string) {
  return useQuery({
    queryKey: ["lpRankings", userId],
    queryFn: async () => {
      const data = await rows<{ team_id: number }[]>(
        supabase.from("lp_rankings").select("team_id").eq("user_id", userId).order("rank"),
      );
      return data.length ? data.map((r) => r.team_id) : null;
    },
  });
}

export function useCommunityRankings() {
  return useQuery({
    queryKey: ["lpCommunity"],
    staleTime: 10 * 60_000,
    queryFn: () => rpc<CommunityRank[]>("lp_community_rankings"),
  });
}

/** One (Eastern) day's games scored for the caller, best first. */
export function useLpSuggestions(date: string) {
  return useQuery({
    queryKey: ["lpSuggestions", date],
    staleTime: 10 * 60_000,
    queryFn: () => rpc<Suggestion[]>("lp_suggestions", { p_from: date, p_to: date }),
  });
}

/** Games per (Eastern) day for one month ("YYYY-MM"), keyed by YYYY-MM-DD. Days without games are missing. */
export function useGameCounts(month: string) {
  return useQuery({
    queryKey: ["gameCounts", month],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      // A month is a few hundred games at most, well under PostgREST's row cap.
      const data = await rows<{ game_date: string }[]>(
        supabase
          .from("nba_games")
          .select("game_date")
          .gte("game_date", `${month}-01`)
          .lte("game_date", `${month}-${String(last).padStart(2, "0")}`)
          .not("status", "in", "(postponed,canceled)"),
      );
      const counts = new Map<string, number>();
      for (const g of data) counts.set(g.game_date, (counts.get(g.game_date) ?? 0) + 1);
      return counts;
    },
  });
}

export const LP_DEFAULTS: LpSettings = { hide_scores: true, notify_daily: true, notify_must_watch: true, notify_replies: true, favorite_team_id: null };

/** No row yet means the defaults. */
export function useLpSettings(userId: string) {
  return useQuery({
    queryKey: ["lpSettings", userId],
    queryFn: async () => {
      const row = await rows<LpSettings | null>(
        supabase.from("lp_settings").select("hide_scores, notify_daily, notify_must_watch, notify_replies, favorite_team_id").eq("user_id", userId).maybeSingle(),
      );
      return row ?? LP_DEFAULTS;
    },
  });
}

/** Comment counts for one (Eastern) day's games, keyed by game id. Games without comments are missing. */
export function useCommentCounts(date: string) {
  return useQuery({
    queryKey: ["commentCounts", date],
    staleTime: 60_000,
    queryFn: async () => {
      const data = await rpc<{ game_id: string; n_comments: number }[]>("lp_comment_counts", { p_from: date, p_to: date });
      return new Map(data.map((r) => [r.game_id, r.n_comments]));
    },
  });
}

export function useGame(id: string) {
  return useQuery({
    queryKey: ["game", id],
    staleTime: 5 * 60_000,
    queryFn: () => rows<Game | null>(supabase.from("nba_games").select("*").eq("id", id).maybeSingle()),
  });
}

/** Every comment on a game, oldest first. */
export function useGameComments(id: string) {
  return useQuery({
    queryKey: ["gameComments", id],
    queryFn: () =>
      rows<GameComment[]>(
        supabase
          .from("lp_game_comments")
          .select("id, user_id, parent_id, body, created_at, author:profiles(username)")
          .eq("game_id", id)
          .order("created_at"),
      ),
  });
}

/** Refetches a game's comments whenever anyone posts or deletes one. */
export function useGameCommentsRealtime(id: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["gameComments", id] });
      queryClient.invalidateQueries({ queryKey: ["commentCounts"] });
    };
    const channel = supabase
      .channel(`game:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lp_game_comments", filter: `game_id=eq.${id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lp_game_comments", filter: `game_id=eq.${id}` }, refresh)
      // Realtime can't filter DELETEs, so any deleted comment anywhere triggers a (cheap) refetch.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "lp_game_comments" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);
}

export function useMyLeagues() {
  return useQuery({
    queryKey: ["myLeagues"],
    // RLS limits this to leagues the caller belongs to.
    queryFn: () => rows<League[]>(supabase.from("leagues").select("*").order("created_at", { ascending: false })),
  });
}

/** The caller's own scoreboard row in every league, keyed by league id. */
export function useMyStandings(userId: string) {
  return useQuery({
    queryKey: ["myScores", userId],
    queryFn: async () => {
      const data = await rows<ScoreRow[]>(supabase.from("league_scoreboard").select("*").eq("user_id", userId));
      return new Map(data.map((r) => [r.league_id, r]));
    },
  });
}

export function useLeague(id: string) {
  return useQuery({
    queryKey: ["league", id],
    queryFn: () => rows<League | null>(supabase.from("leagues").select("*").eq("id", id).maybeSingle()),
    // Realtime drives updates; this is a safety net if the socket drops mid-draft.
    refetchInterval: (q) => (q.state.data?.status === "drafting" ? 15_000 : false),
  });
}

export function useMembers(id: string) {
  return useQuery({
    queryKey: ["members", id],
    queryFn: () =>
      rows<Member[]>(
        supabase
          .from("league_members")
          .select("user_id, draft_slot, joined_at, team_name, profile:profiles(username)")
          .eq("league_id", id)
          .order("draft_slot"),
      ),
  });
}

export function usePicks(id: string) {
  return useQuery({
    queryKey: ["picks", id],
    queryFn: () =>
      rows<Pick[]>(
        supabase
          .from("draft_picks")
          .select("pick_number, user_id, team_id, auto, picked_at")
          .eq("league_id", id)
          .order("pick_number"),
      ),
  });
}

export function useScoreboard(id: string) {
  return useQuery({
    queryKey: ["scoreboard", id],
    queryFn: () =>
      rows<ScoreRow[]>(supabase.from("league_scoreboard").select("*").eq("league_id", id).order("place")),
  });
}

// Keyed on the viewer too: is_member flips when someone signs in on the invite page.
export function useLeaguePreview(code: string, userId: string | undefined) {
  return useQuery({
    queryKey: ["preview", code, userId],
    queryFn: async () => (await rpc<LeaguePreview[]>("league_preview", { p_invite_code: code }))[0] ?? null,
  });
}

/**
 * Milliseconds to add to Date.now() to get the database's clock, so every browser
 * counts down to the same pick deadline regardless of local clock drift.
 */
export function useServerOffset(): number {
  const { data } = useQuery({
    queryKey: ["serverOffset"],
    staleTime: Infinity,
    queryFn: async () => {
      const sent = Date.now();
      const server = Date.parse(await rpc<string>("server_now"));
      return server - (sent + Date.now()) / 2;
    },
  });
  return data ?? 0;
}

/** Refetches a league's data whenever its row, members or picks change. */
export function useLeagueRealtime(id: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = (...keys: string[]) => () => {
      for (const key of keys) queryClient.invalidateQueries({ queryKey: [key, id] });
    };
    const all = refresh("league", "members", "picks", "scoreboard");

    const channel = supabase
      .channel(`league:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leagues", filter: `id=eq.${id}` }, refresh("league"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "league_members", filter: `league_id=eq.${id}` },
        refresh("members", "scoreboard"),
      )
      // Realtime can't filter DELETEs, so any member leaving any league triggers a (cheap) refetch.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "league_members" }, refresh("members", "scoreboard"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "draft_picks", filter: `league_id=eq.${id}` },
        refresh("picks", "scoreboard"),
      )
      .subscribe((status) => {
        // Catch up on anything that changed while the socket was connecting or reconnecting.
        if (status === "SUBSCRIBED") all();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);
}
