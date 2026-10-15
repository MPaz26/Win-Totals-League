// Weekly recap email (scheduled GitHub Actions workflow, or `make recap`).
//
// For every drafted league, emails each opted-in member the league standings, their own
// teams, and wins gained since the standings snapshot from a week ago. Sends through Gmail
// SMTP with an app password. Skips the whole run before the season starts and in weeks with
// no games. Each sent email is recorded in recap_sends, so re-running never double-sends.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  required
//   APP_URL             where the web app lives, e.g. https://you.github.io/nba-wins-league/
//   GMAIL_USER          the sending Gmail address; required unless DRY_RUN=1
//   GMAIL_APP_PASSWORD  an app password for it (needs 2-Step Verification); required unless DRY_RUN=1
//   EMAIL_FROM_NAME     display name on the From line (default "Win Totals")
//   NBA_SEASON          ESPN season year (2027 = 2026-27)
//   DRY_RUN=1           build everything, send nothing
//   PREVIEW_DIR         with DRY_RUN, write each email's HTML here
//   TEST_TO             send one email per league to this address instead of the members
//   FORCE=1             send even before the season or in a week with no games

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import nodemailer, { type Transporter } from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nbaDate, requireEnv } from "./lib.ts";
import { renderHtml, renderText, subject, type Recap, type RecapRow } from "./recap-email.ts";

const SEASON = Number(process.env.NBA_SEASON ?? "2027");
const DRY_RUN = process.env.DRY_RUN === "1";
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const TEST_TO = process.env.TEST_TO;
const FORCE = process.env.FORCE === "1";
const SEND_GAP_MS = 1_000; // Gmail allows ~500 recipients/day; no need to rush them

interface Team { id: number; abbr: string; name: string }
interface WinLoss { wins: number; losses: number }
interface Member { league_id: string; user_id: string; profile: { username: string } }
interface Pick { league_id: string; user_id: string; team_id: number; pick_number: number }
interface ScoreRow { league_id: string; user_id: string; username: string; team_name: string | null; wins: number; losses: number; place: number }

interface Outgoing {
  key: string;
  to: string;
  recap: Recap;
}

