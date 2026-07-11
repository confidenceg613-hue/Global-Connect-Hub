import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { assistantMessagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// ── Client setup ─────────────────────────────────────────────────────────────
const SHARED_HEADERS = { "HTTP-Referer": "https://phonelink.app", "X-Title": "PhoneLink AI" };
const GROQ_BASE    = "https://api.groq.com/openai/v1";
const MISTRAL_BASE = "https://api.mistral.ai/v1";

const mistralKey = process.env.MISTRAL_API_KEY?.trim();
const groqKey1   = process.env.GROQ_API_KEY_1?.trim();
const groqKey2   = process.env.GROQ_API_KEY_2?.trim();
// Legacy single-key fallback kept for backward-compat
const legacyKey  = process.env.OPENAI_API_KEY?.trim();

if (!mistralKey && !groqKey1 && !groqKey2 && !legacyKey) {
  console.error("[assistant] No API keys set — /api/assistant will return 503");
} else {
  if (mistralKey) console.log("[assistant] Mistral key ready (primary)");
  if (groqKey1)   console.log("[assistant] Groq key 1 ready");
  if (groqKey2)   console.log("[assistant] Groq key 2 ready");
  if (!mistralKey && !groqKey1 && !groqKey2 && legacyKey) console.log("[assistant] Using legacy OPENAI_API_KEY");
}

function makeClient(apiKey: string, base?: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: base ?? GROQ_BASE, defaultHeaders: SHARED_HEADERS });
}

// Ordered list of clients: Mistral first, then Groq fallbacks
const clients: { label: string; client: OpenAI }[] = [];
if (mistralKey) clients.push({ label: "Mistral", client: makeClient(mistralKey, MISTRAL_BASE) });
if (groqKey1)   clients.push({ label: "Groq-1",  client: makeClient(groqKey1) });
if (groqKey2)   clients.push({ label: "Groq-2",  client: makeClient(groqKey2) });
if (!mistralKey && !groqKey1 && !groqKey2 && legacyKey) {
  const isGsk = legacyKey.startsWith("gsk_");
  const isOr  = legacyKey.startsWith("sk-or-");
  const base  = isGsk ? GROQ_BASE : isOr ? "https://openrouter.ai/api/v1" : undefined;
  const client = base
    ? new OpenAI({ apiKey: legacyKey, baseURL: base, defaultHeaders: SHARED_HEADERS })
    : new OpenAI({ apiKey: legacyKey, defaultHeaders: SHARED_HEADERS });
  clients.push({ label: "legacy", client });
}

const hasAnyClient = clients.length > 0;

