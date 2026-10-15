// Service worker: shows push notifications and opens the app when one is tapped, and serves
// team logos cache-first. Nothing else is cached; the app always loads from the network.

// Bump the version when the files in public/logos change, so clients drop the old copies.
const LOGO_CACHE = "logos-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("logos-") && k !== LOGO_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const logos = new URL("logos/", self.registration.scope);
  if (event.request.method !== "GET" || url.origin !== logos.origin || !url.pathname.startsWith(logos.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(LOGO_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    })(),
  );
});

// Payload from the send-push Edge Function: { title, body, url, tag }.
// Every push must show a notification; iOS revokes the subscription of apps that don't.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Win Totals", {
      body: data.body || "",
      tag: data.tag,
      icon: new URL("icon-192.png", self.registration.scope).href,
      data: { url: new URL(data.url || "", self.registration.scope).href },
    }),
  );
});

// Focus an open window on the target page if there is one, otherwise open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          try {
            await client.navigate(url);
          } catch {
            // Not controlled by this worker yet (first load): it's focused, that will do.
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
