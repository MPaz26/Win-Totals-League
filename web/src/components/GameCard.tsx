import { useState } from "react";
import { canRate, TIERS, tipoffTime, whyChips } from "../lib/leaguePass";
import type { Suggestion, Team } from "../lib/types";
import { StarRating } from "./StarRating";
import { TeamLogo, teamColor } from "./team";

export function GameCard({ game, teams, hideScores, onRate, rating }: {
  game: Suggestion;
  teams: Map<number, Team>;
  hideScores: boolean;
  onRate: (stars: number | null) => void;
  /** True while this game's rating is saving. */
  rating?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const home = teams.get(game.home_team_id);
  const away = teams.get(game.away_team_id);
  if (!home || !away) return null;

  const tier = TIERS[game.tier];
  const hasScore = game.home_score !== null && game.away_score !== null;
  const showScore = hasScore && (!hideScores || revealed);
  const matchup = `${away.name} at ${home.name}`;

  return (
    <article className="rounded-2xl bg-panel p-4 ring-1 ring-line/70" aria-label={matchup}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-mute">
          {game.status === "postponed" ? "Postponed" : game.status === "canceled" ? "Canceled" : tipoffTime(game.tipoff)}
          {game.status === "in_progress" && !canRate(game) && <span className="ml-2 font-bold text-gold">Live</span>}
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tier.className}`}>
          {tier.label}
          <span className="tabular-nums opacity-80">{game.watch_score}</span>
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {[
          { team: away, rank: game.away_rank, score: game.away_score, other: game.home_score },
          { team: home, rank: game.home_rank, score: game.home_score, other: game.away_score },
        ].map(({ team, rank, score, other }) => (
          <div key={team.id} className="flex items-center gap-3">
            <TeamLogo abbr={team.abbr} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{team.name}</div>
              <div className="text-xs text-mute">
                Your <span className="font-bold" style={{ color: teamColor(team.abbr) }}>#{rank}</span>
              </div>
            </div>
            {showScore && (
              <div className={`text-xl font-extrabold tabular-nums ${score! > other! ? "text-ink" : "text-mute"}`}>{score}</div>
            )}
          </div>
        ))}
      </div>

      {hasScore && !showScore && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 w-full rounded-xl bg-night py-2 text-xs font-bold text-mute ring-1 ring-line hover:text-ink"
        >
          Reveal score
        </button>
      )}

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Why this score">
        {whyChips(game).map((c) => (
          <li key={c} className="rounded-full bg-raised px-2.5 py-1 text-[11px] font-semibold text-mute">{c}</li>
        ))}
        {game.national_tv && (
          <li className="rounded-full bg-rose/10 px-2.5 py-1 text-[11px] font-semibold text-rose">
            {game.national_tv}: not on League Pass
          </li>
        )}
      </ul>

      {canRate(game) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/70 pt-3">
          <span className="text-xs font-bold text-mute">{game.my_stars ? "Your rating" : "How was it?"}</span>
          <StarRating value={game.my_stars} onChange={onRate} disabled={rating} label={`Rate ${matchup}`} />
        </div>
      )}
    </article>
  );
}
