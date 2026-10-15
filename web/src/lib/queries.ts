import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { rows, rpc, supabase } from "./supabase";
import type { League, LeaguePreview, Member, Pick, ScoreRow, Standing, Team } from "./types";

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
          .select("user_id, draft_slot, joined_at, profile:profiles(username)")
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
