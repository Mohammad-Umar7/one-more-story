/* One More Story service worker: shows caregiver alerts even when the app is closed. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "One More Story";
  const options = {
    body: data.body || "There is a new update in your caregiver inbox.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    // Same tag = the same alert replaces itself instead of stacking twice.
    tag: data.tag || "one-more-story",
    renotify: false,
    requireInteraction: Boolean(data.alertId),
    timestamp: data.createdAt ? Date.parse(data.createdAt) : Date.now(),
    data: { url: data.url || "/caregiver", alertId: data.alertId || null },
    actions: data.actions ? [{ action: "seen", title: "Mark as seen" }, { action: "open", title: "Open" }] : [],
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      pages.forEach((p) => p.postMessage({ type: "alert", alertId: data.alertId || null }));
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const { url, alertId } = event.notification.data || {};
  event.notification.close();
  if (event.action === "seen" && alertId) {
    event.waitUntil(fetch(`/api/alerts/${alertId}/seen`, { method: "POST" }).catch(() => undefined));
    return;
  }
  const target = new URL(url || "/caregiver", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const p of pages) {
        if (new URL(p.url).pathname.startsWith("/caregiver")) {
          await p.focus();
          if ("navigate" in p) await p.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
