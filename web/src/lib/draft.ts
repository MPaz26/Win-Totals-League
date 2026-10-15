export const TOTAL_TEAMS = 30;

/** Same rule as private.total_picks: only full rounds, so every roster is the same size. */
export function totalPicks(members: number): number {
  return members < 1 ? 0 : Math.floor(TOTAL_TEAMS / members) * members;
}

/** How a manager shows up in a league: their team name if they've set one, else their username. */
export function managerName(m: { team_name: string | null; username: string }): string {
  return m.team_name ?? m.username;
}

/** Same rule as public.slot_for_pick: which 1-based draft slot owns overall pick `pick`. */
export function slotForPick(pick: number, members: number, snake: boolean): number {
  const round = Math.floor((pick - 1) / members);
  const pos = (pick - 1) % members;
  return snake && round % 2 === 1 ? members - pos : pos + 1;
}

/** Inverse of slotForPick: the overall pick number for a slot in a 0-based round. */
export function pickFor(round: number, slot: number, members: number, snake: boolean): number {
  const pos = snake && round % 2 === 1 ? members - slot : slot - 1;
  return round * members + pos + 1;
}

export function roundOf(pick: number, members: number): number {
  return Math.floor((pick - 1) / members) + 1;
}

/** "10 teams each" or "7 teams each, 2 left undrafted". */
export function rosterSizes(members: number): string {
  if (members < 1) return "";
  const leftover = TOTAL_TEAMS - totalPicks(members);
  const each = `${totalPicks(members) / members} teams each`;
  return leftover === 0 ? each : `${each}, ${leftover} left undrafted`;
}

export const PICK_TIMER_OPTIONS = [
  { seconds: 30, label: "30 seconds" },
  { seconds: 60, label: "1 minute" },
  { seconds: 90, label: "90 seconds" },
  { seconds: 120, label: "2 minutes" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 28800, label: "8 hours" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 0, label: "No timer" },
];

export function timerLabel(seconds: number): string {
  return PICK_TIMER_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${seconds} seconds`;
}

/** 0:42, 4:05, 7:59:12 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function winPct(wins: number, losses: number): string {
  const games = wins + losses;
  if (games === 0) return "—";
  return (wins / games).toFixed(3).replace(/^0/, "");
}
