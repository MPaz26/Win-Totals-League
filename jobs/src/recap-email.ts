// Renders one manager's weekly recap for one league. Table layout and inline styles,
// because that's what email clients reliably render.

export interface RecapTeam {
  abbr: string;
  name: string;
  wins: number;
  losses: number;
  /** Wins since the baseline snapshot; null when there's no baseline yet. */
  weekWins: number | null;
}

export interface RecapRow {
  userId: string;
  username: string;
  /** The manager's team name in this league, if they've set one. */
  teamName: string | null;
  place: number;
  wins: number;
  losses: number;
  weekWins: number | null;
  teams: RecapTeam[];
}

export interface Recap {
  leagueName: string;
  leagueUrl: string;
  unsubscribeUrl: string;
  /** "Oct 20 – Oct 27", or null on the first recap of the season. */
  period: string | null;
  standings: RecapRow[];
  me: RecapRow;
}

const C = {
  night: "#0b111c",
  panel: "#141c2a",
  line: "#e4e8ef",
  ink: "#111827",
  mute: "#6b7280",
  mint: "#0fb5a0",
  gold: "#d99a00",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function name(s: RecapRow): string {
  return s.teamName ?? s.username;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function logo(abbr: string, size: number): string {
  return `<img src="https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png" width="${size}" height="${size}" alt="${escapeHtml(abbr)}" style="display:block;border:0;width:${size}px;height:${size}px">`;
}

function plus(n: number | null): string {
  return n === null ? "" : `+${n}`;
}

export function subject(r: Recap): string {
  return `${r.leagueName}: you're ${ordinal(r.me.place)} (${r.me.wins}–${r.me.losses})`;
}

/** The lock-screen version: where you stand, and who's ahead if it isn't you. */
export function pushText(r: Recap): { title: string; body: string } {
  const leader = r.standings[0];
  const week = r.me.weekWins !== null ? `, +${r.me.weekWins} this week` : "";
  const chase = r.me.place > 1 && leader ? ` ${name(leader)} leads at ${leader.wins}–${leader.losses}.` : "";
  return {
    title: `${r.leagueName} weekly recap`,
    body: `You're ${ordinal(r.me.place)} at ${r.me.wins}–${r.me.losses}${week}.${chase}`,
  };
}

export function renderText(r: Recap): string {
  const lines = [
    `${r.leagueName} weekly recap${r.period ? ` (${r.period})` : ""}`,
    "",
    `You're ${ordinal(r.me.place)} at ${r.me.wins}–${r.me.losses}${r.me.weekWins !== null ? `, +${r.me.weekWins} wins this week` : ""}.`,
    "",
    "Standings",
    ...r.standings.map(
      (s) => `${s.place}. ${name(s)}  ${s.wins}–${s.losses}${s.weekWins !== null ? `  (+${s.weekWins})` : ""}`,
    ),
    "",
    "Your teams",
    ...r.me.teams.map((t) => `${t.name}  ${t.wins}–${t.losses}${t.weekWins !== null ? `  (+${t.weekWins})` : ""}`),
    "",
    `League: ${r.leagueUrl}`,
    `Unsubscribe: ${r.unsubscribeUrl}`,
  ];
  return lines.join("\n");
}

export function renderHtml(r: Recap): string {
  const hasWeek = r.me.weekWins !== null;
  const topWeek = hasWeek ? Math.max(...r.standings.map((s) => s.weekWins ?? 0)) : null;
  const managerOfWeek = hasWeek && topWeek! > 0 ? r.standings.filter((s) => s.weekWins === topWeek) : [];

  const standingsRows = r.standings
    .map((s) => {
      const mine = s.userId === r.me.userId;
      const placeColor = s.place === 1 ? C.gold : C.mute;
      return `<tr style="background:${mine ? "#e8faf7" : "#ffffff"}">
        <td style="padding:10px 8px 10px 16px;border-top:1px solid ${C.line};font-weight:800;color:${placeColor};width:24px">${s.place}</td>
        <td style="padding:10px 8px;border-top:1px solid ${C.line};font-weight:${mine ? 800 : 600};color:${C.ink}">${escapeHtml(name(s))}${s.teamName ? ` <span style="color:${C.mute};font-weight:400;font-size:12px">${escapeHtml(s.username)}</span>` : ""}${mine ? ` <span style="color:${C.mute};font-weight:400">(you)</span>` : ""}</td>
        ${hasWeek ? `<td style="padding:10px 8px;border-top:1px solid ${C.line};text-align:right;color:${C.mint};font-weight:700">${plus(s.weekWins)}</td>` : ""}
        <td style="padding:10px 16px 10px 8px;border-top:1px solid ${C.line};text-align:right;font-weight:800;color:${C.ink};white-space:nowrap">${s.wins}–${s.losses}</td>
      </tr>`;
    })
    .join("");

  const teamRows = r.me.teams
    .map(
      (t) => `<tr>
        <td style="padding:8px 8px 8px 16px;border-top:1px solid ${C.line};width:32px">${logo(t.abbr, 28)}</td>
        <td style="padding:8px;border-top:1px solid ${C.line};color:${C.ink};font-weight:600">${escapeHtml(t.name)}</td>
        ${hasWeek ? `<td style="padding:8px;border-top:1px solid ${C.line};text-align:right;color:${C.mint};font-weight:700">${plus(t.weekWins)}</td>` : ""}
        <td style="padding:8px 16px 8px 8px;border-top:1px solid ${C.line};text-align:right;font-weight:700;color:${C.ink};white-space:nowrap">${t.wins}–${t.losses}</td>
      </tr>`,
    )
    .join("");

  const header = (label: string) =>
    `<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${C.mute};padding:0 4px 8px">${label}</div>`;
  const card = (inner: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden;font-size:14px">${inner}</table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject(r))}</title></head>
<body style="margin:0;padding:0;background:#f3f5f9;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="background:${C.night};border-radius:16px;padding:24px">
    <div style="font-size:13px;font-weight:800;color:#16d9c0;letter-spacing:0.5px">WIN TOTALS<span style="color:#ffffff">.</span></div>
    <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:12px">${escapeHtml(r.leagueName)}</div>
    <div style="font-size:13px;color:#8592a8;margin-top:2px">Weekly recap${r.period ? ` · ${escapeHtml(r.period)}` : ""}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>
      <td style="padding-right:28px">
        <div style="font-size:30px;font-weight:800;color:${r.me.place === 1 ? "#ffc53d" : "#ffffff"}">${ordinal(r.me.place)}</div>
        <div style="font-size:11px;font-weight:700;color:#8592a8;text-transform:uppercase;letter-spacing:1px">Place</div>
      </td>
      <td style="padding-right:28px">
        <div style="font-size:30px;font-weight:800;color:#ffffff">${r.me.wins}–${r.me.losses}</div>
        <div style="font-size:11px;font-weight:700;color:#8592a8;text-transform:uppercase;letter-spacing:1px">Record</div>
      </td>
      ${hasWeek ? `<td>
        <div style="font-size:30px;font-weight:800;color:#16d9c0">${plus(r.me.weekWins)}</div>
        <div style="font-size:11px;font-weight:700;color:#8592a8;text-transform:uppercase;letter-spacing:1px">This week</div>
      </td>` : ""}
    </tr></table>
  </td></tr>

  ${managerOfWeek.length ? `<tr><td style="padding:16px 0 0">
    <div style="background:#fff8e6;border:1px solid #ffe4a3;border-radius:12px;padding:12px 16px;font-size:14px;color:${C.ink}">
      🏆 <strong>Manager of the week:</strong> ${managerOfWeek.map((s) => escapeHtml(name(s))).join(", ")} (+${topWeek} wins)
    </div>
  </td></tr>` : ""}

  <tr><td style="padding:20px 0 0">${header("Standings")}${card(standingsRows)}</td></tr>
  <tr><td style="padding:20px 0 0">${header("Your teams")}${card(teamRows)}</td></tr>

  <tr><td align="center" style="padding:24px 0 8px">
    <a href="${escapeHtml(r.leagueUrl)}" style="display:inline-block;background:#16d9c0;color:${C.night};font-weight:800;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:999px">Open league</a>
  </td></tr>
  <tr><td align="center" style="padding:16px 0 0;font-size:12px;color:${C.mute}">
    You're getting this because you're in ${escapeHtml(r.leagueName)}.<br>
    <a href="${escapeHtml(r.unsubscribeUrl)}" style="color:${C.mute}">Unsubscribe from weekly recaps</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}
