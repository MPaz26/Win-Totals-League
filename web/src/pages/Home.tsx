import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TeamLogo, teamColor } from "../components/team";
import { Card, ErrorMessage, PageSpinner, Segmented } from "../components/ui";
import { useAuth, useUserId } from "../lib/auth";
import { addDays, canRate, etToday, TIERS, tipoffTime, whyChips } from "../lib/leaguePass";
import { useLpRankings, useLpSettings, useLpSuggestions, useStandings, useTeams } from "../lib/queries";
import type { Standing, Suggestion, Team } from "../lib/types";
import { LeagueList } from "./Leagues";

// The home tab leads with League Pass: tonight's best game for this user, then every game
// tonight ranked by watch score. Leagues and the NBA standings sit alongside. Scores follow the
// League Pass "hide scores" setting, with a button to show them for this visit.

export function Home() {
  const userId = useUserId();
  const { profile } = useAuth();
  const today = etToday();
  const games = useLpSuggestions(today);
  const lastNight = useLpSuggestions(addDays(today, -1));
  const rankings = useLpRankings(userId);
  const settings = useLpSettings(userId);
  const teams = useTeams();
  const standings = useStandings();
  const [revealed, setRevealed] = useState(false);

  const teamMap = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);
  const records = useMemo(() => new Map((standings.data ?? []).map((s) => [s.team_id, s])), [standings.data]);
  const hideScores = (settings.data?.hide_scores ?? true) && !revealed;
  const favorite = settings.data?.favorite_team_id ?? null;
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  // Featured: the best game still to tip, else the best one on now. Games come best first.
  const list = games.data ?? [];
  const featured =
    list.find((g) => g.status === "scheduled" && Date.parse(g.tipoff) > Date.now()) ??
    list.find((g) => g.status === "in_progress");
  const unrated = (lastNight.data ?? []).filter((g) => canRate(g) && !g.my_stars).length;

  return (
    <div className="space-y-5 sm:space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-mute">{date}</p>
        <h1 className="text-2xl font-extrabold tracking-tight">Hey, {profile?.username}</h1>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5 sm:space-y-6">
          {games.isPending || teams.isPending ? (
            <PageSpinner />
          ) : games.error ? (
            <ErrorMessage error={games.error} />
          ) : (
            <>
              {featured ? (
                <Featured game={featured} teamMap={teamMap} records={records} ranked={rankings.data != null} />
              ) : (
                <Card className="py-8 text-center">
                  <div className="text-4xl" aria-hidden>📺</div>
                  <p className="mt-3 font-bold">{list.length ? "That's a wrap for tonight" : "No games tonight"}</p>
                  <Link to="/watch" className="mt-2 inline-block text-sm font-bold text-mint">
                    {list.length ? "Rate tonight's games ›" : "See upcoming games ›"}
                  </Link>
                </Card>
              )}

              {rankings.data === null && (
                <Link to="/watch/rankings" className="flex items-center justify-between rounded-2xl bg-mint/10 px-4 py-3 text-sm font-bold text-mint ring-1 ring-mint/30">
                  Rank your 30 teams so these picks are yours, not the community's
                  <span aria-hidden>›</span>
                </Link>
              )}
              {unrated > 0 && (
                <Link to={`/watch?date=${addDays(today, -1)}`} className="flex items-center justify-between rounded-2xl bg-gold/10 px-4 py-3 text-sm font-bold text-gold ring-1 ring-gold/30">
                  Rate last night's games ({unrated}) to sharpen your picks
                  <span aria-hidden>›</span>
                </Link>
              )}

              {list.length > 0 && (
                <section>
                  <SectionTitle title="Tonight, ranked for you" link={{ to: "/watch", label: "League Pass ›" }}>
                    {hideScores && list.some((g) => g.home_score !== null) && (
                      <button type="button" onClick={() => setRevealed(true)} className="ml-auto text-xs font-bold text-mute hover:text-ink">
                        Show scores
                      </button>
                    )}
                  </SectionTitle>
                  <Card flush>
                    <ol className="divide-y divide-line/70">
                      {list.map((g, i) => (
                        <li key={g.game_id}>
                          <GameRow rank={i + 1} game={g} teamMap={teamMap} hideScores={hideScores}
                            favorite={favorite !== null && (g.home_team_id === favorite || g.away_team_id === favorite)} />
                        </li>
                      ))}
                    </ol>
                  </Card>
                </section>
              )}
            </>
          )}
        </div>

        <div className="min-w-0 space-y-5 sm:space-y-6">
          <section>
            <SectionTitle title="Your leagues" link={{ to: "/leagues", label: "Create or join ›" }} />
            <LeagueList />
          </section>
          <NbaStandings teams={teams.data ?? []} records={records} />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, link, children }: { title: string; link?: { to: string; label: string }; children?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-mute">{title}</h2>
      {children}
      {link && <Link to={link.to} className="text-xs font-bold text-mint">{link.label}</Link>}
    </div>
  );
}

