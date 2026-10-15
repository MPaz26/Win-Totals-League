import { managerName, pickFor, TOTAL_TEAMS } from "../lib/draft";
import type { League, Member, Pick, Team } from "../lib/types";
import { teamColor, TeamLogo } from "./team";
import { Avatar } from "./ui";

/** Rounds down, members across, each pick tinted in its team's colors. */
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
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-max border-separate border-spacing-1.5 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-8 bg-panel" />
            {members.map((m) => (
              <th key={m.user_id} className="min-w-28 px-1 pb-1 font-semibold">
                <div className="flex flex-col items-center gap-1.5">
                  <Avatar
                    name={m.profile.username}
                    className={`h-8 w-8 text-[11px] ${m.user_id === userId ? "ring-2 ring-mint ring-offset-2 ring-offset-panel" : ""}`}
                  />
                  <span className={`max-w-28 truncate ${m.user_id === userId ? "text-mint" : "text-mute"}`}>
                    {managerName({ team_name: m.team_name, username: m.profile.username })}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, round) => (
            <tr key={round}>
              <td className="sticky left-0 z-10 bg-panel pr-1 text-right text-[11px] font-bold text-faint">R{round + 1}</td>
              {members.map((m) => {
                const number = pickFor(round, m.draft_slot, n, league.snake);
                if (number === null) return <td key={m.user_id} />;
                const pick = byNumber.get(number);
                const team = pick && teams.get(pick.team_id);
                const live = number === onClock;
                const label = `${round + 1}.${String(number - round * n).padStart(2, "0")}`;

                if (team) {
                  const color = teamColor(team.abbr);
                  return (
                    <td
                      key={m.user_id}
                      className="h-16 rounded-lg px-2 py-1.5 align-top"
                      style={{
                        background: `linear-gradient(135deg, ${color}40, ${color}14)`,
                        boxShadow: `inset 0 3px 0 ${color}`,
                      }}
                      title={pick.auto ? `${team.name} (autopick)` : team.name}
                    >
                      <div className="flex items-center justify-between text-[10px] font-semibold text-ink/60">
                        <span>{label}</span>
                        {pick.auto && <span className="rounded bg-night/50 px-1 uppercase">auto</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <TeamLogo abbr={team.abbr} className="h-6 w-6" />
                        <span className="text-sm font-extrabold">{team.abbr}</span>
                      </div>
                    </td>
                  );
                }
                return (
                  <td
                    key={m.user_id}
                    className={`h-16 rounded-lg px-2 py-1.5 align-top ${
                      live ? "bg-gold/10 ring-2 ring-gold" : "bg-night/60 ring-1 ring-line/60"
                    }`}
                  >
                    <div className="text-[10px] font-semibold text-faint">{label}</div>
                    {live && <div className="mt-1.5 animate-pulse text-[11px] font-extrabold uppercase text-gold">On the clock</div>}
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
