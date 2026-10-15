import { pickFor, TOTAL_TEAMS } from "../lib/draft";
import type { League, Member, Pick, Team } from "../lib/types";

/** Rounds down, members across, like a draft board on the wall. */
export function DraftBoard({ league, members, picks, teams, userId }: {
  league: League;
  members: Member[];
  picks: Pick[];
  teams: Map<number, Team>;
  userId: string;
}) {
  const n = members.length;
  if (n === 0) return null;
  const rounds = Math.ceil(TOTAL_TEAMS / n);
  const byNumber = new Map(picks.map((p) => [p.pick_number, p]));
  const onClock = league.status === "drafting" ? league.current_pick : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-8" />
            {members.map((m) => (
              <th
                key={m.user_id}
                className={`truncate rounded px-2 py-1.5 text-left font-semibold ${
                  m.user_id === userId ? "bg-orange-100 text-orange-900" : "bg-zinc-100"
                }`}
              >
                {m.profile.username}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, round) => (
            <tr key={round}>
              <td className="pr-1 text-right text-zinc-400">R{round + 1}</td>
              {members.map((m) => {
                const number = pickFor(round, m.draft_slot, n, league.snake);
                if (number === null) return <td key={m.user_id} />;
                const pick = byNumber.get(number);
                const team = pick && teams.get(pick.team_id);
                const live = number === onClock;
                return (
                  <td
                    key={m.user_id}
                    className={`h-11 min-w-24 rounded px-2 py-1 align-top ${
                      live
                        ? "animate-pulse bg-orange-50 ring-2 ring-orange-400"
                        : team
                          ? "bg-white ring-1 ring-zinc-200"
                          : "bg-zinc-50 ring-1 ring-zinc-100"
                    }`}
                  >
                    <div className="text-[10px] text-zinc-400">#{number}</div>
                    {team ? (
                      <div className="font-medium" title={pick.auto ? `${team.name} (autopick)` : team.name}>
                        {team.abbr}
                        {pick.auto && <span className="ml-1 text-[10px] font-normal text-zinc-400">auto</span>}
                      </div>
                    ) : live ? (
                      <div className="font-medium text-orange-700">On the clock</div>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
