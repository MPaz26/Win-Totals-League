// Web Push for this device. On iPhone and iPad it only works once the app has been added
// to the Home Screen (iOS 16.4+), and the permission prompt has to come from a tap.

import { rpc, supabase } from "./supabase";

const BASE = import.meta.env.BASE_URL;
const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * "supported": can turn on here. "needs-install": iOS in a browser tab, works after Add to
 * Home Screen. "unsupported": this browser can't. "unconfigured": no VAPID key in the build.
 */
export type PushSupport = "supported" | "needs-install" | "unsupported" | "unconfigured";

export function pushSupport(): PushSupport {
  if (!PUBLIC_KEY) return "unconfigured";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  if (isIos() && !isStandalone()) return "needs-install";
  return "unsupported";
}

/** Registers sw.js at startup; it's also what makes the app installable on Android and desktop. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch((err) => {
    console.warn("Service worker registration failed", err);
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(BASE);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether this device gets the signed-in user's notifications. */
export async function isDeviceSubscribed(): Promise<boolean> {
  if (pushSupport() !== "supported" || Notification.permission !== "granted") return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  // The server drops subscriptions that expire, and the row belongs to whoever saved it last.
  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("endpoint", sub.endpoint);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** Asks for permission and saves this device's subscription. Call straight from a tap. */
export async function enablePush(): Promise<void> {
  // First await: iOS only shows the prompt while the tap is still "active".
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error(
      isIos()
        ? "Notifications are blocked. Turn them on in Settings → Notifications → Win Totals."
        : "Notifications are blocked for this site. Allow them in your browser's site settings.",
    );
  }
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(PUBLIC_KEY!) }));
  const { keys } = sub.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error("This browser returned an incomplete subscription.");
  await rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
}

/** Stops notifications on this device. Also run on sign-out, so the next person doesn't get yours. */
export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Sends a test notification to every device the user has turned on. */
export async function sendTestPush(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ sent: number }>("send-push", { body: { test: true } });
  if (error) throw new Error("Couldn't reach the notification service.");
  if (!data?.sent) throw new Error("No device accepted the test. Try turning notifications off and on.");
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