// Model chain per client type: Mistral uses its own model names, Groq uses llama/gemma
function modelsFor(label: string): string[] {
  if (label === "Mistral") {
    return [process.env.OPENAI_MODEL ?? "mistral-large-latest"];
  }
  return (process.env.OPENAI_MODEL
    ? [process.env.OPENAI_MODEL]
    : ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"]);
}

const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "mistral-large-latest";

// Flat attempt matrix: Mistral first, then Groq model chain
interface Attempt { label: string; client: OpenAI; model: string; }
const attempts: Attempt[] = [];
for (const { label, client } of clients) {
  for (const model of modelsFor(label)) {
    attempts.push({ label: `${label}/${model}`, client, model });
  }
}

/** Run fn with primary client+model; on rate-limit/server error, try next combo. */
async function withFallback<T>(fn: (client: OpenAI, model: string, label: string) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const { label, client, model } of attempts) {
    try {
      return await fn(client, model, label);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      // Always try next — auth errors (401) on one provider shouldn't block others
      console.warn(`[assistant] ${label} failed (${status ?? "network"}), trying next…`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ── Command schema ────────────────────────────────────────────────────────────
const MapLayerEnum = z.enum(["heatmap", "journeys", "clusters", "surveillance"]);
const PanDirectionEnum = z.enum(["north", "south", "east", "west"]);
const MapCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flyTo"), lat: z.number(), lng: z.number(), zoom: z.number().optional() }),
  z.object({ type: z.literal("geocode"), place: z.string().min(1) }),
  z.object({ type: z.literal("setLayer"), layer: MapLayerEnum, enabled: z.boolean() }),
  z.object({ type: z.literal("fitAll") }),
  z.object({ type: z.literal("zoomIn") }),
  z.object({ type: z.literal("zoomOut") }),
  z.object({ type: z.literal("setZoom"), zoom: z.number().min(0).max(22) }),
  z.object({ type: z.literal("pan"), direction: PanDirectionEnum, amount: z.number().min(0.1).max(1).optional() }),
  z.object({ type: z.literal("findContact"), name: z.string().min(1) }),
  z.object({ type: z.literal("goBack") }),
  z.object({ type: z.literal("showImages"), place: z.string().min(1) }),
  z.object({ type: z.literal("showStreetView"), lat: z.number(), lng: z.number(), name: z.string().optional() }),
  z.object({ type: z.literal("navigate"), path: z.string().min(1) }),
  z.object({ type: z.literal("openInviteForm"), phone: z.string().optional(), name: z.string().optional() }),
]);

const AiResponseSchema = z.object({
  reply: z.string(),
  command: MapCommandSchema.nullable().optional(),
});

type MapCommandT = z.infer<typeof MapCommandSchema>;

interface DebateInfo {
  agentA: { label: string; reply: string };
  agentB: { label: string; reply: string };
  note: string;
}

// ── Request schema ────────────────────────────────────────────────────────────
const ContactCtx = z.object({
  name: z.string().nullable().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().nullable().optional(),
  isLive: z.boolean().optional(),
});

const SendMessageBody = z.object({
  message: z.string().min(1).max(8000),
  userId: z.number().int().positive().optional(),
  // "debate": two independently-configured AI providers each answer the
  // question on their own, then a third pass reconciles/cross-checks them
  // into one final answer. Requires 2+ distinct providers to be meaningful.
  mode: z.enum(["single", "debate"]).optional(),
  image: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
    .max(2_800_000)
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional(),
  mapContext: z.object({
    onMapPage: z.boolean().optional(),
    contacts: z.array(ContactCtx).optional(),
    liveCount: z.number().optional(),
    myLat: z.number().optional(),
    myLng: z.number().optional(),
    layers: z.object({
      heatmap: z.boolean(),
      journeys: z.boolean(),
      clusters: z.boolean(),
      surveillance: z.boolean(),
    }).optional(),
  }).optional(),
});

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx?: z.infer<typeof SendMessageBody>["mapContext"]): string {
  const layers = ctx?.layers ?? { heatmap: false, journeys: false, clusters: false, surveillance: false };
  const contactsBlock = ctx?.contacts?.length
    ? `\n\nContacts on the map:\n${ctx.contacts.map(c =>
        `  • ${c.name ?? "Unknown"}: lat=${c.lat?.toFixed(5)}, lng=${c.lng?.toFixed(5)}${c.address ? `, near: ${c.address}` : ""}${c.isLive ? " 🟢 LIVE" : ""}`
      ).join("\n")}`
    : "\n\nNo contacts on the map.";
  const myPos = ctx?.myLat != null && ctx?.myLng != null
    ? `\nUser position: lat=${ctx.myLat.toFixed(5)}, lng=${ctx.myLng.toFixed(5)}` : "";
  const layerBlock = `\nLayers: heatmap=${layers.heatmap}, journeys=${layers.journeys}, clusters=${layers.clusters}, surveillance=${layers.surveillance}`;
  const mapStatus = ctx?.onMapPage
    ? `📍 User is on the Live Map. Active contacts: ${ctx.liveCount ?? 0}.${contactsBlock}${myPos}${layerBlock}`
    : "User is NOT on the Live Map — map commands will queue.";

  return `You are PhoneLink AI — smart, concise, genuinely useful. Built into a real-time location-safety platform.

${mapStatus}

## MAP COMMANDS (emit "command" field when relevant)
1. flyTo: {"reply":"Flying there!","command":{"type":"flyTo","lat":6.5244,"lng":3.3792,"zoom":13}}
2. geocode: {"reply":"Going to Lagos!","command":{"type":"geocode","place":"Lagos, Nigeria"}}
3. layer: {"reply":"Heatmap on.","command":{"type":"setLayer","layer":"heatmap","enabled":true}} — layers: heatmap|journeys|clusters|surveillance
4. fitAll: {"reply":"Showing all.","command":{"type":"fitAll"}}
5. zoom: {"type":"zoomIn"} or {"type":"zoomOut"} — one step; use for "zoom in/out"
6. setZoom: {"reply":"Zoomed to max detail.","command":{"type":"setZoom","zoom":20}} — use for an explicit zoom level, e.g. "zoom to level 18" or "zoom all the way in" (use 22, the highest supported)
7. pan: {"reply":"Heading north.","command":{"type":"pan","direction":"north"}} — directions: north|south|east|west, for "navigate/go/pan/move north/south/east/west". This only pans, never changes zoom.
8. findContact: {"reply":"Finding Sarah.","command":{"type":"findContact","name":"Sarah"}}
9. goBack: {"reply":"Back.","command":{"type":"goBack"}} — undo the last AI-driven map move
10. showImages: {"reply":"Here are photos!","command":{"type":"showImages","place":"Abuja, Nigeria"}} — use when user says "show image/photo/picture" or "what does X look like" for a place with no exact coordinates
11. showStreetView: {"reply":"Here's street level view.","command":{"type":"showStreetView","lat":6.5244,"lng":3.3792,"name":"Lagos"}} — use for "show street view at my location / at X / here" when you have coordinates (use the user's position or a contact's position from context)
12. navigate: {"reply":"Opening invites page.","command":{"type":"navigate","path":"/invites"}} — paths: /dashboard /invites /live-map /activity /permissions /geoboard /settings /profile /location-history /location-reports /surveillance
13. openInviteForm: {"reply":"Pre-filling invite form for John.","command":{"type":"openInviteForm","phone":"+2348012345678","name":"John"}} — use when user says "send invite to [name] [phone]" or "invite [name]"
14. No command: {"reply":"..."}

When navigating to a place, give a 2-3 sentence vivid briefing about it.

## MAP NAVIGATION RULES (critical)
- NEVER emit flyTo/fitAll/setZoom/zoomIn/zoomOut unless the user explicitly asked to move, zoom, or go somewhere. Answering an informational question ("what buildings are here", "how far is X") must NOT change the view — reply with no command.
- "Zoom in/out" → zoomIn/zoomOut (one step). "Zoom all the way in/out" or "max zoom" → setZoom with 22 or 3. Never guess an arbitrary zoom for a simple "zoom in".
- "Navigate/go/move/pan [direction]" with no destination named → pan command, not flyTo. flyTo is only for named places, contacts, or explicit coordinates.
- If nearby buildings/points of interest are listed below in the map status, answer directly from that list — don't say you can't see the map.

## CRIME & SAFETY QUESTIONS
- If real crime/safety data is provided below in brackets, answer directly from it — cite whether it's official police records or a heuristic, never invent numbers.
- If it says no official feed covers the area, say so plainly, then share whatever heuristic context is given. Never claim a specific crime rate or statistic that wasn't provided to you.
- These questions are informational only — never move the map for them.

## PHONELINK FEATURES
GPS tracking via WhatsApp links (no app needed) • Live Map (satellite, zoom 22) • Geofences • SOS broadcast • GeoBoard (auto-captures 5 selfie frames on consent) • Consent tokens (8-char, revocable)

## OUTPUT RULES
- Always valid JSON: {"reply":"...","command":{...}} or {"reply":"..."}
- **bold** for emphasis, • for bullets, max 2 emoji
- Keep replies concise — prefer 1-3 sentences unless depth is needed`;
}

// ── Extract partial reply from streaming JSON ─────────────────────────────────
function extractPartialReply(accumulated: string): string {
  const replyIdx = accumulated.indexOf('"reply"');
  if (replyIdx === -1) return "";
  const colonIdx = accumulated.indexOf(":", replyIdx + 7);
  if (colonIdx === -1) return "";
  const quoteIdx = accumulated.indexOf('"', colonIdx + 1);
  if (quoteIdx === -1) return "";

  let result = "";
  let i = quoteIdx + 1;
  while (i < accumulated.length) {
    const c = accumulated[i];
    if (c === "\\" && i + 1 < accumulated.length) {
      const n = accumulated[i + 1];
      if (n === "n") result += "\n";
      else if (n === '"') result += '"';
      else if (n === "\\") result += "\\";
      else if (n === "t") result += "\t";
      else result += n;
      i += 2;
    } else if (c === '"') {
      break;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

// ── Nearby buildings/POI lookup (free, no key — OpenStreetMap Overpass API) ────
// Used to answer "what buildings/places are here" without ever moving the map.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

async function fetchNearbyPOIs(lat: number, lng: number, radiusM = 250): Promise<string[]> {
  const query = `[out:json][timeout:8];(
    node["building"](around:${radiusM},${lat},${lng});
    way["building"](around:${radiusM},${lat},${lng});
    node["amenity"](around:${radiusM},${lat},${lng});
    node["shop"](around:${radiusM},${lat},${lng});
  );out center 25;`;

  try {
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
    const names = new Set<string>();
    for (const el of json.elements ?? []) {
      const tags = el.tags ?? {};
      const name = tags.name;
      const kind = tags.amenity ?? tags.shop ?? (tags.building && tags.building !== "yes" ? tags.building : "building");
      if (name) names.add(`${name} (${kind})`);
      else if (tags.amenity || tags.shop) names.add(kind);
      if (names.size >= 15) break;
    }
    return Array.from(names);
  } catch (err) {
    console.warn("[assistant] Overpass POI lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

const POI_KEYWORDS = ["building", "poi", "point of interest", "what's here", "whats here", "around here", "nearby", "what is here", "what's around", "what places"];

// ── Crime & safety lookup ───────────────────────────────────────────────────────
// Real records via UK Police's free, keyless open-data API (data.police.uk) where
// coverage exists. Outside that coverage there is no free/keyless global crime
// feed, so we're honest about the gap and fall back to a heuristic built from real
// OSM POI data (police/government/military presence nearby) — never fabricated stats.
const SAFETY_KEYWORDS = [
  "crime", "crime rate", "safe", "safety", "is it safe", "dangerous", "danger",
  "risky", "risk level", "police report", "burglary", "theft", "mugging", "violence",
  "how safe",
];

interface CrimeRecord { category: string; }

/** Rough UK bounding box — data.police.uk returns HTTP 200 with an empty array for
 * out-of-coverage coordinates instead of an error, so we must gate by location
 * ourselves or we'd misreport "0 incidents" for places never actually checked. */
function isRoughlyInUk(lat: number, lng: number): boolean {
  return lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.8;
}

async function fetchUkCrimeData(lat: number, lng: number): Promise<{ total: number; topCategories: string[] } | null> {
  if (!isRoughlyInUk(lat, lng)) return null;
  try {
    const resp = await fetch(
      `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!resp.ok) return null; // e.g. 503 outside UK coverage or bad request
    const records = (await resp.json()) as CrimeRecord[];
    if (!Array.isArray(records)) return null;
    const counts = new Map<string, number>();
    for (const r of records) {
      const label = r.category.replace(/-/g, " ");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const topCategories = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, n]) => `${label} (${n})`);
    return { total: records.length, topCategories };
  } catch (err) {
    console.warn("[assistant] UK crime data lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Heuristic safety context from real OSM tags when no official crime feed covers the area. */
async function fetchHeuristicSafetyContext(lat: number, lng: number, radiusM = 400): Promise<string[]> {
  const query = `[out:json][timeout:8];(
    node["amenity"="police"](around:${radiusM},${lat},${lng});
    node["amenity"="hospital"](around:${radiusM},${lat},${lng});
    node["office"="government"](around:${radiusM},${lat},${lng});
    node["military"](around:${radiusM},${lat},${lng});
    way["landuse"="military"](around:${radiusM},${lat},${lng});
    node["amenity"="prison"](around:${radiusM},${lat},${lng});
  );out center 15;`;
  try {
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
    const notes: string[] = [];
    for (const el of json.elements ?? []) {
      const tags = el.tags ?? {};
      if (tags.amenity === "police") notes.push(`police station${tags.name ? ` (${tags.name})` : ""} nearby`);
      else if (tags.amenity === "hospital") notes.push(`hospital${tags.name ? ` (${tags.name})` : ""} nearby`);
      else if (tags.amenity === "prison") notes.push("prison/detention facility nearby");
      else if (tags.office === "government") notes.push(`government building${tags.name ? ` (${tags.name})` : ""} nearby`);
      else if (tags.military || tags.landuse === "military") notes.push("military site nearby");
      if (notes.length >= 8) break;
    }
    return notes;
  } catch (err) {
    console.warn("[assistant] Heuristic safety lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildSafetyContext(lat: number, lng: number): Promise<string> {
  const ukData = await fetchUkCrimeData(lat, lng);
  if (ukData) {
    return ukData.total > 0
      ? `\n\n[Official UK Police crime records within ~1 mile, last reporting month: ${ukData.total} incidents. Top categories: ${ukData.topCategories.join(", ")}. Source: data.police.uk]`
      : `\n\n[Official UK Police crime records within ~1 mile, last reporting month: 0 incidents reported. Source: data.police.uk]`;
  }
  // No official feed covers this area — be explicit about that, then offer the heuristic signal.
  const notes = await fetchHeuristicSafetyContext(lat, lng);
  return notes.length
    ? `\n\n[No official crime-record API covers this location, so exact statistics aren't available. Heuristic context from OpenStreetMap: ${notes.join(", ")}.]`
    : `\n\n[No official crime-record API covers this location, and no notable safety-related landmarks (police/hospital/government/military) were found within ~400m in OpenStreetMap data.]`;
}

// ── Distance helper ───────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function loadHistory(userId: number, limit = 60) {
  try {
    const rows = await db
      .select({ role: assistantMessagesTable.role, content: assistantMessagesTable.content })
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.userId, userId))
      .orderBy(desc(assistantMessagesTable.createdAt))
      .limit(limit);
    return rows.reverse() as { role: "user" | "assistant"; content: string }[];
  } catch { return []; }
}

async function saveMessages(userId: number, userMsg: string, assistantMsg: string) {
  try {
    await db.insert(assistantMessagesTable).values([
      { id: randomUUID(), userId, role: "user",      content: userMsg },
      { id: randomUUID(), userId, role: "assistant", content: assistantMsg },
    ]);
  } catch (e) { console.error("[assistant] Failed to save:", e); }
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/assistant/history", async (req, res) => {
  const uid = parseInt(req.query.userId as string);
  if (!uid || isNaN(uid)) { res.json({ messages: [] }); return; }
  res.json({ messages: await loadHistory(uid, 60) });
});

router.post("/assistant", async (req, res) => {
  if (!hasAnyClient) {
    res.status(503).json({ reply: "AI assistant is unavailable — no API keys configured.", command: null });
    return;
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    console.warn("[assistant] invalid request body:", parsed.error.message);
    res.status(400).json({ reply: "That message couldn't be sent — please try rephrasing it.", command: null });
    return;
  }

  const { message, userId, image, mapContext } = parsed.data;
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (userId) {
    history = await loadHistory(userId, 40);
  } else if (parsed.data.history?.length) {
    history = parsed.data.history.slice(-20);
  }

  // Enrich message with distance info if relevant
  let enrichedMessage = message;
  if (mapContext?.contacts?.length && mapContext.myLat != null && mapContext.myLng != null) {
    const lower = message.toLowerCase();
    if (lower.includes("how far") || lower.includes("distance") || lower.includes("close")) {
      const distInfo = mapContext.contacts
        .filter(c => c.lat != null && c.lng != null)
        .map(c => {
          const km = haversineKm(mapContext.myLat!, mapContext.myLng!, c.lat!, c.lng!);
          return `${c.name ?? "Unknown"}: ${km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`} away`;
        }).join(", ");
      if (distInfo) enrichedMessage += `\n\n[Calculated distances: ${distInfo}]`;
    }
  }

  // Enrich with real nearby buildings/POIs (OSM Overpass) for "what's here"-style
  // questions — this must never move the map, just inform the reply. isPoiQuery
  // also drives a hard server-side guardrail below: informational intent never
  // ships a map-moving command, regardless of what the model returns.
  const isPoiQuery = POI_KEYWORDS.some((kw) => message.toLowerCase().includes(kw));
  if (isPoiQuery) {
    const anchorLat = mapContext?.myLat ?? mapContext?.contacts?.[0]?.lat;
    const anchorLng = mapContext?.myLng ?? mapContext?.contacts?.[0]?.lng;
    if (anchorLat != null && anchorLng != null) {
      const pois = await fetchNearbyPOIs(anchorLat, anchorLng);
      enrichedMessage += pois.length
        ? `\n\n[Nearby buildings/POIs within ~250m: ${pois.join(", ")}]`
        : `\n\n[No named buildings/POIs found within ~250m in OpenStreetMap data.]`;
    }
  }

  // Enrich with real crime/safety data for "is this safe" / "crime rate" style
  // questions. Uses official UK Police records where available; elsewhere, is
  // upfront that no official feed covers the area and offers a heuristic signal
  // instead of fabricating statistics. Never moves the map (informational only).
  const isSafetyQuery = SAFETY_KEYWORDS.some((kw) => message.toLowerCase().includes(kw));
  if (isSafetyQuery) {
    const anchorLat = mapContext?.myLat ?? mapContext?.contacts?.[0]?.lat;
    const anchorLng = mapContext?.myLng ?? mapContext?.contacts?.[0]?.lng;
    if (anchorLat != null && anchorLng != null) {
      enrichedMessage += await buildSafetyContext(anchorLat, anchorLng);
    } else {
      enrichedMessage += "\n\n[No location available to check safety/crime data for — ask the user which place, or open the Live Map first.]";
    }
  }

  const MOVE_COMMAND_TYPES = new Set(["flyTo", "geocode", "fitAll", "zoomIn", "zoomOut", "setZoom", "pan", "findContact", "goBack", "showStreetView"]);
  const isInformationalQuery = isPoiQuery || isSafetyQuery;
  /** Hard guardrail: informational (POI/safety) queries never ship a map-moving command, even if the model tries. */
  function stripMoveCommandIfInformational<T extends { command?: { type: string } | null }>(obj: T): T {
    if (isInformationalQuery && obj.command && MOVE_COMMAND_TYPES.has(obj.command.type)) {
      return { ...obj, command: null };
    }
    return obj;
  }

  const useVision = Boolean(image);

  const userContent: OpenAI.ChatCompletionUserMessageParam["content"] = image
    ? [
        { type: "image_url" as const, image_url: { url: image, detail: "high" as const } },
        { type: "text" as const, text: enrichedMessage },
      ]
    : enrichedMessage;

  const systemPrompt = buildSystemPrompt(mapContext) +
    (useVision ? "\n\n---\nUser shared a screenshot. Analyze it carefully: describe what you see, identify UI elements, map state, errors, or anything notable. Then answer their question." : "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(useVision ? history.slice(-8) : history).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  /** Best-effort parse of a model's raw JSON-object output into {reply, command}. */
  function parseAiJson(raw: string): { reply: string; command: MapCommandT | null } {
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { obj = JSON.parse(m[0]); } catch { /* */ }
    }
    if (!obj) return { reply: raw.trim() || "Got it!", command: null };
    const validated = AiResponseSchema.safeParse(obj);
    if (!validated.success) {
      const fallback = typeof (obj as Record<string, unknown>)?.reply === "string"
        ? (obj as { reply: string }).reply : "Got it!";
      return { reply: fallback, command: null };
    }
    const guarded = stripMoveCommandIfInformational(validated.data);
    return { reply: guarded.reply, command: guarded.command ?? null };
  }

  /** Run one client through its own model fallback chain (no cross-client fallback) — used so each debate agent stays a genuinely distinct provider. */
  async function runAgentOnClient(client: OpenAI, label: string, models: string[]): Promise<{ label: string; reply: string; command: MapCommandT | null }> {
    let lastErr: unknown;
    for (const model of models) {
      try {
        const completion = await client.chat.completions.create({
          model,
          max_tokens: 2000,
          temperature: 0.7,
          messages: chatMessages,
          response_format: { type: "json_object" },
        });
        const raw = completion.choices[0]?.message?.content ?? '{"reply":"Sorry, something went wrong."}';
        return { label: `${label}/${model}`, ...parseAiJson(raw) };
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${label} failed all models`);
  }

  // ── Debate / cross-check mode ────────────────────────────────────────────────
  // Two independently-configured providers each answer on their own, then a
  // third pass reconciles them into a single, more trustworthy final answer.
  if (parsed.data.mode === "debate" && !useVision) {
    if (clients.length < 2) {
      const only = clients[0];
      const singleReply = only
        ? await runAgentOnClient(only.client, only.label, modelsFor(only.label))
            .then(r => r.reply)
            .catch(() => "I ran into a hiccup — please try again.")
        : "No AI provider is configured.";
      res.status(200).json({
        reply: "Cross-check mode needs a second AI provider configured — right now only one is set up, so here's a single-agent answer instead.\n\n" + singleReply,
        command: null,
        debate: null,
      });
      return;
    }

    try {
      const [agentAResult, agentBResult] = await Promise.allSettled([
        runAgentOnClient(clients[0].client, clients[0].label, modelsFor(clients[0].label)),
        runAgentOnClient(clients[1].client, clients[1].label, modelsFor(clients[1].label)),
      ]);

      const agentA = agentAResult.status === "fulfilled"
        ? agentAResult.value
        : { label: clients[0].label, reply: "(no response — this provider errored out)", command: null as MapCommandT | null };
      const agentB = agentBResult.status === "fulfilled"
        ? agentBResult.value
        : { label: clients[1].label, reply: "(no response — this provider errored out)", command: null as MapCommandT | null };

      const reconcileMessages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `You are the reconciler in a two-AI cross-check pipeline for PhoneLink AI. Two independent AI agents were each asked the same user question with the same context and answered without seeing each other's response. Your job: compare them, decide which parts are correct/well-supported, resolve any disagreement, and produce ONE final answer that is at least as good as the better of the two — merging complementary details, dropping anything wrong or unsupported.\n\nOriginal system context given to both agents:\n${systemPrompt}\n\nRespond with strict JSON: {"reply": "...", "command": {...}|null, "note": "one short sentence on whether the two agents agreed or what you reconciled"}. Follow the exact same MAP COMMANDS and OUTPUT RULES from the context above for "reply"/"command". Never invent a command neither agent proposed unless it's obviously the correct merge of what both intended.`,
        },
        { role: "user", content: `User's question: ${enrichedMessage}\n\nAgent A (${agentA.label}) answered:\n${agentA.reply}${agentA.command ? `\n[Agent A command: ${JSON.stringify(agentA.command)}]` : ""}\n\nAgent B (${agentB.label}) answered:\n${agentB.reply}${agentB.command ? `\n[Agent B command: ${JSON.stringify(agentB.command)}]` : ""}` },
      ];

      const reconcileCompletion = await withFallback((client, mdl) => client.chat.completions.create({
        model: mdl,
        max_tokens: 2000,
        temperature: 0.4,
        messages: reconcileMessages,
        response_format: { type: "json_object" },
      }));

      const raw = reconcileCompletion.choices[0]?.message?.content ?? "{}";
      let finalReply = "Got it!";
      let finalCommand: MapCommandT | null = null;
      let note = "";
      try {
        const obj = JSON.parse(raw) as { reply?: string; command?: unknown; note?: string };
        const guarded = stripMoveCommandIfInformational({
          reply: obj.reply ?? "Got it!",
          command: (MapCommandSchema.nullable().optional().safeParse(obj.command).success
            ? (obj.command as MapCommandT | null | undefined) : null) ?? null,
        });
        finalReply = guarded.reply;
        finalCommand = guarded.command ?? null;
        note = obj.note ?? "";
      } catch {
        const fallback = parseAiJson(raw);
        finalReply = fallback.reply;
        finalCommand = fallback.command;
      }

      if (userId) await saveMessages(userId, message, finalReply);
      res.json({
        reply: finalReply,
        command: finalCommand,
        debate: { agentA: { label: agentA.label, reply: agentA.reply }, agentB: { label: agentB.label, reply: agentB.reply }, note } as DebateInfo,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[assistant] debate mode failed:", msg);
      res.status(500).json({ reply: "Cross-check ran into a hiccup on my end — please try that again in a moment.", command: null, debate: null });
    }
    return;
  }

  // ── Streaming response ──────────────────────────────────────────────────────
  if (wantsStream && !useVision) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let accumulated = "";
    let sentReplyLength = 0;

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // withFallback protects stream *creation* — if key 1 returns a 429/5xx before
      // the stream opens, the next key+model combo is tried automatically.
      // Once a stream is open, mid-stream errors fall to the outer catch (SSE error event).
      const stream = await withFallback((client, mdl) => client.chat.completions.create({
        model: mdl,
        max_tokens: 2000,
        temperature: 0.7,
        messages: chatMessages,
        response_format: { type: "json_object" },
        stream: true,
      }));

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (!text) continue;
        accumulated += text;

        // Extract and stream the reply portion as it builds up
        const currentReply = extractPartialReply(accumulated);
        if (currentReply.length > sentReplyLength) {
          send({ type: "token", text: currentReply.slice(sentReplyLength) });
          sentReplyLength = currentReply.length;
        }
      }

      // Parse final JSON for command + full reply
      let fullReply = "";
      let command = null;
      try {
        const obj = JSON.parse(accumulated);
        const validated = AiResponseSchema.safeParse(obj);
        if (validated.success) {
          const guarded = stripMoveCommandIfInformational(validated.data);
          fullReply = guarded.reply;
          command = guarded.command ?? null;
        } else {
          fullReply = extractPartialReply(accumulated) || "Got it!";
        }
      } catch {
        fullReply = extractPartialReply(accumulated) || accumulated.trim() || "Got it!";
      }

      if (userId) await saveMessages(userId, message, fullReply);
      send({ type: "done", command, fullReply });
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[assistant] stream failed:", msg);
      send({ type: "error", message: "I ran into a hiccup on my end — please try that again in a moment." });
      res.end();
    }
    return;
  }

  // ── Non-streaming fallback (vision / backward-compat) ──────────────────────
  try {
    const completion = await withFallback((client, mdl) => client.chat.completions.create({
      model: useVision ? VISION_MODEL : mdl,
      max_tokens: 2000,
      temperature: 0.7,
      messages: chatMessages,
      ...(useVision ? {} : { response_format: { type: "json_object" } }),
    }));

    const raw = completion.choices[0]?.message?.content ?? '{"reply":"Sorry, something went wrong."}';
    let aiObj: unknown;
    try { aiObj = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { aiObj = JSON.parse(m[0]); } catch { /* */ }
    }

    if (!aiObj) {
      const reply = raw.trim() || "Got it!";
      if (userId) await saveMessages(userId, message, reply);
      res.json({ reply, command: null });
      return;
    }

    const validated = AiResponseSchema.safeParse(aiObj);
    if (!validated.success) {
      const fallback = typeof (aiObj as Record<string, unknown>)?.reply === "string"
        ? (aiObj as { reply: string }).reply : "Got it!";
      if (userId) await saveMessages(userId, message, fallback);
      res.json({ reply: fallback, command: null });
      return;
    }

    const guarded = stripMoveCommandIfInformational(validated.data);
    const { reply, command } = guarded;
    if (userId) await saveMessages(userId, message, reply);
    res.json({ reply, command: command ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[assistant] request failed:", msg);
    res.status(500).json({ reply: "I ran into a hiccup on my end — please try that again in a moment.", command: null });
  }
});

export default router;
