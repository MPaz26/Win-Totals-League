import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useNotice } from "../lib/notice";
import { enablePush, isDeviceSubscribed, pushSupport } from "../lib/push";
import { InstallButton } from "./InstallGuide";
import { Button } from "./ui";

// Asks signed-in members to turn notifications on for this device. The browser's own
// permission prompt can only come from a tap (iOS insists), so this is a banner with a button.
// "Not now" hides it on this device for a week; turning notifications off in Profile hides it for good.

const SNOOZE_KEY = "pushPromptSnoozedUntil";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/** Stops the banner on this device, for a week or (forever) until storage is cleared. */
export function snoozePushPrompt(forever = false) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(forever ? Number.MAX_SAFE_INTEGER : Date.now() + WEEK));
  } catch {
    // Private mode or blocked storage: the banner just comes back next visit.
  }
}

export function NotificationPrompt() {
  const { session, profile } = useAuth();
  const { pathname } = useLocation();
  const userId = session?.user.id;
  const notify = useNotice();
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState(snoozed);
  const support = pushSupport();
  const askable = support === "supported" && "Notification" in window && Notification.permission !== "denied";

  // Same key as the Profile toggle, so turning it on in either place updates both.
  const subscribed = useQuery({
    queryKey: ["pushDevice", userId],
    enabled: Boolean(userId && profile && askable && !hidden),
    queryFn: isDeviceSubscribed,
  });
  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: () => {
      queryClient.setQueryData(["pushDevice", userId], true);
      notify("Notifications on for this device.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  // Profile has its own notifications card.
  if (!userId || !profile || hidden || pathname === "/profile") return null;
  if (support === "needs-install") {
    return (
      <Banner
        text="On iPhone and iPad, add Win Totals to your Home Screen to get notified when you're on the clock."
        action={<InstallButton variant="primary" label="Show me how" />}
        onDismiss={() => { snoozePushPrompt(); setHidden(true); }}
      />
    );
  }
  if (!askable || subscribed.data !== false) return null;
  return (
    <Banner
      text="Turn on notifications to hear when you're on the clock, plus the Monday recap and League Pass picks."
      action={<Button size="sm" busy={enable.isPending} onClick={() => enable.mutate()}>Turn on</Button>}
      onDismiss={() => { snoozePushPrompt(); setHidden(true); }}
    />
  );
}

function Banner({ text, action, onDismiss }: { text: string; action: ReactNode; onDismiss: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-panel p-4 ring-1 ring-mint/40 sm:mb-6 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm">
        <span className="block font-semibold">Get notifications</span>
        <span className="block text-mute">{text}</span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <Button variant="ghost" size="sm" onClick={onDismiss}>Not now</Button>
      </div>
    </div>
  );
}
