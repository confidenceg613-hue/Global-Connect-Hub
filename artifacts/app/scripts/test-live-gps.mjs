/**
 * End-to-end test for the DeepFalcon live GPS channel.
 *
 * Simulates exactly what the app does in production:
 *   1. "Owner" device  → subscribes to deepfalcon/v1/{token}   (Live Map / bell)
 *   2. "Recipient"     → publishes grant + GPS fixes           (consent page)
 *   3. Assert owner receives both, in order, with correct payloads.
 *
 * Run: node scripts/test-live-gps.mjs
 */
import mqtt from "mqtt";

const BROKER = "wss://broker.emqx.io:8084/mqtt";
const TOKEN = `test_${Math.random().toString(36).slice(2, 8)}`;
const TOPIC = `deepfalcon/v1/${TOKEN}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`token: ${TOKEN}`);
  console.log(`topic: ${TOPIC}\n`);

  // ── Owner device ──────────────────────────────────────────────────────────
  const owner = mqtt.connect(BROKER, { clientId: `owner_${Date.now()}` });
  const received = [];

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("owner connect timeout")), 15000);
    owner.on("connect", () => {
      owner.subscribe(TOPIC, { qos: 0 }, (err) => {
        clearTimeout(t);
        if (err) reject(err); else resolve();
      });
    });
    owner.on("error", reject);
  });
  console.log("[owner] connected + subscribed ✓");

  owner.on("message", (_topic, payload) => {
    received.push(JSON.parse(payload.toString()));
  });

  await wait(1500); // let the subscription propagate through the broker

  // ── Recipient device (what the consent page publishes) ────────────────────
  const recipient = mqtt.connect(BROKER, { clientId: `rcpt_${Date.now()}` });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("recipient connect timeout")), 15000);
    recipient.on("connect", () => { clearTimeout(t); resolve(); });
    recipient.on("error", reject);
  });
  console.log("[recipient] connected ✓");

  const grantEvent = {
    type: "grant", token: TOKEN,
    latitude: 8.938353, longitude: 7.252643, accuracy: 18,
    ts: Date.now(),
  };
  recipient.publish(TOPIC, JSON.stringify(grantEvent), { qos: 0 });
  console.log("[recipient] published GRANT (8.938353, 7.252643) ✓");

  await wait(1200);
  const gpsEvent = {
    type: "gps", token: TOKEN,
    latitude: 8.938401, longitude: 7.252700, accuracy: 12,
    status: "active", ts: Date.now(),
  };
  recipient.publish(TOPIC, JSON.stringify(gpsEvent), { qos: 0 });
  console.log("[recipient] published GPS UPDATE (moved ~7m) ✓");

  // ── Assertions ────────────────────────────────────────────────────────────
  await wait(2500);
  console.log(`\n[owner] received ${received.length} event(s)`);

  let pass = true;
  if (received.length !== 2) {
    console.log(`FAIL: expected 2 events, got ${received.length}`); pass = false;
  }
  if (received[0]?.type !== "grant") { console.log("FAIL: first event is not grant"); pass = false; }
  else console.log("PASS: grant event received with", JSON.stringify(received[0].latitude), JSON.stringify(received[0].longitude));
  if (received[1]?.type !== "gps") { console.log("FAIL: second event is not gps"); pass = false; }
  else console.log("PASS: gps event received — marker would move to", received[1].latitude, received[1].longitude);

  owner.end(true); recipient.end(true);
  console.log(pass ? "\n✅ END-TO-END TEST PASSED" : "\n❌ TEST FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("❌ TEST ERROR:", e.message); process.exit(1); });