function record(s: Standing | undefined) {
  return s ? `${s.wins}-${s.losses}` : "";
}

/** The game to watch tonight, big, in both teams' colors. */
function Featured({ game: g, teamMap, records, ranked }: {
  game: Suggestion;
  teamMap: Map<number, Team>;
  records: Map<number, Standing>;
  /** Whether the user has ranked their teams (otherwise the picks are the community's). */
  ranked: boolean;
}) {
  const away = teamMap.get(g.away_team_id);
  const home = teamMap.get(g.home_team_id);
  if (!away || !home) return null;
  const tier = TIERS[g.tier];
  const live = g.status === "in_progress";

  return (
    <article
      className="relative overflow-hidden rounded-3xl bg-panel p-5 ring-1 ring-line/70 sm:p-6"
      style={{ backgroundImage: `linear-gradient(120deg, ${teamColor(away.abbr)}2e, transparent 45%, transparent 55%, ${teamColor(home.abbr)}2e)` }}
      aria-label={`${away.name} at ${home.name}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-mute">
          {live ? "On now" : ranked ? "Your game tonight" : "Tonight's best game"}
        </p>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide ${tier.className}`}>
          {tier.label}
          <span className="tabular-nums">{g.watch_score}</span>
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[away, home].map((team, i) => (
          <div key={team.id} className={`row-start-1 flex flex-col items-center text-center ${i === 1 ? "col-start-3" : "col-start-1"}`}>
            <TeamLogo abbr={team.abbr} className="h-16 w-16 sm:h-20 sm:w-20" />
            <span className="mt-2 text-sm font-extrabold sm:text-base">{team.name}</span>
            <span className="text-xs text-mute tabular-nums">{record(records.get(team.id))}</span>
          </div>
        ))}
        <div className="col-start-2 row-start-1 text-center">
          {live ? (
            <span className="flex items-center gap-1.5 text-sm font-extrabold text-rose">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose" aria-hidden />
              LIVE
            </span>
          ) : (
            <>
              <span className="block text-lg font-extrabold">{tipoffTime(g.tipoff)}</span>
              <span className="text-xs font-bold text-faint">@</span>
            </>
          )}
        </div>
      </div>

      <ul className="mt-5 flex flex-wrap justify-center gap-1.5" aria-label="Why this game">
        {(ranked ? whyChips(g) : ["Picked by the community's rankings"]).map((c) => (
          <li key={c} className="rounded-full bg-night/60 px-2.5 py-1 text-[11px] font-semibold text-mute">{c}</li>
        ))}
        {g.national_tv && (
          <li className="rounded-full bg-rose/10 px-2.5 py-1 text-[11px] font-semibold text-rose">{g.national_tv}: not on League Pass</li>
        )}
      </ul>

      <div className="mt-5 flex gap-2">
        <Link to={`/watch/games/${g.game_id}`} className="flex-1 rounded-full bg-mint py-2.5 text-center text-sm font-bold text-night hover:bg-mint-deep">
          Game thread
        </Link>
        <Link to="/watch" className="flex-1 rounded-full bg-raised py-2.5 text-center text-sm font-bold ring-1 ring-line hover:bg-hover">
          All games
        </Link>
      </div>
    </article>
  );
}

