/**
 * Verifies the MQTT live channel end-to-end: a "sender" subscribes to the
 * invite topic, an "invitee" publishes grant + GPS, the sender must receive
 * both. Run from artifacts/app so mqtt resolves:
 *   cd artifacts/app && node scripts/verify-live-channel.mjs
 */
import mqtt from "mqtt";

const TOKEN = process.argv[2] || "x86zluN6";
const url = process.env.VITE_MQTT_URL || "wss://broker.emqx.io:8084/mqtt";

const sender = mqtt.connect(url, {
  clientId: "verify-sender-" + Date.now(),
  clean: true,
  connectTimeout: 8000,
});
const got = [];

sender.on("connect", () => {
  sender.subscribe(`deepfalcon/v1/${TOKEN}`, () => {
    const invitee = mqtt.connect(url, {
      clientId: "verify-invitee-" + Date.now(),
      clean: true,
      connectTimeout: 8000,
    });
    invitee.on("connect", () => {
      invitee.publish(
        `deepfalcon/v1/${TOKEN}`,
        JSON.stringify({ type: "grant", token: TOKEN, latitude: 9.0765, longitude: 7.3986 }),
        { qos: 0 },
      );
      setTimeout(
        () =>
          invitee.publish(
            `deepfalcon/v1/${TOKEN}`,
            JSON.stringify({ type: "gps", token: TOKEN, latitude: 9.0813, longitude: 7.4041, status: "active" }),
            { qos: 0 },
          ),
        500,
      );
    });
  });
});

sender.on("message", (_t, payload) => got.push(JSON.parse(payload.toString())));
setTimeout(() => {
  console.log("events received by sender:", got.length);
  for (const g of got) console.log(" •", g.type, g.latitude, g.longitude);
  process.exit(got.length >= 2 ? 0 : 1);
}, 9000);
