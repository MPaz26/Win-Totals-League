import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GameCalendar } from "../../components/GameCalendar";
import { GameCard } from "../../components/GameCard";
import { Button, Card, ErrorMessage, PageSpinner } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { addDays, canRate, dayLabel, etToday } from "../../lib/leaguePass";
import { useNotice } from "../../lib/notice";
import { useCommentCounts, useLpRankings, useLpSettings, useLpSuggestions, useTeams } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import { WatchTabs } from "./WatchTabs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function Tonight() {
  const userId = useUserId();
  const today = etToday();
  const [params, setParams] = useSearchParams();
  const date = DATE.test(params.get("date") ?? "") ? params.get("date")! : today;
  const go = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });
  const [calendarOpen, setCalendarOpen] = useState(false);

  const teams = useTeams();
  const games = useLpSuggestions(date);
  const lastNight = useLpSuggestions(addDays(today, -1));
  const commentCounts = useCommentCounts(date);
  const rankings = useLpRankings(userId);
  const settings = useLpSettings(userId);
  const notify = useNotice();
  const queryClient = useQueryClient();

  const teamMap = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  const rate = useMutation({
    mutationFn: ({ game, stars }: { game: string; stars: number | null }) => rpc("rate_game", { p_game: game, p_stars: stars }),
    onSuccess: (_, { stars }) => {
      // Ratings move every upcoming score, and the community averages.
      queryClient.invalidateQueries({ queryKey: ["lpSuggestions"] });
      queryClient.invalidateQueries({ queryKey: ["lpCommunity"] });
      notify(stars ? "Rating saved. Your picks will lean on it." : "Rating cleared.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  const unrated = date === today ? (lastNight.data ?? []).filter((g) => canRate(g) && !g.my_stars).length : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <WatchTabs />

      <div className="mb-4 flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => go(addDays(date, -1))} aria-label="Previous day">‹ Prev</Button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => setCalendarOpen((o) => !o)}
            aria-expanded={calendarOpen}
            aria-label="Choose a day from the calendar"
            className="inline-flex items-center gap-2 rounded-full px-2 text-2xl font-extrabold tracking-tight hover:text-mint"
          >
            {dayLabel(date)}
            <CalendarIcon className={`h-5 w-5 ${calendarOpen ? "text-mint" : "text-mute"}`} />
          </button>
          <div className="text-xs text-mute">
            {games.data && `${games.data.length} ${games.data.length === 1 ? "game" : "games"}`}
            {games.data && date !== today && " · "}
            {date !== today && (
              <button type="button" className="font-bold text-mint" onClick={() => go(today)}>Back to tonight</button>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => go(addDays(date, 1))} aria-label="Next day">Next ›</Button>
      </div>

      {calendarOpen && (
        <div className="mb-4">
          <GameCalendar
            selected={date}
            onPick={(d) => {
              go(d);
              setCalendarOpen(false);
            }}
          />
        </div>
      )}

      {rankings.data === null && (
        <Card className="mb-4">
          <p className="font-bold">Rank your teams to get personal picks</p>
          <p className="mt-1 text-sm text-mute">Until then, games are scored by the community's order.</p>
          <Link to="/watch/rankings" className="mt-3 inline-block text-sm font-bold text-mint">Rank teams ›</Link>
        </Card>
      )}

      {unrated > 0 && (
        <button
          type="button"
          onClick={() => go(addDays(today, -1))}
          className="mb-4 flex w-full items-center justify-between rounded-2xl bg-gold/10 px-4 py-3 text-left text-sm font-bold text-gold ring-1 ring-gold/30"
        >
          Rate last night's games ({unrated}) to sharpen your picks
          <span aria-hidden>›</span>
        </button>
      )}

      {games.isPending || teams.isPending || settings.isPending ? (
        <PageSpinner />
      ) : games.error || teams.error || settings.error ? (
        <ErrorMessage error={games.error ?? teams.error ?? settings.error} />
      ) : games.data.length === 0 ? (
        <Card className="py-10 text-center">
          <div className="text-4xl" aria-hidden>📺</div>
          <p className="mt-3 font-bold">No games {date === today ? "tonight" : "this day"}</p>
          <p className="mt-1 text-sm text-mute">The schedule updates every morning.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {games.data.map((g) => (
            <GameCard
              key={g.game_id}
              game={g}
              teams={teamMap}
              hideScores={settings.data.hide_scores}
              rating={rate.isPending && rate.variables.game === g.game_id}
              onRate={(stars) => rate.mutate({ game: g.game_id, stars })}
              comments={commentCounts.data?.get(g.game_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" strokeLinecap="round" />
    </svg>
  );
}
