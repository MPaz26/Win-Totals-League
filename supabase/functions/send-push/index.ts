// Sends Web Push notifications to every device a user has turned them on for.
//
// Callers:
//   - the database's on-the-clock trigger (via pg_net) and the weekly recap job: header
//     x-push-secret, body { messages: [{ user_id, title, body, url?, tag?, ttl? }] }
//   - the web app's "Send a test" button: the user's own JWT, body { test: true }.
//     It can only reach the caller's own devices.
//
// Subscriptions the push service reports as gone (404/410) are deleted. Deployed with
// verify_jwt off (see config.toml), since the trusted callers authenticate with the secret.
//
// Secrets (set by the "Push notifications" workflow):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: contact), PUSH_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import webpush from "npm:web-push@3.6.7";

interface Message {
  user_id: string;
  title: string;
  body: string;
  /** Relative to the app, e.g. "league/<id>". The service worker resolves it against its scope. */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
  /** Seconds the push service should keep trying an offline device. */
  ttl?: number;
}

interface Subscription {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const PUSH_SECRET = env("PUSH_SECRET");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let messages: Message[];
  if (req.headers.get("x-push-secret") === PUSH_SECRET) {
    ({ messages } = await req.json());
    if (!Array.isArray(messages)) return json({ error: "messages must be an array" }, 400);
  } else {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!data.user) return json({ error: "Unauthorized" }, 401);
    messages = [{
      user_id: data.user.id,
      title: "Notifications are on",
      body: "You'll get one when you're on the clock, and a recap every Monday.",
      tag: "test",
      ttl: 60,
    }];
  }

  const userIds = [...new Set(messages.map((m) => m.user_id))];
  if (userIds.length === 0) return json({ sent: 0, expired: 0, failed: 0 });
  const { data, error } = await db.from("push_subscriptions").select("endpoint, user_id, p256dh, auth").in("user_id", userIds);
  if (error) return json({ error: error.message }, 500);
  const subs = data as Subscription[];

  const outcomes = await Promise.all(
    messages.flatMap((m) => subs.filter((s) => s.user_id === m.user_id).map((s) => send(s, m))),
  );
  const count = (o: string) => outcomes.filter((x) => x === o).length;
  return json({ sent: count("sent"), expired: count("expired"), failed: count("failed") });
});

async function send(sub: Subscription, m: Message): Promise<"sent" | "expired" | "failed"> {
  try {
    // web-push does the payload encryption and VAPID signing; fetch does the delivery.
    const req = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: m.title, body: m.body, url: m.url ?? "", tag: m.tag }),
      { TTL: m.ttl ?? 86400, urgency: "high" },
    );
    const res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body });
    if (res.ok) return "sent";
    if (res.status === 404 || res.status === 410) {
      await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      return "expired";
    }
    console.error(`push to ${new URL(sub.endpoint).host} failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`push to ${new URL(sub.endpoint).host} failed: ${err instanceof Error ? err.message : err}`);
  }
  return "failed";
}
