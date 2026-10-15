import { useMemo } from "react";
import { Card, ErrorMessage, PageSpinner } from "../../components/ui";
import { TeamLogo } from "../../components/team";
import { useUserId } from "../../lib/auth";
import { useCommunityRankings, useLpRankings, useTeams } from "../../lib/queries";
import { WatchTabs } from "./WatchTabs";

export function Community() {
  const userId = useUserId();
  const teams = useTeams();
  const community = useCommunityRankings();
  const mine = useLpRankings(userId);

  const rows = useMemo(() => {
    if (!teams.data || !community.data) return [];
    const byTeam = new Map(community.data.map((c) => [c.team_id, c]));
    return teams.data
      .map((t) => ({ team: t, c: byTeam.get(t.id), mine: mine.data ? mine.data.indexOf(t.id) + 1 : null }))
      .sort((a, b) => (a.c?.avg_rank ?? 99) - (b.c?.avg_rank ?? 99) || a.team.name.localeCompare(b.team.name));
  }, [teams.data, community.data, mine.data]);

  if (teams.isPending || community.isPending || mine.isPending) return <PageSpinner />;
  const error = teams.error ?? community.error ?? mine.error;
  if (error) return <ErrorMessage error={error} />;
  const voters = Math.max(0, ...rows.map((r) => r.c?.n_users ?? 0));

  return (
    <div className="mx-auto max-w-2xl">
      <WatchTabs />
      <h1 className="text-2xl font-extrabold tracking-tight">Community rankings</h1>
      <p className="mt-1 mb-4 text-sm text-mute">
        Average rank across {voters} {voters === 1 ? "person" : "people"}, and how everyone has rated each team's games.
      </p>

      <Card flush>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-faint">
              <th className="py-2.5 pl-4 sm:pl-5">#</th>
              <th className="py-2.5">Team</th>
              <th className="py-2.5 text-right">Avg</th>
              <th className="py-2.5 text-right">You</th>
              <th className="py-2.5 pr-4 text-right sm:pr-5">Games ★</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, c, mine }, i) => (
              <tr key={team.id} className="border-t border-line/70">
                <td className="py-2 pl-4 font-extrabold text-mute tabular-nums sm:pl-5">{c?.avg_rank != null ? i + 1 : "–"}</td>
                <td className="py-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <TeamLogo abbr={team.abbr} className="h-7 w-7" />
                    <span className="truncate font-bold"><span className="sm:hidden">{team.abbr}</span><span className="hidden sm:inline">{team.name}</span></span>
                  </span>
                </td>
                <td className="py-2 text-right font-bold tabular-nums">{c?.avg_rank ?? "–"}</td>
                <td className="py-2 text-right tabular-nums">
                  {mine ? (
                    <span className={c?.avg_rank != null && Math.abs(mine - c.avg_rank) >= 8 ? "font-bold text-gold" : "text-mute"}>{mine}</span>
                  ) : (
                    <span className="text-faint">–</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-mute sm:pr-5">
                  {c?.avg_stars != null ? <>{c.avg_stars} <span className="text-faint">({c.n_ratings})</span></> : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
