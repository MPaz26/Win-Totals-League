import { Fragment, useState } from "react";
import { DraftBoard } from "../../components/DraftBoard";
import { Card, ErrorMessage, PageSpinner } from "../../components/ui";
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
    <div className="space-y-6">
      <Card
        title="Standings"
        actions={
          <span className="text-xs text-zinc-500">
            {updated ? `Updated ${new Date(updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : null}
          </span>
        }
      >
        {!seasonStarted && (
          <p className="mb-4 rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">
            The regular season hasn't started yet. Standings update once a day after games begin.
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="w-10 py-2 font-medium">#</th>
              <th className="py-2 font-medium">Owner</th>
              <th className="py-2 text-right font-medium">W</th>
              <th className="py-2 text-right font-medium">L</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Pct</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Teams</th>
            </tr>
          </thead>
          <tbody>
            {scoreboard.data.map((row) => {
              const expanded = open === row.user_id;
              return (
                <Fragment key={row.user_id}>
                  <tr
                    className={`cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 ${row.user_id === userId ? "font-semibold" : ""}`}
                    onClick={() => setOpen(expanded ? null : row.user_id)}
                    aria-expanded={expanded}
                  >
                    <td className="py-2.5 tabular-nums text-zinc-500">{row.place}</td>
                    <td className="py-2.5">
                      <span className="mr-1.5 inline-block w-3 text-zinc-400">{expanded ? "▾" : "▸"}</span>
                      {row.username}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{row.wins}</td>
                    <td className="py-2.5 text-right tabular-nums">{row.losses}</td>
                    <td className="hidden py-2.5 text-right tabular-nums sm:table-cell">{winPct(row.wins, row.losses)}</td>
                    <td className="hidden py-2.5 text-right tabular-nums sm:table-cell">{row.teams}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td />
                      <td colSpan={5} className="pb-3">
                        <ul className="divide-y divide-zinc-100 rounded-md bg-zinc-50 px-3 text-sm font-normal">
                          {rosterOf(row.user_id).map(({ pick, team, record }) => (
                            <li key={team.id} className="flex items-center justify-between gap-3 py-1.5">
                              <span className="min-w-0 truncate">
                                {team.name}
                                <span className="ml-2 text-xs text-zinc-400">
                                  pick {pick.pick_number}
                                  {pick.auto && " · auto"}
                                </span>
                              </span>
                              <span className="tabular-nums text-zinc-700">
                                {record ? `${record.wins}–${record.losses}` : "0–0"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card
        title="Draft board"
        actions={
          <button type="button" className="text-sm text-orange-700 hover:underline" onClick={() => setShowBoard((s) => !s)}>
            {showBoard ? "Hide" : "Show"}
          </button>
        }
      >
        {showBoard ? (
          <DraftBoard league={league} members={members} picks={picks} teams={teams} userId={userId} />
        ) : (
          <p className="text-sm text-zinc-500">
            {picks.length} picks{league.completed_at && `, finished ${new Date(league.completed_at).toLocaleDateString()}`}.
          </p>
        )}
      </Card>
    </div>
  );
}