async function main() {
  const appUrl = requireEnv("APP_URL").replace(/\/?$/, "/");
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const q = async <T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> => {
    const { data, error } = await query;
    if (error) throw error;
    return data as T;
  };

  const today = nbaDate();
  const teams = new Map((await q<Team[]>(db.from("nba_teams").select("id, abbr, name"))).map((t) => [t.id, t]));
  const current = new Map(
    (await q<(WinLoss & { team_id: number })[]>(db.from("team_standings").select("team_id, wins, losses").eq("season", SEASON)))
      .map((s) => [s.team_id, s]),
  );
  if (![...current.values()].some((s) => s.wins + s.losses > 0) && !FORCE) {
    console.log(`The ${SEASON} season hasn't started; no recap. (FORCE=1 to send anyway.)`);
    return;
  }

  // Baseline: the newest snapshot at least a week old. None yet means this is the first recap.
  const [baselineRow] = await q<{ snapshot_date: string }[]>(
    db.from("team_standings_history").select("snapshot_date").eq("season", SEASON)
      .lte("snapshot_date", nbaDate(-7)).order("snapshot_date", { ascending: false }).limit(1),
  );
  const baselineDate = baselineRow?.snapshot_date ?? null;
  const baseline = baselineDate
    ? new Map(
        (await q<(WinLoss & { team_id: number })[]>(
          db.from("team_standings_history").select("team_id, wins, losses").eq("snapshot_date", baselineDate),
        )).map((s) => [s.team_id, s]),
      )
    : null;
  const weekWins = (teamId: number) => (baseline ? (current.get(teamId)?.wins ?? 0) - (baseline.get(teamId)?.wins ?? 0) : null);

  if (baseline && !FORCE) {
    const played = [...current].some(([id, s]) => s.wins + s.losses !== (baseline.get(id)?.wins ?? 0) + (baseline.get(id)?.losses ?? 0));
    if (!played) {
      console.log(`No games since ${baselineDate}; no recap. (FORCE=1 to send anyway.)`);
      return;
    }
  }
  const period = baselineDate ? `${shortDate(baselineDate)} – ${shortDate(today)}` : null;

  const leagues = await q<{ id: string; name: string }[]>(db.from("leagues").select("id, name").eq("status", "complete"));
  if (leagues.length === 0) {
    console.log("No drafted leagues; no recap.");
    return;
  }
  const ids = leagues.map((l) => l.id);
  const members = await q<Member[]>(db.from("league_members").select("league_id, user_id, profile:profiles(username)").in("league_id", ids));
  const picks = await q<Pick[]>(db.from("draft_picks").select("league_id, user_id, team_id, pick_number").in("league_id", ids));
  const scores = await q<ScoreRow[]>(db.from("league_scoreboard").select("league_id, user_id, username, team_name, wins, losses, place").in("league_id", ids));

  const recipients = [...new Set(members.map((m) => m.user_id))];
  const emails = await userEmails(db);
  const tokens = await unsubscribeTokens(db, recipients);

  const outgoing: Outgoing[] = [];
  let optedOut = 0;
  for (const league of leagues) {
    const leagueMembers = members.filter((m) => m.league_id === league.id);
    const standings: RecapRow[] = scores
      .filter((s) => s.league_id === league.id)
      .sort((a, b) => a.place - b.place || a.username.localeCompare(b.username))
      .map((s) => {
        const mine = picks.filter((p) => p.league_id === league.id && p.user_id === s.user_id);
        const rosterTeams = mine
          .map((p) => {
            const team = teams.get(p.team_id)!;
            const rec = current.get(p.team_id) ?? { wins: 0, losses: 0 };
            return { abbr: team.abbr, name: team.name, wins: rec.wins, losses: rec.losses, weekWins: weekWins(p.team_id) };
          })
          .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
        return {
          userId: s.user_id,
          username: s.username,
          teamName: s.team_name,
          place: s.place,
          wins: s.wins,
          losses: s.losses,
          weekWins: baseline ? mine.reduce((n, p) => n + weekWins(p.team_id)!, 0) : null,
          teams: rosterTeams,
        };
      });

    const recapFor = (me: RecapRow): Recap => ({
      leagueName: league.name,
      leagueUrl: `${appUrl}league/${league.id}`,
      unsubscribeUrl: `${appUrl}unsubscribe/${tokens.get(me.userId)!.token}`,
      period,
      standings,
      me,
    });

    if (TEST_TO) {
      // One sample per league, from the tester's own seat if they're in it.
      const me = standings.find((s) => emails.get(s.userId)?.toLowerCase() === TEST_TO.toLowerCase()) ?? standings[0];
      if (me) outgoing.push({ key: `recap-test/${today}/${league.id}`, to: TEST_TO, recap: recapFor(me) });
      continue;
    }
    for (const m of leagueMembers) {
      const me = standings.find((s) => s.userId === m.user_id);
      const to = emails.get(m.user_id);
      if (!me || !to) continue;
      if (!tokens.get(m.user_id)!.weekly_recap) {
        optedOut++;
        continue;
      }
      outgoing.push({ key: `recap/${today}/${league.id}/${m.user_id}`, to, recap: recapFor(me) });
    }
  }

  console.log(
    `${leagues.length} league(s), ${outgoing.length} email(s) to send, ${optedOut} opted out.` +
      (baselineDate ? ` Week since ${baselineDate}.` : " First recap (no baseline yet)."),
  );

  if (DRY_RUN) {
    if (PREVIEW_DIR) await mkdir(PREVIEW_DIR, { recursive: true });
    for (const o of outgoing) {
      console.log(`  would send to ${o.to}: ${subject(o.recap)}`);
      if (PREVIEW_DIR) {
        // Ids, not names: two managers can have names that slug the same.
        const file = `${o.key.split("/").slice(2).join("-")}.html`;
        await writeFile(join(PREVIEW_DIR, file), renderHtml(o.recap));
      }
    }
    console.log(`DRY_RUN=1, nothing sent.${PREVIEW_DIR ? ` Previews in ${PREVIEW_DIR}.` : ""}`);
    return;
  }

  const user = requireEnv("GMAIL_USER");
  const mailer = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: requireEnv("GMAIL_APP_PASSWORD") },
  });
  await mailer.verify(); // fail fast on a bad app password, before anything is sent
  const from = { name: process.env.EMAIL_FROM_NAME || "Win Totals", address: user };

  // Test sends aren't logged, so you can send yourself as many as you like.
  const alreadySent = new Set<string>();
  if (!TEST_TO) {
    const { data, error } = await db.from("recap_sends").select("key").in("key", outgoing.map((o) => o.key));
    if (error) throw error;
    for (const r of data as { key: string }[]) alreadySent.add(r.key);
  }
  const pending = outgoing.filter((o) => !alreadySent.has(o.key));
  if (alreadySent.size) console.log(`${alreadySent.size} already sent earlier today; skipping those.`);

  const failures: string[] = [];
  for (const [i, o] of pending.entries()) {
    if (i > 0) await sleep(SEND_GAP_MS);
    try {
      await send(mailer, from, o);
      if (!TEST_TO) {
        const { error } = await db.from("recap_sends").insert({ key: o.key });
        if (error) console.error(`  sent to ${o.to} but couldn't record it: ${error.message}`);
      }
      console.log(`  sent to ${o.to}: ${subject(o.recap)}`);
    } catch (err) {
      failures.push(o.to);
      console.error(`  FAILED ${o.to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  mailer.close();
  // Keep going past individual failures, but fail the run so the workflow emails you.
  // Re-running the same day only retries the ones that failed.
  if (failures.length) throw new Error(`${failures.length} of ${pending.length} email(s) failed.`);
  console.log(`Sent ${pending.length} email(s).`);
}

/** auth.users emails, keyed by user id. Covers Google and email-link sign-ins alike. */
async function userEmails(db: SupabaseClient): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const u of data.users) if (u.email) emails.set(u.id, u.email);
    if (data.users.length < perPage) return emails;
  }
}

/** Every recipient's preferences, creating the default row (subscribed, new token) where missing. */
async function unsubscribeTokens(db: SupabaseClient, users: string[]) {
  const { error: insertError } = await db
    .from("email_preferences")
    .upsert(users.map((user_id) => ({ user_id })), { onConflict: "user_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data, error } = await db.from("email_preferences").select("user_id, weekly_recap, unsubscribe_token").in("user_id", users);
  if (error) throw error;
  const rows = data as { user_id: string; weekly_recap: boolean; unsubscribe_token: string }[];
  return new Map(rows.map((r) => [r.user_id, { weekly_recap: r.weekly_recap, token: r.unsubscribe_token }]));
}

async function send(mailer: Transporter, from: { name: string; address: string }, o: Outgoing, attempt = 1): Promise<void> {
  try {
    await mailer.sendMail({
      from,
      to: o.to,
      subject: (TEST_TO ? "[TEST] " : "") + subject(o.recap),
      html: renderHtml(o.recap),
      text: renderText(o.recap),
      list: { unsubscribe: o.recap.unsubscribeUrl },
    });
  } catch (err) {
    // 4xx SMTP replies and dropped connections are temporary; 5xx (bad address, auth) are not.
    const code = (err as { responseCode?: number }).responseCode;
    if ((code === undefined || (code >= 400 && code < 500)) && attempt < 3) {
      await sleep(2_000 * attempt);
      return send(mailer, from, o, attempt + 1);
    }
    throw err;
  }
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
