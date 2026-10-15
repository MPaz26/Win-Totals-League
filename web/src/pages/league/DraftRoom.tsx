import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DraftBoard } from "../../components/DraftBoard";
import { teamColor, TeamLogo } from "../../components/team";
import { Avatar, Button, Card, inputClass, Segmented } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { formatCountdown, managerName, roundOf, slotForPick, TOTAL_TEAMS } from "../../lib/draft";
import { useNotice } from "../../lib/notice";
import { useServerOffset } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import type { League, Team } from "../../lib/types";
import type { LeagueData } from "../League";

type Conference = "All" | "East" | "West";

/** Phone-only sections; on large screens everything shows at once. */
const TABS = ["Teams", "My team", "Board"] as const;
type Tab = (typeof TABS)[number];

export function DraftRoom({ league, members, picks, teams }: LeagueData) {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const offset = useServerOffset();
  useAutopickTrigger(league, offset);

  const [selected, setSelected] = useState<number | null>(null);
  const [conference, setConference] = useState<Conference>("All");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("Teams");

  const n = members.length;
  const onClock = members.find((m) => m.draft_slot === slotForPick(league.current_pick, n, league.snake));
  const myTurn = onClock?.user_id === userId;
  const remaining = useRemaining(league.pick_deadline, offset);

  // A pick by anyone (or an autopick) invalidates whatever you had highlighted.
  useEffect(() => setSelected(null), [league.current_pick]);

  useEffect(() => {
    if (!myTurn) return;
    setTab("Teams");
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
  const names = new Map(members.map((m) => [m.user_id, managerName({ team_name: m.team_name, username: m.profile.username })]));
  const lowTime = remaining !== null && remaining < 10_000;
  const selectedTeam = myTurn && selected !== null ? teams.get(selected) : undefined;
  const shown = (t: Tab) => (tab === t ? "" : "hidden lg:block");

  return (
    <div className={`space-y-4 lg:space-y-6 ${selectedTeam ? "pb-24 sm:pb-0" : ""}`}>
      {/* On phones the clock and tabs stay pinned under the header while the list scrolls. */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 space-y-3 bg-night/95 px-4 pt-2 pb-3 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div
          className={`relative overflow-hidden rounded-2xl p-4 ring-1 sm:p-6 ${
            myTurn ? "bg-gradient-to-br from-gold to-orange-500 text-night ring-gold" : "bg-panel ring-line/70"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              {onClock && (
                <Avatar
                  name={onClock.profile.username}
                  className={`h-11 w-11 text-base sm:h-14 sm:w-14 sm:text-lg ${myTurn ? "ring-4 ring-night/20" : "ring-2 ring-gold ring-offset-2 ring-offset-panel sm:ring-offset-4"}`}
                />
              )}
              <div className="min-w-0">
                <div className={`text-[10px] font-extrabold uppercase tracking-[0.14em] sm:text-[11px] ${myTurn ? "text-night/70" : "text-gold"}`}>
                  {myTurn ? "You're on the clock" : "On the clock"}
                </div>
                <div className="truncate text-lg font-extrabold tracking-tight sm:text-2xl">
                  {myTurn ? "Make your pick" : ((onClock && names.get(onClock.user_id)) ?? "…")}
                </div>
                <div className={`mt-0.5 text-xs font-semibold ${myTurn ? "text-night/70" : "text-mute"}`}>
                  Round {roundOf(league.current_pick, n)} · Pick {league.current_pick}<span className="hidden sm:inline"> of {TOTAL_TEAMS}</span>
                </div>
              </div>
            </div>
            {remaining !== null && (
              <div
                className={`shrink-0 rounded-xl px-3 py-1.5 font-mono text-2xl font-bold tabular-nums sm:rounded-2xl sm:px-5 sm:py-2 sm:text-4xl ${
                  myTurn ? "bg-night/15" : lowTime ? "bg-rose/15 text-rose" : "bg-night"
                } ${lowTime ? "animate-pulse" : ""}`}
                aria-live="off"
              >
                {formatCountdown(remaining)}
              </div>
            )}
          </div>
          <div className={`absolute inset-x-0 bottom-0 h-1 ${myTurn ? "bg-night/15" : "bg-night"}`}>
            <div
              className={`h-full transition-all ${myTurn ? "bg-night/50" : "bg-mint"}`}
              style={{ width: `${((league.current_pick - 1) / TOTAL_TEAMS) * 100}%` }}
            />
          </div>
        </div>
        <div className="lg:hidden">
          <TabBar value={tab} onChange={setTab} counts={{ Teams: available.length, "My team": myTeams.length }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem] lg:gap-6">
        <Card
          flush
          className={shown("Teams")}
          title={`Available · ${TOTAL_TEAMS - picks.length}`}
          actions={<Segmented options={["All", "East", "West"] as const} value={conference} onChange={setConference} />}
        >
          <div className="px-4 pb-3 sm:px-5">
            <input
              type="search"
              placeholder="Search teams"
              className={inputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 border-y border-line/70 bg-night/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-faint sm:px-5">
            <span className="flex-1">Team</span>
            <span className="w-12 text-right sm:w-14" title="2025-26 regular-season wins">Last W</span>
            <span className="hidden w-24 sm:block" />
          </div>
          <ul className="divide-y divide-line/50 lg:max-h-[32rem] lg:overflow-y-auto">
            {available.map((t, i) => (
              <TeamRow
                key={t.id}
                rank={i + 1}
                team={t}
                myTurn={myTurn}
                selected={selected === t.id}
                busy={pick.isPending && selected === t.id}
                onSelect={() => setSelected(selected === t.id ? null : t.id)}
                onConfirm={() => pick.mutate(t.id)}
              />
            ))}
            {available.length === 0 && <li className="py-10 text-center text-sm text-mute">No teams match.</li>}
          </ul>
          {league.pick_seconds > 0 && (
            <p className="border-t border-line/70 px-4 py-3 text-xs text-faint sm:px-5">
              If the clock runs out, the team with the most wins last season is picked automatically.
            </p>
          )}
        </Card>

        <div className={`space-y-4 lg:space-y-6 ${tab === "Teams" ? "hidden lg:block" : ""}`}>
          <Card flush className={shown("My team")} title={`My roster · ${myTeams.length}`}>
            {myTeams.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-mute sm:px-5">No teams yet.</p>
            ) : (
              <ul className="divide-y divide-line/50 pb-2">
                {myTeams.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <TeamLogo abbr={t.abbr} className="h-8 w-8" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name}</span>
                    <span className="text-sm font-bold tabular-nums text-mute">{t.last_season_wins}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card flush className={shown("Board")} title="Recent picks">
            {recent.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-mute sm:px-5">No picks yet.</p>
            ) : (
              <ul className="divide-y divide-line/50 pb-2">
                {recent.map((p) => {
                  const team = teams.get(p.team_id);
                  return (
                    <li key={p.pick_number} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                      <span className="w-9 text-[11px] font-bold tabular-nums text-faint">
                        {roundOf(p.pick_number, n)}.{String(((p.pick_number - 1) % n) + 1).padStart(2, "0")}
                      </span>
                      {team && <TeamLogo abbr={team.abbr} className="h-7 w-7" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{team?.name}</span>
                        <span className="block truncate text-xs text-mute">
                          {names.get(p.user_id)}
                          {p.auto && " · autopick"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Draft board" className={shown("Board")}>
        <DraftBoard league={league} members={members} picks={picks} teams={teams} userId={userId} />
      </Card>

      {/* Phones: tap a team, then confirm here, within thumb reach. */}
      {selectedTeam && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
          <div className="flex items-center gap-3">
            <TeamLogo abbr={selectedTeam.abbr} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{selectedTeam.name}</div>
              <div className="text-xs text-mute">{selectedTeam.last_season_wins ?? "—"} wins last season</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Cancel</Button>
            <Button busy={pick.isPending} onClick={() => pick.mutate(selectedTeam.id)}>Draft</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBar({ value, onChange, counts }: { value: Tab; onChange: (t: Tab) => void; counts: Partial<Record<Tab, number>> }) {
  return (
    <div className="grid grid-cols-3 rounded-full bg-panel p-1 ring-1 ring-line">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`rounded-full py-2 text-sm font-bold transition-colors ${value === t ? "bg-raised text-ink shadow" : "text-mute"}`}
        >
          {t}
          {counts[t] !== undefined && <span className="ml-1 text-xs font-semibold text-faint">{counts[t]}</span>}
        </button>
      ))}
    </div>
  );
}

function TeamRow({ rank, team, myTurn, selected, busy, onSelect, onConfirm }: {
  rank: number;
  team: Team;
  myTurn: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}) {
  return (
    <li
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors sm:px-5 ${selected ? "bg-mint/10" : "hover:bg-raised/60"} ${
        myTurn ? "cursor-pointer active:bg-raised" : ""
      }`}
      style={{ boxShadow: `inset 3px 0 0 ${selected ? "var(--color-mint)" : teamColor(team.abbr)}` }}
      onClick={myTurn ? onSelect : undefined}
    >
      <span className="hidden w-5 text-right text-xs font-bold tabular-nums text-faint sm:block">{rank}</span>
      <TeamLogo abbr={team.abbr} className="h-9 w-9 sm:h-10 sm:w-10" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{team.name}</div>
        <div className="text-xs text-mute">
          {team.abbr} · {team.conference}
        </div>
      </div>
      <span className="w-12 text-right text-lg font-extrabold tabular-nums sm:w-14">{team.last_season_wins ?? "—"}</span>
      <span className="hidden w-24 justify-end sm:flex" onClick={(e) => e.stopPropagation()}>
        {myTurn &&
          (selected ? (
            <Button size="sm" busy={busy} onClick={onConfirm}>Confirm</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onSelect}>Draft</Button>
          ))}
      </span>
    </li>
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
