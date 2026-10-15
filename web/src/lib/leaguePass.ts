import type { Suggestion, WatchTier } from "./types";

/** Today on the NBA's (Eastern) calendar, YYYY-MM-DD, the same day games are filed under. */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Tonight", "Last night", "Tomorrow", or "Wed, Oct 21". */
export function dayLabel(date: string): string {
  const today = etToday();
  if (date === today) return "Tonight";
  if (date === addDays(today, -1)) return "Last night";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Tipoff in the viewer's own time zone. */
export function tipoffTime(tipoff: string): string {
  return new Date(tipoff).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "just now", "5m", "3h", "2d", then a date. */
export function timeAgo(at: string): string {
  const mins = Math.floor((Date.now() - Date.parse(at)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / (24 * 60))}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether a game has started, so its comments may give the score away. */
export function hasStarted(g: { status: string; tipoff: string }): boolean {
  return g.status === "in_progress" || g.status === "final" || Date.now() > Date.parse(g.tipoff);
}

/** Matches rate_game(): final, or 2.5 hours after tipoff even before the morning load marks it final. */
export function canRate(g: Suggestion): boolean {
  if (g.status === "final") return true;
  if (g.status !== "scheduled" && g.status !== "in_progress") return false;
  return Date.now() > Date.parse(g.tipoff) + 2.5 * 3600_000;
}

export const TIERS: Record<WatchTier, { label: string; className: string }> = {
  must: { label: "Must-watch", className: "bg-mint/15 text-mint" },
  good: { label: "Worth a look", className: "bg-gold/15 text-gold" },
  meh: { label: "Skippable", className: "bg-raised text-mute" },
};

/** Short reasons behind a watch score, from the parts lp_suggestions() returns. */
export function whyChips(g: Suggestion): string[] {
  const [hi, lo] = [Math.min(g.home_rank, g.away_rank), Math.max(g.home_rank, g.away_rank)];
  const chips = [`Your #${hi} vs #${lo}`];
  if (g.closeness >= 0.9 && hi > 1) chips.push("Close in your rankings");
  if (g.my_lean >= 0.1) chips.push("You've enjoyed these teams lately");
  if (g.my_lean <= -0.1) chips.push("You've rated these teams low lately");
  if (g.community_lean >= 0.08) chips.push("Community rates these teams well");
  if (g.community_lean <= -0.08) chips.push("Community rates these teams poorly");
  if (g.quality >= 0.8) chips.push("Good, evenly matched records");
  return chips;
}
