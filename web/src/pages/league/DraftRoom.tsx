import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DraftBoard } from "../../components/DraftBoard";
import { Button, Card, inputClass } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { formatCountdown, roundOf, slotForPick, TOTAL_TEAMS } from "../../lib/draft";
import { useNotice } from "../../lib/notice";
import { useServerOffset } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import type { League, Team } from "../../lib/types";
import type { LeagueData } from "../League";

type Conference = "All" | "East" | "West";

export function DraftRoom({ league, members, picks, teams }: LeagueData) {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const offset = useServerOffset();
  useAutopickTrigger(league, offset);

  const [selected, setSelected] = useState<number | null>(null);
  const [conference, setConference] = useState<Conference>("All");
  const [search, setSearch] = useState("");

  const n = members.length;
  const onClock = members.find((m) => m.draft_slot === slotForPick(league.current_pick, n, league.snake));
  const myTurn = onClock?.user_id === userId;
  const remaining = useRemaining(league.pick_deadline, offset);

  // A pick by anyone (or an autopick) invalidates whatever you had highlighted.
  useEffect(() => setSelected(null), [league.current_pick]);

  useEffect(() => {
    if (!myTurn) return;
    const previous = document.title;
    document.title = "⏰ Your pick! · Win Totals League";
    return () => {
      document.title = previous;
    };
  }, [myTurn]);

  const pick = useMutation({
    mutationFn: (teamId: number) => rpc("make_pick", { p_league: league.id, p_team_id: teamId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["league", league.id] });
      queryClient.invalidateQueries({ queryKey: ["picks", league.id] });
    },
    onError: (err) => notify(err.message, "error"),
  });

  const available = useMemo(() => {
    const taken = new Set(picks.map((p) => p.team_id));
    const q = search.trim().toLowerCase();
    return [...teams.values()]
      .filter((t) => !taken.has(t.id))
      .filter((t) => conference === "All" || t.conference === conference)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
      .sort((a, b) => (b.last_season_wins ?? -1) - (a.last_season_wins ?? -1) || a.name.localeCompare(b.name));
  }, [teams, picks, conference, search]);

  const myTeams = picks.filter((p) => p.user_id === userId).map((p) => teams.get(p.team_id)!);
  const recent = [...picks].reverse().slice(0, 8);
  const usernames = new Map(members.map((m) => [m.user_id, m.profile.username]));
  const lowTime = remaining !== null && remaining < 10_000;

  return (
    <div className="space-y-6">
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-xl p-5 ring-1 ${
          myTurn ? "bg-orange-600 text-white ring-orange-700" : "bg-white ring-zinc-200"
        }`}
      >
        <div>
          <div className={`text-xs uppercase tracking-wide ${myTurn ? "text-orange-100" : "text-zinc-500"}`}>
            Pick {league.current_pick} of {TOTAL_TEAMS} · Round {roundOf(league.current_pick, n)}
          </div>
          <div className="text-xl font-semibold">
            {myTurn ? "You're on the clock!" : `${onClock?.profile.username ?? "…"} is on the clock`}
          </div>
        </div>
        {remaining !== null && (
          <div
            className={`font-mono text-4xl font-semibold tabular-nums ${
              lowTime ? (myTurn ? "text-white" : "text-red-600") : ""
            } ${lowTime ? "animate-pulse" : ""}`}
            aria-live="off"
          >
            {formatCountdown(remaining)}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card
          title={`Available teams (${TOTAL_TEAMS - picks.length})`}
          actions={
            <div className="flex rounded-md ring-1 ring-zinc-300">
              {(["All", "East", "West"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConference(c)}
                  className={`px-3 py-1 text-xs font-medium first:rounded-l-md last:rounded-r-md ${
                    conference === c ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          }
        >
          <input
            placeholder="Search teams"
            className={`${inputClass} mb-3`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-2 font-medium">Team</th>
                  <th className="py-2 font-medium">Conf</th>
                  <th className="py-2 text-right font-medium" title="2025-26 regular-season wins">Last season</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {available.map((t) => (
                  <TeamRow
                    key={t.id}
                    team={t}
                    myTurn={myTurn}
                    selected={selected === t.id}
                    busy={pick.isPending && selected === t.id}
                    onSelect={() => setSelected(t.id)}
                    onConfirm={() => pick.mutate(t.id)}
                  />
                ))}
                {available.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-zinc-500">No teams match.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {league.pick_seconds > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              If the clock runs out, the team with the most wins last season is picked automatically.
            </p>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={`Your teams (${myTeams.length})`}>
            {myTeams.length === 0 ? (
              <p className="text-sm text-zinc-500">None yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {myTeams.map((t) => (
                  <li key={t.id} className="flex justify-between">
                    <span>{t.name}</span>
                    <span className="text-zinc-400">{t.last_season_wins}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent picks">
            {recent.length === 0 ? (
              <p className="text-sm text-zinc-500">No picks yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {recent.map((p) => (
                  <li key={p.pick_number} className="flex gap-2">
                    <span className="w-6 text-right tabular-nums text-zinc-400">{p.pick_number}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{usernames.get(p.user_id)}</span> took {teams.get(p.team_id)?.abbr}
                      {p.auto && <span className="text-zinc-400"> (auto)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Draft board">
        <DraftBoard league={league} members={members} picks={picks} teams={teams} userId={userId} />
      </Card>
    </div>
  );
}

function TeamRow({ team, myTurn, selected, busy, onSelect, onConfirm }: {
  team: Team;
  myTurn: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}) {
  return (
    <tr className={selected ? "bg-orange-50" : undefined}>
      <td className="py-2">
        <span className="font-medium">{team.name}</span> <span className="text-xs text-zinc-400">{team.abbr}</span>
      </td>
      <td className="py-2 text-zinc-500">{team.conference}</td>
      <td className="py-2 text-right tabular-nums">{team.last_season_wins ?? "—"}</td>
      <td className="py-2 pl-3 text-right">
        {myTurn &&
          (selected ? (
            <Button size="sm" busy={busy} onClick={onConfirm}>Confirm</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onSelect}>Draft</Button>
          ))}
      </td>
    </tr>
  );
}

/** Milliseconds left on the pick clock by the server's time, ticking; null when there's no timer. */
function useRemaining(deadline: string | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Date.parse(deadline) - (now + offset) : null;
}

/**
 * When the clock hits zero, ask the server to autopick. Every open browser does this
 * (with jitter); the RPC is idempotent and the pg_cron job is the backstop if nobody's here.
 */
function useAutopickTrigger(league: League, offset: number) {
  const queryClient = useQueryClient();
  const { id, status, pick_deadline: deadline } = league;

  useEffect(() => {
    if (status !== "drafting" || !deadline) return;
    let timer: number;
    let cancelled = false;

    const attempt = async () => {
      try {
        await rpc<boolean>("autopick_if_expired", { p_league: id });
      } catch {
        // Not fatal: someone else's call or the cron job will get it.
      }
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["league", id] });
      queryClient.invalidateQueries({ queryKey: ["picks", id] });
      // If the deadline hasn't moved by then, try again.
      timer = window.setTimeout(attempt, 5_000);
    };

    const due = Date.parse(deadline) - offset - Date.now();
    timer = window.setTimeout(attempt, Math.max(0, due) + 300 + Math.random() * 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, status, deadline, offset, queryClient]);
}
