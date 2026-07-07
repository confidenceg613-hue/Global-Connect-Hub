// PhoneLink Service Worker
// Handles push notifications, notification clicks, and persistent GPS tracking notification.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Persistent GPS tracking notification ─────────────────────────────────────
// The page posts a message to show/hide this when GPS tracking starts or stops.
// keepalive=true prevents the notification from being auto-dismissed by Android.
// When the user swipes it away, we broadcast to all clients to stop tracking.

const GPS_NOTIF_TAG = "phonelink-gps-active";

self.addEventListener("message", (event) => {
  const { type, inviterName } = event.data ?? {};

  if (type === "LOCATION_TRACKING_STARTED") {
    const name = inviterName ? `${inviterName}` : "your contact";
    self.registration.showNotification("📍 GPS Active — PhoneLink", {
      body: `Sharing live location with ${name}. Swipe to stop tracking.`,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: GPS_NOTIF_TAG,
      renotify: false,
      requireInteraction: true,   // stays pinned until user acts
      silent: true,               // no sound — it's a status indicator
      data: { type: "gps_active" },
    });
    return;
  }

  if (type === "LOCATION_TRACKING_STOPPED") {
    self.registration.getNotifications({ tag: GPS_NOTIF_TAG }).then((notifs) => {
      notifs.forEach((n) => n.close());
    });
    return;
  }
});

// When the user swipes the GPS notification away, tell the open page to stop tracking
self.addEventListener("notificationclose", (event) => {
  if (event.notification.tag !== GPS_NOTIF_TAG) return;
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ type: "STOP_TRACKING_FROM_NOTIFICATION" });
    }
  });
});

// ── Push notifications ────────────────────────────────────────────────────────
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

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const type = data.type ?? "general";

  // Tapping the GPS active notification re-opens the consent page context
  if (type === "gps_active") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
        // Focus an existing tab if one exists
        for (const client of windowClients) {
          if ("focus" in client) { client.focus(); return; }
        }
        // Otherwise open dashboard so user can see status
        if (self.clients.openWindow) return self.clients.openWindow("/dashboard");
      }),
    );
    return;
  }

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
        for (const client of windowClients) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({ type: "NOTIFICATION_CLICK", notifType: type, data, targetPath });
            return;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetPath);
      }),
  );
});
