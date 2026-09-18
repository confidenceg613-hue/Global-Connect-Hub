/**
 * Full page-by-page test of the Deep Falcon app.
 *
 * Seeds a real user + invite + accepted location session, then exercises every
 * endpoint each page calls, against the running API. Reports per-page results.
 *
 * Run: node artifacts/app/scripts/full-page-test.mjs [apiBase]
 */
const BASE = process.argv[2] || "http://localhost:8080";
const TAG = Date.now().toString().slice(-7);

let pass = 0, fail = 0;
const failures = [];
const byPage = new Map();

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/empty */ }
  return { status: res.status, json, text };
}

function check(page, label, res, ok, detail = "") {
  const r = res && typeof res === "object" ? res : { status: 0, text: String(res) };
  if (typeof ok !== "function") ok = (x) => x.status >= 200 && x.status < 300;
  const good = ok(r);
  byPage.set(page, (byPage.get(page) || 0) + (good ? 0 : 1));
  if (good) { pass++; console.log(`  ✅ ${label}${detail}`); }
  else {
    fail++;
    failures.push(`${page} :: ${label} -> ${r.status} ${String(r.text).slice(0, 120)}`);
    console.log(`  ❌ ${label} -> ${r.status} ${String(r.text).slice(0, 150)}`);
  }
  return r.json;
}

// ─────────────────────────── seed real data ───────────────────────────
console.log("═══ SEED ═══");
const user = (await call("POST", "/api/users", {
  name: `Full Test ${TAG}`, phoneNumber: `080${TAG}`, countryCode: "+234", countryIso: "NG",
})).json;
const uid = user.id;
console.log("  user:", uid);

const invite = (await call("POST", "/api/invites", {
  fromUserId: uid, toName: "Full Contact", toPhone: `+23480${TAG}`,
  message: "Track me", consentType: "location",
})).json;
const token = invite.token;
console.log("  invite:", invite.id, token);

const granted = (await call("POST", `/api/invites/by-token/${token}/grant`, {
  latitude: 9.0765, longitude: 7.3986, address: "Asokoro, Abuja",
})).json;
const sessionToken = granted?.sessionToken || "";
console.log("  granted:", granted?.status, "session:", sessionToken.slice(0, 8));

for (let i = 0; i < 3; i++) {
  await call("POST", "/api/location/push", {
    token, latitude: 9.0765 + i * 0.002, longitude: 7.3986 + i * 0.002,
    accuracy: 8 + i, status: "active", batteryLevel: 82 - i, batteryCharging: false,
    speed: 1.4, heading: 180 + i, source: "gps", address: `Point ${i}`,
  });
}
const grant = (await call("POST", `/api/invites/by-token/${token}/grant`, {
  latitude: 9.08, longitude: 7.4,
})).json;
const sessionToken2 = grant?.sessionToken || sessionToken;
await call("POST", "/api/location/heartbeat", {
  token, sessionToken: sessionToken2, latitude: 9.0813, longitude: 7.4041,
  accuracy: 9, batteryLevel: 80, status: "active",
});
await call("POST", "/api/signals/ingest", {
  token, signals: [{ type: "wifi", value: "test-ssid", strength: -55 }],
});
await call("POST", "/api/signals/ingest-batch", {
  token, signals: [{ type: "cell", value: "tower-1", strength: -70 }],
});
const geofence = (await call("POST", "/api/geofences", {
  userId: uid, name: "Home", latitude: 9.0765, longitude: 7.3986, radiusMeters: 500,
  color: "#22c55e", notifyOnEnter: true, notifyOnExit: true,
})).json;
const pin = (await call("POST", "/api/manual-pins", {
  userId: uid, label: "Meeting point", latitude: 9.08, longitude: 7.4, note: "test",
})).json;
await call("POST", "/api/geo-photos", {
  userId: uid, inviteToken: token, latitude: 9.07, longitude: 7.39,
  imageData: "data:image/png;base64,iVBORw0KGgo=", caption: "test photo",
});
await call("POST", "/api/geo-videos", {
  userId: uid, inviteToken: token, latitude: 9.07, longitude: 7.39, mimeType: "video/webm",
});
const group = (await call("POST", "/api/group-shares", {
  userId: uid, name: `Group ${TAG}`,
})).json;
const gid = group?.groupId || "";
if (gid) {
  await call("POST", `/api/group-shares/${gid}/join`, { userId: uid, name: `Member ${TAG}` });
  await call("POST", `/api/group-shares/${gid}/push`, { userId: uid, latitude: 9.07, longitude: 7.4 });
}
await call("POST", "/api/location-reports", {
  userId: uid, inviteToken: token, latitude: 9.07, longitude: 7.4, note: "test report",
});
await call("POST", "/api/sos", {
  userId: uid, inviteToken: token, latitude: 9.07, longitude: 7.4, message: "test sos",
});
await call("POST", "/api/consent-sessions", {
  inviteToken: token, timeToGrantMs: 4200,
  events: [{ type: "opened", at: new Date().toISOString() }],
});
await call("POST", "/api/notifications/read-all", { userId: uid });
const PUSH_ENDPOINT = `https://example.com/push/${TAG}`;
const pushSub = await call("POST", "/api/push/subscribe", {
  userId: uid, endpoint: PUSH_ENDPOINT, keys: { p256dh: "p256dh-key", auth: "auth-key" },
});
console.log("  push subscribe:", pushSub.status);

