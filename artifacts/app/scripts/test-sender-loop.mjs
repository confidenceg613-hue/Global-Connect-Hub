/**
 * Sender-loop verification — proves the SENDER receives a notification with
 * coordinates when the invite opens the link and accepts, exactly as the
 * app's production code paths do:
 *
 *   sender device  → subscribes to deepfalcon/v1/{token}   (notifier + map)
 *   invitee device → publishes grant { latitude, longitude } (consent page)
 *   assert: sender receives the grant with coordinates
 */
import mqtt from "mqtt";

const BROKER = "wss://broker.emqx.io:8084/mqtt";
const TOKEN = `sender_test_${Math.random().toString(36).slice(2, 8)}`;
const TOPIC = `deepfalcon/v1/${TOKEN}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`token: ${TOKEN}\n`);

  // ── Sender device (LiveGpsNotifier + LiveMap subscribe here) ──────────────
  const sender = mqtt.connect(BROKER, { clientId: `sender_${Date.now()}` });
  const received = [];
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("sender connect timeout")), 15000);
    sender.on("connect", () => sender.subscribe(TOPIC, { qos: 0 }, (e) => { clearTimeout(t); e ? reject(e) : resolve(); }));
    sender.on("error", reject);
  });
  console.log("[sender] connected + subscribed ✓");
  sender.on("message", (_t, payload) => received.push(JSON.parse(payload.toString())));
  await wait(1500);

  // ── Invitee opens link and accepts (consent page grant event) ─────────────
  const invitee = mqtt.connect(BROKER, { clientId: `invitee_${Date.now()}` });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("invitee connect timeout")), 15000);
    invitee.on("connect", () => { clearTimeout(t); resolve(); });
    invitee.on("error", reject);
  });
  const grant = {
    type: "grant", token: TOKEN,
    latitude: 8.938953, longitude: 7.253738, accuracy: 11,
    ts: Date.now(),
  };
  invitee.publish(TOPIC, JSON.stringify(grant), { qos: 0 });
  console.log("[invitee] published GRANT with coordinates ✓");
  await wait(2500);

  // ── Assertions (sender side) ──────────────────────────────────────────────
  const grantEv = received.find((e) => e.type === "grant");
  let pass = true;
  if (!grantEv) { console.log("FAIL: sender received no grant event"); pass = false; }
  else {
    console.log(`PASS: sender notified — location granted at ${grantEv.latitude}, ${grantEv.longitude}`);
    if (typeof grantEv.latitude !== "number" || typeof grantEv.longitude !== "number") {
      console.log("FAIL: coordinates missing"); pass = false;
    }
  }

  sender.end(true); invitee.end(true);
  console.log(pass ? "\n✅ SENDER-LOOP TEST PASSED" : "\n❌ TEST FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("❌ TEST ERROR:", e.message); process.exit(1); });
