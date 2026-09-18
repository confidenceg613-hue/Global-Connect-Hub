/**
 * Sends a real invite through the app's own origin and narrates what happens,
 * exactly as a browser would: sender signs up → invite created → invitee opens
 * the link → grants location → streams GPS → sender's bell + Live Map update.
 *
 * Run: node artifacts/app/scripts/send-invite-demo.mjs [origin]
 */
const ORIGIN = process.argv[2] || "http://localhost:3000";
const TAG = Date.now().toString().slice(-7);
const BASE_URL = ORIGIN;

async function api(method, path, body) {
  const res = await fetch(ORIGIN + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}
const show = (v) => JSON.stringify(v).slice(0, 200);

console.log(`ORIGIN: ${ORIGIN}\n`);

// ── 1. Sender signs up (the login on the landing page) ──────────────────
console.log("①  Sender login: POST /api/users");
const sender = (await api("POST", "/api/users", {
  name: `Ada ${TAG}`, phoneNumber: `80${TAG}`, countryCode: "+234", countryIso: "NG",
})).json;
console.log(`   → userId ${sender.id}, ${sender.fullPhone}, existing=${sender.isExistingUser}`);

// ── 2. Sender sends an invite ───────────────────────────────────────────
console.log("\n②  Sender sends invite: POST /api/invites");
const inviteePhone = `70${TAG}`;
const invite = (await api("POST", "/api/invites", {
  fromUserId: sender.id, toName: "Chidi (invitee)", toPhone: `+234${inviteePhone}`,
  message: "Track me for the next hour", consentType: "location", baseUrl: BASE_URL,
})).json;
console.log(`   → inviteId ${invite.id}, status=${invite.status}`);
console.log(`   → SMS link:     ${invite.whatsappLink?.slice(0, 90)}`);
const pageUrl = `${BASE_URL}/consent/${invite.token}`;
console.log(`   → consent page: ${pageUrl}`);

// ── 3. Invitee opens the link (browser hits the page, then the API) ─────
console.log("\n③  Invitee opens the link");
const shell = await fetch(pageUrl);
console.log(`   → GET /consent/${invite.token} → HTTP ${shell.status} (SPA shell loaded)`);
const flat = await api("GET", `/api/invite?token=${invite.token}`);
console.log(`   → GET /api/invite?token=  → HTTP ${flat.status}  ${show(flat.json)}`);
const byToken = await api("GET", `/api/invites/by-token/${invite.token}`);
console.log(`   → GET /api/invites/by-token/:token → HTTP ${byToken.status}  fromUser="${byToken.json?.fromUserName}"`);

// ── 4. Invitee grants location ──────────────────────────────────────────
console.log("\n④  Invitee taps GRANT at 9.0765, 7.3986 (Asokoro, Abuja)");
// The consent page tries the flat endpoint first, then falls back to the
// generated client's nested route (see grantViaFlatEndpoint in consent.tsx).
let granted = (await api("POST", "/api/grant", {
  token: invite.token, latitude: 9.0765, longitude: 7.3986, address: "Asokoro, Abuja",
})).json;
let via = "/api/grant (flat)";
if (!granted?.sessionToken) {
  console.log(`   → flat /api/grant gave no session — falling back to the nested route`);
  granted = (await api("POST", `/api/invites/by-token/${invite.token}/grant`, {
    latitude: 9.0765, longitude: 7.3986, address: "Asokoro, Abuja",
  })).json;
  via = "nested /api/invites/by-token/:token/grant";
}
console.log(`   → via ${via}: status=${granted?.status}, ` +
  `sessionToken=${granted?.sessionToken ? "issued" : "MISSING"}`);

// ── 5. Invitee streams live GPS ─────────────────────────────────────────
console.log("\n⑤  Invitee's phone streams GPS as they move");
for (let i = 1; i <= 3; i++) {
  const r = await api("POST", "/api/location/push", {
    token: invite.token,
    latitude: 9.0765 + i * 0.002, longitude: 7.3986 + i * 0.0015,
    accuracy: 8, status: "active", batteryLevel: 82 - i, batteryCharging: false,
    speed: 1.4, heading: 90 + i, source: "gps", address: `Move ${i}`,
  });
  console.log(`   → fix #${i} (${(9.0765 + i * 0.002).toFixed(4)}, ${(7.3986 + i * 0.0015).toFixed(4)}) → HTTP ${r.status}`);
}

// ── 6. Sender's bell ────────────────────────────────────────────────────
console.log("\n⑥  SENDER: what landed in the notification bell?");
const bell = (await api("GET", `/api/notifications/${sender.id}`)).json;
const count = (await api("GET", `/api/notifications/${sender.id}/unread-count`)).json;
console.log(`   → unread count: ${count?.count}`);
for (const n of (bell || []).slice(0, 6)) {
  console.log(`   → [${n.type}] "${n.title}" — ${n.body}${n.data?.latitude ? ` @ ${n.data.latitude},${n.data.longitude}` : ""}`);
}

// ── 7. Live Map ─────────────────────────────────────────────────────────
console.log("\n⑦  SENDER: Live Map / Active Sessions");
const sessions = (await api("GET", `/api/sessions?userId=${sender.id}`)).json;
for (const s of sessions || []) {
  console.log(`   → ${s.toName || s.toPhone}: ${s.status} @ ${s.latitude},${s.longitude} ` +
    `(battery ${s.batteryLevel ?? "n/a"}) ${s.googleMapsLiveLink ? "· maps link ✓" : "· NO maps link"}`);
}
const latest = (await api("GET", `/api/location/latest/${invite.token}`)).json;
console.log(`   → latest pin: ${latest?.latitude},${latest?.longitude} acc=${latest?.accuracy} addr=${latest?.address ?? "-"}`);
const hist = (await api("GET", `/api/location/history/${invite.token}`)).json;
console.log(`   → journey stored: ${Array.isArray(hist) ? hist.length : 0} fixes`);
const geofences = (await api("GET", `/api/geofences/${sender.id}`)).json;
const pins = (await api("GET", `/api/manual-pins/${sender.id}`)).json;
console.log(`   → map layers: ${Array.isArray(geofences) ? geofences.length : 0} geofences, ${Array.isArray(pins) ? pins.length : 0} saved pins`);

// ── 8. Realtime channel ─────────────────────────────────────────────────
console.log("\n⑧  SENDER: realtime channel (bell stream) while invitee moves");
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 8000);
let seen = "";
try {
  const res = await fetch(`${ORIGIN}/api/notifications/${sender.id}/stream`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  await api("POST", "/api/location/push", {
    token: invite.token, latitude: 9.0899, longitude: 7.4044,
    accuracy: 5, status: "active", batteryLevel: 76,
  });
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += dec.decode(value, { stream: true });
    if (seen.includes('"location_update"') || seen.split("data:").length > 2) break;
  }
  console.log(`   → event received live: ${seen.includes("location_update") ? "YES" : "no"} ` +
    `(${seen.replace(/\n/g, " ").slice(0, 110)})`);
} catch (e) {
  console.log(`   → stream error: ${e.message}`);
} finally {
  clearTimeout(t);
  ctrl.abort();
}

console.log(`\n═══ RESULT: invite ${invite.token} → accepted, ${bell?.length ?? 0} bell notifications for the sender.`);
console.log(`    Open as the sender: ${BASE_URL}/live-map`);
console.log(`    Open as the invitee: ${pageUrl}`);
process.exit(0);
