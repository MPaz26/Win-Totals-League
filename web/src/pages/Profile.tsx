import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InstallButton } from "../components/InstallGuide";
import { Avatar, Button, Card, InlineEdit, Spinner, Toggle } from "../components/ui";
import { signOut, useAuth, useUserId } from "../lib/auth";
import { useNotice } from "../lib/notice";
import { disablePush, enablePush, isDeviceSubscribed, pushSupport, sendTestPush } from "../lib/push";
import { LP_DEFAULTS, useLpSettings, useWeeklyRecap } from "../lib/queries";
import type { LpSettings } from "../lib/types";
import { supabase } from "../lib/supabase";
import { USERNAME } from "./ProfileSetup";

export function Profile() {
  return (
    <div className="mx-auto max-w-lg space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>
      <Account />
      <Notifications />
      <LeaguePass />
      <Email />
    </div>
  );
}

function Account() {
  const userId = useUserId();
  const { profile, session } = useAuth();
  const notify = useNotice();
  const queryClient = useQueryClient();

  async function rename(username: string) {
    const { error } = await supabase.from("profiles").update({ username }).eq("id", userId);
    if (error?.code === "23505") throw new Error("That username is taken.");
    if (error) throw new Error(error.message);
    // Usernames show up in every league's members and standings.
    for (const key of ["profile", "members", "scoreboard", "myScores"]) queryClient.invalidateQueries({ queryKey: [key] });
    notify("Username updated.");
  }

  return (
    <Card>
      <div className="flex items-center gap-4">
        <Avatar name={profile?.username ?? ""} className="h-14 w-14 text-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-extrabold">
            <InlineEdit value={profile?.username ?? ""} label="username" maxLength={24}
              validate={(v) => (USERNAME.test(v) ? null : "2–24 characters: letters, numbers, spaces, _ . -")} onSave={rename} />
          </div>
          <div className="truncate text-sm text-mute">{session?.user.email}</div>
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-line/70 pt-4">
        <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
      </div>
    </Card>
  );
}

function Notifications() {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const support = pushSupport();

  const subscribed = useQuery({
    queryKey: ["pushDevice", userId],
    enabled: support === "supported",
    queryFn: isDeviceSubscribed,
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush() : disablePush()),
    onSuccess: (_, on) => {
      queryClient.setQueryData(["pushDevice", userId], on);
      notify(on ? "Notifications on for this device." : "Notifications off for this device.");
    },
    onError: (err) => notify(err.message, "error"),
  });
  const test = useMutation({
    mutationFn: sendTestPush,
    onSuccess: () => notify("Test sent. It should arrive in a few seconds."),
    onError: (err) => notify(err.message, "error"),
  });

  if (support === "unconfigured") return null;

  return (
    <Card title="Notifications">
      {support === "needs-install" ? (
        <div className="space-y-3 text-sm">
          <p>
            <span className="block font-semibold">Get notified when you're on the clock</span>
            <span className="block text-mute">
              On iPhone and iPad, notifications work once Win Totals is on your Home Screen. Add it, open it from there, and turn them on here.
            </span>
          </p>
          <InstallButton variant="primary" label="Show me how" />
        </div>
      ) : support === "unsupported" ? (
        <p className="text-sm text-mute">This browser doesn't support notifications. Try Chrome, Edge, Firefox, or Safari.</p>
      ) : subscribed.isPending ? (
        <div className="flex justify-center py-2 text-mint"><Spinner className="h-5 w-5" /></div>
      ) : (
        <div className="space-y-4">
          <Toggle
            checked={toggle.isPending ? toggle.variables : Boolean(subscribed.data)}
            onChange={(on) => toggle.mutate(on)}
            label={
              <span>
                <span className="block font-semibold">Notifications on this device</span>
                <span className="block text-xs text-mute">When you're on the clock in a draft, the Monday recap, and League Pass picks.</span>
              </span>
            }
          />
          {subscribed.data && !toggle.isPending && (
            <Button variant="secondary" size="sm" busy={test.isPending} onClick={() => test.mutate()}>
              Send a test
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Email() {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const recap = useWeeklyRecap(userId);

  const save = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase
        .from("email_preferences")
        .upsert({ user_id: userId, weekly_recap: on, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, on) => {
      queryClient.setQueryData(["emailPrefs", userId], on);
      notify(on ? "Weekly recap emails on." : "Weekly recap emails off.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  return (
    <Card title="Email">
      <Toggle
        checked={save.isPending ? save.variables : (recap.data ?? true)}
        onChange={(on) => save.mutate(on)}
        label={
          <span>
            <span className="block font-semibold">Weekly recap</span>
            <span className="block text-xs text-mute">Standings and your teams' wins, every Monday during the season.</span>
          </span>
        }
      />
    </Card>
  );
}

const LP_TOGGLES: { key: keyof LpSettings; title: string; hint: string; on: string; off: string }[] = [
  { key: "hide_scores", title: "Hide final scores", hint: "Tap to reveal, so a game you're watching later isn't spoiled.",
    on: "Scores hidden.", off: "Scores shown." },
  { key: "notify_daily", title: "Tonight's best game", hint: "A notification each afternoon with your top game.",
    on: "Daily pick on.", off: "Daily pick off." },
  { key: "notify_must_watch", title: "Must-watch alerts", hint: "About 30 minutes before a game you'd score 80 or higher.",
    on: "Must-watch alerts on.", off: "Must-watch alerts off." },
  { key: "notify_replies", title: "Replies to your comments", hint: "When someone replies in a game thread you've posted in.",
    on: "Reply notifications on.", off: "Reply notifications off." },
];

function LeaguePass() {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const settings = useLpSettings(userId);
  const current = settings.data ?? LP_DEFAULTS;

  const save = useMutation({
    mutationFn: async (next: LpSettings) => {
      const { error } = await supabase
        .from("lp_settings")
        .upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, next) => queryClient.setQueryData(["lpSettings", userId], next),
    onError: (err) => notify(err.message, "error"),
  });
  const shown = save.isPending ? save.variables : current;

  return (
    <Card title="League Pass">
      <div className="space-y-4">
        {LP_TOGGLES.map((t) => (
          <Toggle
            key={t.key}
            checked={shown[t.key]}
            onChange={(on) => save.mutate({ ...shown, [t.key]: on }, { onSuccess: () => notify(on ? t.on : t.off) })}
            label={
              <span>
                <span className="block font-semibold">{t.title}</span>
                <span className="block text-xs text-mute">{t.hint}</span>
              </span>
            }
          />
        ))}
        <p className="text-xs text-faint">Notifications need them turned on for this device above. Game picks also need your teams ranked.</p>
      </div>
    </Card>
  );
}