// A second user with the invitee's phone, so "send in app" has a real recipient.
// fullPhone = countryCode + phoneNumber, and it must equal the invite's toPhone.
const recipient = (await call("POST", "/api/users", {
  name: `Recipient ${TAG}`, phoneNumber: `80${TAG}`, countryCode: "+234", countryIso: "NG",
})).json;
console.log("  recipient:", recipient.id, recipient.fullPhone);
const assistant = await call("POST", "/api/assistant", { userId: uid, message: "hello" });
console.log("  assistant:", assistant.status);
await call("POST", "/api/whatsapp/link", { userId: uid, phone: `+23480${TAG}` });

// ─────────────────────────── per-page sweep ───────────────────────────
const pages = {
  "/ (landing/login)": () => [
    ["GET /api/users/:id", call("GET", `/api/users/${uid}`)],
    ["GET /api/access/:id/status", call("GET", `/api/access/${uid}/status`)],
    ["GET /api/access/payment-info", call("GET", "/api/access/payment-info")],
    ["POST /api/users (re-login)", call("POST", "/api/users", {
      name: `Full Test ${TAG}`, phoneNumber: `080${TAG}`, countryCode: "+234", countryIso: "NG",
    })],
  ],
  dashboard: () => [
    ["GET /api/users/:id", call("GET", `/api/users/${uid}`)],
    ["GET /api/consents/summary", call("GET", `/api/consents/summary?userId=${uid}`)],
    ["GET /api/invites", call("GET", `/api/invites?userId=${uid}`)],
    ["GET /api/sessions", call("GET", `/api/sessions?userId=${uid}`)],
    ["GET /api/notifications/:id/unread-count", call("GET", `/api/notifications/${uid}/unread-count`)],
  ],
  activity: () => [
    ["GET /api/notifications/:userId", call("GET", `/api/notifications/${uid}`)],
    ["GET /api/geo-photos/by-user/:userId", call("GET", `/api/geo-photos/by-user/${uid}`)],
  ],
  permissions: () => [
    ["GET /api/consents", call("GET", `/api/consents?userId=${uid}`)],
    ["POST /api/consents", call("POST", "/api/consents", {
      userId: uid, type: "location", status: "granted", purpose: "tracking",
    })],
  ],
  invites: () => [
    ["GET /api/invites?userId", call("GET", `/api/invites?userId=${uid}`)],
    ["GET /api/invites/:id", call("GET", `/api/invites/${invite.id}`)],
    ["GET /api/invites/by-token/:token", call("GET", `/api/invites/by-token/${token}`)],
    ["GET /api/invites/by-token/:token/sessions", call("GET", `/api/invites/by-token/${token}/sessions`)],
    // Recipients are resolved from the invite's toPhone against users.fullPhone.
    ["POST /api/invites/:id/send-in-app → recipient notified",
      call("POST", `/api/invites/${invite.id}/send-in-app`, {}),
      (r) => r.status === 200 && r.json?.ok === true],
    ["PATCH /api/invites/:id", call("PATCH", `/api/invites/${invite.id}`, { message: "updated" })],
  ],
  "/consent/:token": () => [
    ["GET /api/invite?token=", call("GET", `/api/invite?token=${token}`)],
    ["GET /api/healthz", call("GET", "/api/healthz")],
    ["GET /api/consent-sessions/:token", call("GET", `/api/consent-sessions/${token}`)],
    ["GET /api/invites/by-token/:token", call("GET", `/api/invites/by-token/${token}`)],
  ],
  sessions: () => [
    ["GET /api/sessions", call("GET", `/api/sessions?userId=${uid}`)],
    ["GET /api/notifications/:userId", call("GET", `/api/notifications/${uid}`)],
    ["GET /api/notifications/clear (spare)", call("GET", `/api/notifications/${uid}/unread-count`)],
  ],
  "/shared-coordinates": () => [
    ["GET /api/invites", call("GET", `/api/invites?userId=${uid}`)],
    ["GET /api/location/latest/:token", call("GET", `/api/location/latest/${token}`)],
  ],
  "/location-history": () => [
    ["GET /api/location/history/:token", call("GET", `/api/location/history/${token}`)],
    ["GET /api/location/latest/:token", call("GET", `/api/location/latest/${token}`)],
    ["GET /api/location/latest-for-user/:userId", call("GET", `/api/location/latest-for-user/${uid}`)],
  ],
  "/movement-patterns": () => [
    ["GET /api/location/movement-analysis/:token", call("GET", `/api/location/movement-analysis/${token}`)],
  ],
  "/behavioral-signatures": () => [
    ["GET /api/movement-patterns", call("GET", `/api/movement-patterns?inviteId=${invite.id}&userId=${uid}&daysBack=30`)],
  ],
  "/signal-fusion": () => [
    ["GET /api/signals/fused/:token", call("GET", `/api/signals/fused/${token}`)],
    ["GET /api/signals/raw/:token", call("GET", `/api/signals/raw/${token}`)],
    ["GET /api/signals/estimate/:token", call("GET", `/api/signals/estimate/${token}`)],
    ["GET /api/signals/quiet-inference/:token", call("GET", `/api/signals/quiet-inference/${token}`)],
    ["GET /api/signals/spoof-analysis/:token", call("GET", `/api/signals/spoof-analysis/${token}`)],
  ],
  "/live-map": () => [
    ["GET /api/sessions", call("GET", `/api/sessions?userId=${uid}`)],
    ["GET /api/location/history/:token", call("GET", `/api/location/history/${token}`)],
    ["GET /api/location/latest/:token", call("GET", `/api/location/latest/${token}`)],
    ["GET /api/location-updates/:userId", call("GET", `/api/location-updates/${uid}`)],
    ["GET /api/location-overrides/by-token/:token", call("GET", `/api/location-overrides/by-token/${token}`)],
    ["GET /api/geofences/:userId", call("GET", `/api/geofences/${uid}`)],
    ["GET /api/manual-pins/:userId", call("GET", `/api/manual-pins/${uid}`)],
    ["GET /api/signals/estimate/:token", call("GET", `/api/signals/estimate/${token}`)],
    ["GET /api/guardian/brief", call("GET", `/api/guardian/brief?userId=${uid}`)],
  ],
  profile: () => [
    ["GET /api/users/:id", call("GET", `/api/users/${uid}`)],
    ["PATCH /api/users/:id", call("PATCH", `/api/users/${uid}`, { name: `Full Test ${TAG}` })],
  ],
  geoboard: () => [
    ["GET /api/geo-photos/by-user/:userId", call("GET", `/api/geo-photos/by-user/${uid}`)],
    ["GET /api/geo-videos/by-user/:userId", call("GET", `/api/geo-videos/by-user/${uid}`)],
    ["GET /api/geo-photos/by-token/:token", call("GET", `/api/geo-photos/by-token/${token}`)],
    ["GET /api/geo-videos/by-token/:token", call("GET", `/api/geo-videos/by-token/${token}`)],
  ],
  "/location-reports": () => [
    ["GET /api/location-reports/by-user/:userId", call("GET", `/api/location-reports/by-user/${uid}`)],
  ],
  settings: () => [
    ["GET /api/location-updates/:userId (export)", call("GET", `/api/location-updates/${uid}`)],
    ["GET /api/invites (export)", call("GET", `/api/invites?userId=${uid}`)],
    ["GET /api/push/vapid-public-key", call("GET", "/api/push/vapid-public-key")],
    ["POST /api/push/subscribe", call("POST", "/api/push/subscribe", {
      userId: uid, endpoint: `${PUSH_ENDPOINT}-2`, keys: { p256dh: "p", auth: "a" },
    })],
    ["DELETE /api/push/subscribe", call("DELETE", "/api/push/subscribe", { endpoint: `${PUSH_ENDPOINT}-2` })],
    ["DELETE /api/push/subscribe (no body → 400, not 500)",
      call("DELETE", "/api/push/subscribe"), (r) => r.status === 400],
  ],
  surveillance: () => [
    // NOTE: /api/interpreter on this page is the external Overpass API, not ours.
    ["GET /api/invites", call("GET", `/api/invites?userId=${uid}`)],
    ["GET /api/location/history/:token", call("GET", `/api/location/history/${token}`)],
  ],
  guardian: () => [
    ["GET /api/guardian/brief", call("GET", `/api/guardian/brief?userId=${uid}`)],
  ],
  "/security-center": () => [
    ["GET /api/geo-photos/by-user/:userId", call("GET", `/api/geo-photos/by-user/${uid}`)],
    ["GET /api/geo-videos/by-user/:userId", call("GET", `/api/geo-videos/by-user/${uid}`)],
    ["GET /api/notifications/:userId", call("GET", `/api/notifications/${uid}`)],
  ],
  "/panic-log": () => [
    ["GET /api/notifications (all)", call("GET", `/api/notifications/${uid}`)],
    ["GET /api/notifications?sos (filter)", call("GET", `/api/notifications/${uid}?type=sos`)],
    ["POST /api/sos", call("POST", "/api/sos", {
      userId: uid, inviteToken: token, latitude: 9.07, longitude: 7.4, message: "panic test",
    })],
  ],
  "/evidence-vault": () => [
    ["GET /api/geo-photos/by-user/:userId", call("GET", `/api/geo-photos/by-user/${uid}`)],
    ["GET /api/geo-videos/by-user/:userId", call("GET", `/api/geo-videos/by-user/${uid}`)],
  ],
  gmap: () => [
    ["GET /api/group-shares", call("GET", `/api/group-shares?userId=${uid}`)],
    ...(gid ? [
      ["GET /api/group-shares/:id/info", call("GET", `/api/group-shares/${gid}/info`)],
      ["GET /api/group-shares/:id/members", call("GET", `/api/group-shares/${gid}/members?userId=${uid}`)],
    ] : [["group create returned no groupId",
      Promise.resolve({ status: 0, text: "no groupId" })]]),
    ["GET /api/sessions (member pins)", call("GET", `/api/sessions?userId=${uid}`)],
  ],
  "/ip-lookup": () => [
    ["GET /api/ip-lookup?ip=", call("GET", `/api/ip-lookup?userId=${uid}&ip=8.8.8.8`)],
    // my-ip needs a public IP; a sandbox box has none (422 is the correct answer).
    ["GET /api/ip-lookup/my-ip", call("GET", "/api/ip-lookup/my-ip"), (r) => r.status === 200 || r.status === 422],
    ["GET /api/ip-lookup/lan", call("GET", `/api/ip-lookup/lan?userId=${uid}`)],
  ],
  "/maps + geocode": () => [
    ["GET /api/maps/reverse-geocode", call("GET", "/api/maps/reverse-geocode?lat=9.07&lng=7.4")],
    ["GET /api/maps/geocode", call("GET", "/api/maps/geocode?place=Abuja")],
    ["GET /api/maps/place-info", call("GET", "/api/maps/place-info?place=Abuja")],
    // Mapillary-gated; the client treats !ok as { available: false }.
    ["GET /api/maps/street-view (key-gated)", call("GET", "/api/maps/street-view?lat=9.07&lng=7.4"),
      (r) => r.status === 200 || r.status === 503],
  ],
  "/assistant + whatsapp": () => [
    ["POST /api/assistant (AI)", call("POST", "/api/assistant", { userId: uid, message: "status?" })],
    ["GET /api/assistant/history", call("GET", `/api/assistant/history?userId=${uid}`)],
    ["GET /api/images/search", call("GET", "/api/images/search?q=map")],
    ["POST /api/whatsapp/link", call("POST", "/api/whatsapp/link", {
      userId: uid, phoneNumber: `+23480${TAG}`,
    }), (r) => r.status < 500],
  ],
  "/admin": () => [
    // Admin is gated on ADMIN_PASSWORD; a clean 503 (not a crash) is correct here.
    ["GET /api/admin/overview (gated)", call("GET", "/api/admin/overview"), (r) => r.status === 200 || r.status === 503],
    ["GET /api/admin/users/:id/history (gated)", call("GET", `/api/admin/users/${uid}/history`), (r) => r.status === 200 || r.status === 503],
    ["GET /api/admin/codes (gated)", call("GET", "/api/admin/codes"), (r) => r.status === 200 || r.status === 503],
    ["GET /api/admin/consents (gated)", call("GET", "/api/admin/consents"), (r) => r.status === 200 || r.status === 503],
  ],
  "/notifications SSE + location SSE": () => [
    ["GET /api/notifications (recipient got the in-app request)",
      call("GET", `/api/notifications/${recipient.id}?type=location_request`),
      (r) => Array.isArray(r.json) && r.json.length > 0,
      ` (${0} rows)`],
  ],
  "/subscription": () => [
    ["GET /api/access/payment-info", call("GET", "/api/access/payment-info")],
    ["GET /api/access/:id/status", call("GET", `/api/access/${uid}/status`)],
    ["POST /api/access/:id/check-in", call("POST", `/api/access/${uid}/check-in`, {})],
  ],
};

