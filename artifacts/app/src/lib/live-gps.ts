/**
 * Live GPS channel — direct device↔owner realtime link over public MQTT
 * (WebSocket). Zero backend required.
 *
 * Trust model: every consent link already carries a random token in its URL.
 * The token IS the capability: whoever holds it may publish that contact's
 * GPS and subscribe to it. Topic:  deepfalcon/v1/{token}
 *
 * Events published by the recipient's consent page (via the fetch
 * interceptor in live-gps-auto.ts):
 *   { type: "grant", latitude, longitude, accuracy?, contact?, ts }
 *   { type: "gps",   latitude, longitude, accuracy?, status, ts }
 *
 * The owner's app (Live Map / bell) subscribes to every token it has ever
 * created (persisted in localStorage) and instantly sees markers + gets
 * notifications — coordinates appear the second the contact accepts.
 */

import mqtt, { type MqttClient } from "mqtt";

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_PREFIX = "deepfalcon/v1/";
const OWNER_TOKENS_KEY = "df_owner_tokens_v1";

/** Window event fired alongside every incoming live GPS event (bell badge). */
export const LIVE_GPS_BELL_EVENT = "df:live-gps-notif";

export interface LiveGpsEvent {
  type: "grant" | "gps";
  token: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  status?: "active" | "offline";
  contact?: string;
  ts: number;
}

// ── Owner-side token registry (which links have been created on this device) ──

export function getOwnerTokens(): string[] {
  try {
    const raw = localStorage.getItem(OWNER_TOKENS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function rememberOwnerToken(token: string): void {
  if (!token) return;
  try {
    const tokens = getOwnerTokens();
    if (!tokens.includes(token)) {
      tokens.push(token);
      // Cap the registry so localStorage stays small
      localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify(tokens.slice(-200)));
    }
  } catch { /* storage full — non-critical */ }

  // Critical: subscribe the already-open live client to this token's topic
  // RIGHT NOW. Without this, an invite created after page load is never
  // subscribed to until a full reload — so the grant the invitee publishes
  // minutes later reaches nobody and the sender gets no notification.
  const topic = `${TOPIC_PREFIX}${token}`;
  if (!state.topics.has(topic)) {
    state.topics.add(topic);
    const client = state.client;
    if (client?.connected) {
      try { client.subscribe(topic, { qos: 0 }); } catch { /* the connect handler resubscribes all topics */ }
    }
    // If not connected yet, the "connect" handler resubscribes state.topics.
  }
}

// ── Shared singleton client ──────────────────────────────────────────────────

type MessageHandler = (ev: LiveGpsEvent) => void;

interface ClientState {
  client: MqttClient | null;
  connecting: Promise<MqttClient> | null;
  topics: Set<string>;
  handlers: Set<MessageHandler>;
}

const state: ClientState = { client: null, connecting: null, topics: new Set(), handlers: new Set() };

function wireClient(client: MqttClient): void {
  client.on("message", (topic, payload) => {
    if (!topic.startsWith(TOPIC_PREFIX)) return;
    try {
      const parsed = JSON.parse(payload.toString()) as LiveGpsEvent;
      if (parsed && typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
        for (const h of state.handlers) {
          try { h(parsed); } catch { /* one bad handler never kills the rest */ }
        }
      }
    } catch { /* malformed payload — ignore */ }
  });

  client.on("connect", () => {
    // (Re)subscribe to everything the app currently cares about
    for (const t of state.topics) {
      client.subscribe(t, { qos: 0 });
    }
  });
}

async function getClient(): Promise<MqttClient> {
  if (state.client?.connected) return state.client;
  if (state.connecting) return state.connecting;

  state.connecting = new Promise<MqttClient>((resolve, reject) => {
    try {
      const client = mqtt.connect(BROKER_URL, {
        clientId: `df_${Math.random().toString(16).slice(2, 10)}`,
        keepalive: 30,
        reconnectPeriod: 4000,
        connectTimeout: 10000,
        clean: true,
      });
      wireClient(client);
      client.on("connect", () => { state.client = client; resolve(client); });
      client.on("error", () => { /* handled by reconnect logic */ });
      setTimeout(() => {
        if (!client.connected) reject(new Error("mqtt connect timeout"));
      }, 12000);
    } catch (e) {
      reject(e);
    }
  }).finally(() => { state.connecting = null; }) as Promise<MqttClient>;

  return state.connecting;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Publish an event on the token's channel (recipient side / test tooling). */
export async function publishLiveGps(ev: Omit<LiveGpsEvent, "ts">): Promise<void> {
  try {
    const client = await getClient();
    const payload = JSON.stringify({ ...ev, ts: Date.now() });
    client.publish(`${TOPIC_PREFIX}${ev.token}`, payload, { qos: 0 });
  } catch { /* offline — the channel is best-effort by design */ }
}

/** Listen for live GPS events on a set of tokens. Returns an unsubscribe fn. */
export function subscribeLiveGps(
  tokens: string[],
  handler: MessageHandler,
): () => void {
  state.handlers.add(handler);
  const wanted = new Set(tokens.map((t) => `${TOPIC_PREFIX}${t}`));
  for (const t of wanted) state.topics.add(t);

  let cancelled = false;
  getClient()
    .then((client) => {
      if (cancelled) return;
      for (const t of wanted) client.subscribe(t, { qos: 0 });
    })
    .catch(() => { /* broker unreachable — silent */ });

  return () => {
    cancelled = true;
    state.handlers.delete(handler);
    // Best-effort unsubscribe of topics this subscriber owned exclusively
    const remainingHandlers = state.handlers.size;
    for (const t of wanted) {
      if (remainingHandlers === 0) {
        state.topics.delete(t);
        state.client?.unsubscribe(t);
      }
    }
  };
}

/** Connection state probe (used for a small "LIVE" indicator, optional). */
export function isLiveGpsConnected(): boolean {
  return !!state.client?.connected;
}
