/**
 * Live-domain E2E — runs the full invite flow against the DEPLOYED app,
 * calling exactly the URLs a browser with the production API bridge calls:
 *   - direct Python functions: /api/user-style flat paths (/api/invite, /api/grant, /api/location/push)
 *   - everything else bridged: /api/index?__path=<rest>
 *
 * Run: node scripts/live-domain-e2e.js https://deeepfalcon.freebuff.app
 */
const ORIGIN = process.argv[2] || "https://deeepfalcon.freebuff.app";
const TAG = Date.now().toString().slice(-7);

async function api(method, path, body) {
  const res = await fetch(ORIGIN + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text };
}
const bridge = (rest) => {
  const [path, qs] = rest.split("?");
  // The app's bridge keeps query params BESIDE __path (the entry point only
  // reads the path from it): /api/index?userId=2&__path=sessions
  return qs ? `/api/index?${qs}&__path=${path}` : `/api/index?__path=${path}`;
};
let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  pass += cond; fail += !cond;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  return cond;
};

console.log(`ORIGIN: ${ORIGIN}\n`);

// 0. SPA shell + health
const home = await fetch(`${ORIGIN}/`);
check("GET / (SPA shell)", home.status === 200 && (await home.text()).includes("<div id=\"root\">"));
const health = (await api("GET", bridge("healthz"))).json;
check("healthz: database connected", health?.database === "connected", JSON.stringify(health));

// 1. Sender login (landing page form → POST /api/users, bridged)
const sender = (await api("POST", bridge("users"), {
  name: `Ada Live ${TAG}`, phoneNumber: `80${TAG}`, countryCode: "+234", countryIso: "NG",
})).json;
check("① Sender login → user id", !!sender?.id, `id=${sender?.id} phone=${sender?.fullPhone}`);

// 2. Sender sends invite
const invite = (await api("POST", bridge("invites"), {
  fromUserId: sender.id, toName: "Chidi (invitee)", toPhone: `+23470${TAG}`,
  message: "Track me live", consentType: "location", baseUrl: ORIGIN,
})).json;
check("② Invite created", !!invite?.token, `token=${invite?.token} status=${invite?.status}`);

// 3. Invitee opens the consent page + lookups
const shell = await fetch(`${ORIGIN}/consent/${invite.token}`);
check("③a Consent page loads", shell.status === 200);
const flat = await api("GET", `/api/invite?token=${invite.token}`);
check("③b Consent lookup (direct)", flat.status === 200, `fromUser=${flat.json?.fromUserName}`);

// 4. Invitee grants location (the consent page's first call)
const granted = (await api("POST", "/api/grant", {
  token: invite.token, latitude: 9.0765, longitude: 7.3986, address: "Asokoro, Abuja",
})).json;
check("④ Grant → accepted + sessionToken",
  granted?.status === "accepted" && !!granted?.sessionToken,
  `status=${granted?.status} sessionToken=${granted?.sessionToken ? "issued" : "MISSING"}`);

// 5. Invitee streams GPS
let fixesOk = 0;
for (let i = 1; i <= 3; i++) {
  const r = await api("POST", "/api/location/push", {
    token: invite.token, latitude: 9.0765 + i * 0.002, longitude: 7.3986 + i * 0.0015,
    accuracy: 8, status: "active", batteryLevel: 82 - i, batteryCharging: false,
    source: "gps", address: `Move ${i}`,
  });
  fixesOk += r.status === 200;
}
check("⑤ 3 live GPS fixes accepted", fixesOk === 3, `${fixesOk}/3`);

// 6. Sender's notification bell
const bell = (await api("GET", bridge(`notifications/${sender.id}`))).json;
const count = (await api("GET", bridge(`notifications/${sender.id}/unread-count`))).json;
const grantNotif = (bell || []).find((n) => /granted/i.test(n.title || ""));
check("⑥ Sender got the 'location granted' notification", !!grantNotif,
  grantNotif ? `"${grantNotif.title}"` : `bell=${bell?.length ?? "null"} rows, unread=${count?.count}`);
check("⑥b Bell has coordinate updates too", (bell || []).some((n) => n.data?.latitude != null),
  `total=${bell?.length ?? 0} unread=${count?.count}`);

// 7. Live Map + Active Sessions
const sessions = (await api("GET", bridge(`sessions?userId=${sender.id}`))).json;
const s0 = (sessions || [])[0] || {};
check("⑦a Active Session has pin + maps link",
  s0.latitude != null && s0.status === "active" && !!s0.googleMapsLiveLink,
  `${s0.toName}: ${s0.latitude},${s0.longitude} ${s0.googleMapsLiveLink ? "·maps ✓" : "·NO maps link"}`);
const latest = (await api("GET", bridge(`location/latest/${invite.token}`))).json;
check("⑦b Live Map latest pin", latest?.latitude != null, `${latest?.latitude},${latest?.longitude}`);
const hist = (await api("GET", bridge(`location/history/${invite.token}`))).json;
check("⑦c Journey stored", Array.isArray(hist) && hist.length >= 3, `${Array.isArray(hist) ? hist.length : 0} fixes`);

console.log(`\n═══ PASSED: ${pass}   FAILED: ${fail} ═══`);
console.log(`    Sender view: ${ORIGIN}/live-map`);
process.exit(fail ? 1 : 0);