for (const [page, fn] of Object.entries(pages)) {
  console.log(`\n═══ ${page} ═══`);
  for (const [label, promise, ok] of fn()) check(page, label, await promise, ok);
}

// ───────────────── SSE realtime channels ─────────────────
async function readSse(label, path, trigger, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let got = "";
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        got += dec.decode(value, { stream: true });
        if (got.includes("data:")) break;
      }
    })();
    // The route registers the client before flushing headers, so an event
    // fired now is guaranteed to reach this stream.
    if (trigger) await trigger();
    await pump;
    const ok = got.includes("data:");
    check("SSE", `${label}${ok ? " (event received)" : " (no event in " + timeoutMs + "ms)"}`,
      { status: ok ? 200 : 500, text: got.replace(/\n/g, " ").slice(0, 90) });
  } catch (e) {
    check("SSE", `${label} — ${e.message}`, { status: 0, text: "" });
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

console.log("\n═══ SSE realtime (connect → trigger → receive) ═══");
await readSse("GET /api/notifications/:userId/stream", `/api/notifications/${uid}/stream`,
  () => call("POST", "/api/location/push", {
    token, latitude: 9.09, longitude: 7.41, accuracy: 7, status: "active", batteryLevel: 70,
  }));
await readSse("GET /api/location/stream/:token", `/api/location/stream/${token}`,
  () => call("POST", "/api/location/push", {
    token, latitude: 9.091, longitude: 7.411, accuracy: 6, status: "active", batteryLevel: 69,
  }));

console.log(`\n═══════════ TOTAL: ${pass} passed, ${fail} failed ═══════════`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  •", f);
}
process.exit(fail ? 1 : 0);
