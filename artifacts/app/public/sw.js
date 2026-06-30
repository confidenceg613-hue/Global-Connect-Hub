self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "PhoneLink", body: event.data.text() }; }

  const title = payload.title ?? "PhoneLink";
  const options = {
    body: payload.body ?? "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag ?? "phonelink",
    data: payload.data ?? {},
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && "focus" in client) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICK", tag: event.notification.tag, data: event.notification.data });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow("/live-map");
    }),
  );
});
