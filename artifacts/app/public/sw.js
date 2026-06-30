// PhoneLink Service Worker
// Handles push notifications and notification clicks only.
// Does NOT intercept fetch requests — page navigation is always handled by the server.

self.addEventListener("install", () => {
  // Activate immediately without waiting for old SW to be replaced
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all open pages immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "PhoneLink", body: event.data.text() };
  }

  const title = payload.title ?? "PhoneLink";
  const type = payload.data?.type ?? "general";

  const requireInteraction = type === "sos";
  const vibrate = type === "sos"
    ? [400, 100, 400, 100, 400]
    : [200, 100, 200];

  const options = {
    body: payload.body ?? "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag ?? type,
    data: payload.data ?? {},
    requireInteraction,
    vibrate,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const type = data.type ?? "general";

  const targetPath =
    type === "sos" ||
    type === "geofence_enter" ||
    type === "geofence_exit" ||
    type === "location_offline" ||
    type === "location_online" ||
    type === "location_stale"
      ? "/live-map"
      : "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing tab if one is open
        for (const client of windowClients) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({
              type: "NOTIFICATION_CLICK",
              notifType: type,
              data,
              targetPath,
            });
            return;
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetPath);
        }
      }),
  );
});
