import { useState } from "react";
import { DraftBoard } from "../../components/DraftBoard";
import { teamColor, TeamLogo } from "../../components/team";
import { Avatar, Card, ErrorMessage, PageSpinner } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { winPct } from "../../lib/draft";
import { useScoreboard, useStandings } from "../../lib/queries";
import type { LeagueData } from "../League";

export function Results({ league, members, picks, teams }: LeagueData) {
  const userId = useUserId();
  const scoreboard = useScoreboard(league.id);
  const standings = useStandings();
  const [open, setOpen] = useState<string | null>(userId);
  const [showBoard, setShowBoard] = useState(false);

  if (scoreboard.error ?? standings.error) return <ErrorMessage error={scoreboard.error ?? standings.error} />;
  if (scoreboard.isPending || standings.isPending) return <PageSpinner />;

  const record = new Map(standings.data.map((s) => [s.team_id, s]));
  const updated = standings.data.reduce<string | null>((max, s) => (!max || s.updated_at > max ? s.updated_at : max), null);
  const seasonStarted = standings.data.some((s) => s.wins + s.losses > 0);

  const rosterOf = (user: string) =>
    picks
      .filter((p) => p.user_id === user)
      .map((p) => ({ pick: p, team: teams.get(p.team_id)!, record: record.get(p.team_id) }))
      .sort((a, b) => (b.record?.wins ?? 0) - (a.record?.wins ?? 0) || a.pick.pick_number - b.pick.pick_number);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card
        flush
        title="Standings"
        actions={
          <span className="text-xs text-faint">
            {updated ? `Updated ${new Date(updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : null}
          </span>
        }
      >
        {!seasonStarted && (
          <p className="mx-4 mb-4 rounded-xl sm:mx-5 bg-night/60 p-3 text-sm text-mute ring-1 ring-line/60">
            The regular season hasn't started yet. Standings update once a day after games begin.
          </p>
        )}
        <div className="flex items-center gap-3 border-y border-line/70 bg-night/40 px-4 py-2 text-[10px] sm:px-5 font-bold uppercase tracking-wider text-faint">
          <span className="w-5 sm:w-6">#</span>
          <span className="flex-1">Manager</span>
          <span className="w-[4.5rem] text-right sm:w-20">Record</span>
          <span className="hidden w-14 text-right sm:block">Pct</span>
          <span className="w-4" />
        </div>
        <ul className="divide-y divide-line/50">
          {scoreboard.data.map((row) => {
            const expanded = open === row.user_id;
            const me = row.user_id === userId;
            return (
              <li key={row.user_id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/60 active:bg-raised sm:px-5 ${me ? "bg-mint/5" : ""}`}
                  onClick={() => setOpen(expanded ? null : row.user_id)}
                  aria-expanded={expanded}
                >
                  <span className={`w-5 text-lg font-extrabold sm:w-6 tabular-nums ${placeColor(row.place)}`}>{row.place}</span>
                  <Avatar name={row.username} className={`h-9 w-9 text-sm sm:h-10 sm:w-10 ${me ? "ring-2 ring-mint ring-offset-2 ring-offset-panel" : ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {row.team_name ?? row.username}
                      {(row.team_name || me) && (
                        <span className="text-xs font-normal text-mute"> {[row.team_name && row.username, me && "(you)"].filter(Boolean).join(" ")}</span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-0.5 overflow-hidden">
                      {rosterOf(row.user_id).map(({ team }) => (
                        <TeamLogo key={team.id} abbr={team.abbr} className="h-4 w-4 sm:h-5 sm:w-5" />
                      ))}
                    </span>
                  </span>
                  <span className="w-[4.5rem] text-right text-base font-extrabold tabular-nums sm:w-20 sm:text-lg">
                    {row.wins}<span className="text-faint">–</span>{row.losses}
                  </span>
                  <span className="hidden w-14 text-right text-sm font-semibold tabular-nums text-mute sm:block">{winPct(row.wins, row.losses)}</span>
                  <span className={`w-4 text-faint transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>›</span>
                </button>
                {expanded && (
                  <ul className="mx-4 mb-4 divide-y sm:mx-5 divide-line/50 overflow-hidden rounded-xl bg-night/60 ring-1 ring-line/60">
                    {rosterOf(row.user_id).map(({ pick, team, record }) => (
                      <li
                        key={team.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{ boxShadow: `inset 3px 0 0 ${teamColor(team.abbr)}` }}
                      >
                        <TeamLogo abbr={team.abbr} className="h-8 w-8" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{team.name}</span>
                          <span className="block text-xs text-faint">
                            Pick {pick.pick_number}
                            {pick.auto && " · auto"}
                          </span>
                        </span>
                        <span className="text-sm font-bold tabular-nums">
                          {record ? `${record.wins}–${record.losses}` : "0–0"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Draft board"
        actions={
          <button type="button" className="text-sm font-bold text-mint hover:underline" onClick={() => setShowBoard((s) => !s)}>
            {showBoard ? "Hide" : "Show"}
          </button>
        }
      >
        {showBoard ? (
          <DraftBoard league={league} members={members} picks={picks} teams={teams} userId={userId} />
        ) : (
          <p className="text-sm text-mute">
            {picks.length} picks{league.completed_at && `, finished ${new Date(league.completed_at).toLocaleDateString()}`}.
          </p>
        )}
      </Card>
    </div>
  );
}

function placeColor(place: number) {
  return place === 1 ? "text-gold" : place === 2 ? "text-slate-300" : place === 3 ? "text-orange-400" : "text-faint";
}
