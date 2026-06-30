self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "PhoneLink", body: event.data.text() }; }

  const title = payload.title ?? "PhoneLink";
  const type = payload.data?.type ?? "general";

  const typeConfig = {
    geofence_enter:  { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
    geofence_exit:   { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
    location_offline:{ icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
    location_online: { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
    location_stale:  { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
    sos:             { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: true  },
    grant:           { icon: "/favicon.ico", badge: "/favicon.ico", requireInteraction: false },
  };

  const cfg = typeConfig[type] ?? typeConfig.grant;

  const options = {
    body: payload.body ?? "",
    icon: cfg.icon,
    badge: cfg.badge,
    tag: payload.tag ?? type,
    data: payload.data ?? {},
    requireInteraction: cfg.requireInteraction,
    vibrate: type === "sos" ? [400, 100, 400, 100, 400] : [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const type = data.type ?? "general";

  const targetPath = type === "sos"
    ? "/live-map"
    : type === "geofence_enter" || type === "geofence_exit"
    ? "/live-map"
    : type === "location_offline" || type === "location_online" || type === "location_stale"
    ? "/live-map"
    : "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && "focus" in client) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICK", notifType: type, data, targetPath });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetPath);
    }),
  );
});
