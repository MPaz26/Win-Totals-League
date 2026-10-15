import { useState } from "react";
import { etToday } from "../lib/leaguePass";
import { useGameCounts } from "../lib/queries";
import { Spinner } from "./ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** A month of the schedule, each day with its number of games. Picking a day calls onPick. */
export function GameCalendar({ selected, onPick }: { selected: string; onPick: (date: string) => void }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const counts = useGameCounts(month);
  const today = etToday();

  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const total = counts.data ? [...counts.data.values()].reduce((a, b) => a + b, 0) : null;

  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 ring-line/70">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-full px-3 py-1 text-sm font-bold text-mute hover:bg-raised hover:text-ink" aria-label="Previous month">‹</button>
        <div className="text-center">
          <div className="font-extrabold">{title}</div>
          <div className="text-xs text-mute">
            {counts.isPending ? <Spinner className="h-3 w-3" /> : counts.error ? "Couldn't load games" : `${total} games`}
          </div>
        </div>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-full px-3 py-1 text-sm font-bold text-mute hover:bg-raised hover:text-ink" aria-label="Next month">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-1 text-[11px] font-bold text-faint" aria-hidden>{d}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          const n = counts.data?.get(date) ?? 0;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              aria-label={`${date}: ${n} ${n === 1 ? "game" : "games"}`}
              aria-current={isSelected ? "date" : undefined}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                isSelected ? "bg-mint text-night" : n ? "bg-raised text-ink hover:bg-hover" : "text-faint hover:bg-raised"
              } ${date === today && !isSelected ? "ring-1 ring-mint" : ""}`}
            >
              <span>{i + 1}</span>
              <span className={`text-[10px] leading-none tabular-nums ${isSelected ? "text-night/70" : n ? "text-mint" : "invisible"}`}>
                {n || 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