function GameRow({ rank, game: g, teamMap, hideScores, favorite }: {
  rank: number;
  game: Suggestion;
  teamMap: Map<number, Team>;
  hideScores: boolean;
  favorite: boolean;
}) {
  const away = teamMap.get(g.away_team_id);
  const home = teamMap.get(g.home_team_id);
  if (!away || !home) return null;
  const tier = TIERS[g.tier];
  const score = !hideScores && g.home_score !== null && g.away_score !== null ? `${g.away_score}-${g.home_score}` : null;

  return (
    <Link to={`/watch/games/${g.game_id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised sm:px-5">
      <span className="w-5 text-center text-sm font-extrabold text-faint tabular-nums">{rank}</span>
      <span className="flex shrink-0 items-center gap-1">
        <TeamLogo abbr={away.abbr} className="h-7 w-7" />
        <TeamLogo abbr={home.abbr} className="h-7 w-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-bold">{away.abbr} @ {home.abbr}</span>
          {favorite && <span className="rounded-full bg-gold px-1.5 py-px text-[9px] font-extrabold uppercase text-night">Your team</span>}
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <Status game={g} />
          {score && <span className="font-bold tabular-nums">{score}</span>}
          {g.national_tv && <span className="truncate text-rose">· {g.national_tv}</span>}
        </span>
      </span>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tier.className}`}>
        <span className="hidden sm:inline">{tier.label}</span>
        <span className="tabular-nums">{g.watch_score}</span>
      </span>
    </Link>
  );
}

function Status({ game: g }: { game: Suggestion }) {
  if (g.status === "in_progress") {
    return (
      <span className="flex items-center gap-1 font-bold text-rose">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose" aria-hidden />
        Live
      </span>
    );
  }
  if (g.status === "final") return <span className="font-bold text-mute">Final</span>;
  if (g.status === "postponed") return <span className="font-bold text-gold">Postponed</span>;
  if (g.status === "canceled") return <span className="font-bold text-faint">Canceled</span>;
  return <span className="text-mute">{tipoffTime(g.tipoff)}</span>;
}

function NbaStandings({ teams, records }: { teams: Team[]; records: Map<number, Standing> }) {
  const [conference, setConference] = useState<Team["conference"]>("East");
  if (!teams.length) return null;
  const rows = teams
    .filter((t) => t.conference === conference)
    .map((team) => ({ team, w: records.get(team.id)?.wins ?? 0, l: records.get(team.id)?.losses ?? 0 }))
    .sort((a, b) => b.w - b.l - (a.w - a.l) || b.w - a.w);
  const leader = rows[0];

  return (
    <Card title="NBA standings" actions={<Segmented options={["East", "West"] as const} value={conference} onChange={setConference} />} flush>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-faint">
            <th className="w-8 py-1.5 pl-4 text-left font-bold sm:pl-5">#</th>
            <th className="py-1.5 text-left font-bold">Team</th>
            <th className="w-10 py-1.5 text-right font-bold">W</th>
            <th className="w-10 py-1.5 text-right font-bold">L</th>
            <th className="w-14 py-1.5 pr-4 text-right font-bold sm:pr-5">GB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, w, l }, i) => {
            const gb = (leader.w - w + (l - leader.l)) / 2;
            return (
              // A line under 6th and 10th: guaranteed playoffs, then the play-in.
              <tr key={team.id} className={i === 5 || i === 9 ? "border-b border-line" : ""}>
                <td className="py-1.5 pl-4 text-xs text-faint sm:pl-5">{i + 1}</td>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <TeamLogo abbr={team.abbr} className="h-5 w-5" />
                    <span className="font-bold">{team.abbr}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right font-semibold">{w}</td>
                <td className="py-1.5 text-right text-mute">{l}</td>
                <td className="py-1.5 pr-4 text-right text-mute sm:pr-5">{gb === 0 ? "–" : gb.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
