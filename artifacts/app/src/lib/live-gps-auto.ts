/**
 * Auto-publish GPS to the live channel.
 *
 * Consent page: monkey-patches window.fetch so every existing
 * POST /api/location/push (grant coords, live GPS, offline status) is
 * transparently mirrored to the MQTT live channel — zero changes to the
 * page's tracking flow, works even though production has no API server.
 *
 * Owner side: monkey-patches window.open so every `sms:` invite link the
 * owner creates is parsed and the new consent token is remembered locally —
 * which is exactly what the owner's Live Map subscribes to.
 *
 * The mqtt client is dynamically imported so it never lands in the critical
 * boot bundle — it loads on first real use only.
 */

let installed = false;

export function installLiveGpsAutoPublish(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // ── Recipient side: mirror consent-page location pushes ──────────────────
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string" ? input :
        input instanceof URL ? input.toString() :
        input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

      if (method === "POST" && url.includes("/api/location/push") && init?.body) {
        const body = JSON.parse(String(init.body)) as {
          token?: string; latitude?: number; longitude?: number;
          accuracy?: number; status?: string;
        };
        if (body.token && typeof body.latitude === "number" && typeof body.longitude === "number") {
          void import("./live-gps").then(({ publishLiveGps }) =>
            publishLiveGps({
              type: "gps",
              token: body.token!,
              latitude: body.latitude!,
              longitude: body.longitude!,
              accuracy: body.accuracy,
              status: (body.status as "active" | "offline") ?? "active",
            }));
        }
      }

      // The consent grant endpoint — the moment access is accepted.
      if (method === "POST" && url.includes("/grant") && init?.body) {
        try {
          const body = JSON.parse(String(init.body)) as { latitude?: number; longitude?: number };
          const token = url.split("/api/invites/by-token/")[1]?.split("/")[0];
          if (token && typeof body.latitude === "number" && typeof body.longitude === "number") {
            void import("./live-gps").then(({ publishLiveGps }) =>
              publishLiveGps({
                type: "grant", token,
                latitude: body.latitude!, longitude: body.longitude!,
              }));
          }
        } catch { /* non-critical */ }
      }
    } catch { /* interceptor must never break the real request */ }
    return originalFetch(input, init);
  };

  // ── Owner side: remember tokens of links this device creates ─────────────
  const originalOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    try {
      const href = typeof url === "string" ? url : url?.toString() ?? "";
      if (href.startsWith("sms:")) {
        const m = href.match(/https?:\/\/\S+\/consent\/([A-Za-z0-9_-]+)/);
        if (m?.[1]) {
          const token = m[1];
          void import("./live-gps").then(({ rememberOwnerToken }) => rememberOwnerToken(token));
        }
      }
    } catch { /* non-critical */ }
    return originalOpen(url, target, features);
  };
}
