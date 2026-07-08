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
      // Retry only on rate-limit (429) or server errors (5xx)
      if (status && status !== 429 && status < 500) throw err;
      console.warn(`[assistant] ${label} failed (${status ?? "network"}), trying next…`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ── Command schema ────────────────────────────────────────────────────────────
const MapLayerEnum = z.enum(["heatmap", "journeys", "clusters", "surveillance"]);
const MapCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flyTo"), lat: z.number(), lng: z.number(), zoom: z.number().optional() }),
  z.object({ type: z.literal("geocode"), place: z.string().min(1) }),
  z.object({ type: z.literal("setLayer"), layer: MapLayerEnum, enabled: z.boolean() }),
  z.object({ type: z.literal("fitAll") }),
  z.object({ type: z.literal("zoomIn") }),
  z.object({ type: z.literal("zoomOut") }),
  z.object({ type: z.literal("findContact"), name: z.string().min(1) }),
  z.object({ type: z.literal("goBack") }),
  z.object({ type: z.literal("showImages"), place: z.string().min(1) }),
  z.object({ type: z.literal("navigate"), path: z.string().min(1) }),
  z.object({ type: z.literal("openInviteForm"), phone: z.string().optional(), name: z.string().optional() }),
]);

const AiResponseSchema = z.object({
  reply: z.string(),
  command: MapCommandSchema.nullable().optional(),
});

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
5. zoom: {"type":"zoomIn"} or {"type":"zoomOut"}
6. findContact: {"reply":"Finding Sarah.","command":{"type":"findContact","name":"Sarah"}}
7. goBack: {"reply":"Back.","command":{"type":"goBack"}}
8. showImages: {"reply":"Here are photos!","command":{"type":"showImages","place":"Abuja, Nigeria"}} — use when user says "show image/photo/picture" or "what does X look like"
9. navigate: {"reply":"Opening invites page.","command":{"type":"navigate","path":"/invites"}} — paths: /dashboard /invites /live-map /activity /permissions /geoboard /settings /profile /location-history /location-reports /surveillance
10. openInviteForm: {"reply":"Pre-filling invite form for John.","command":{"type":"openInviteForm","phone":"+2348012345678","name":"John"}} — use when user says "send invite to [name] [phone]" or "invite [name]"
11. No command: {"reply":"..."}

When navigating to a place, give a 2-3 sentence vivid briefing about it.

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
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

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
          fullReply = validated.data.reply;
          command = validated.data.command ?? null;
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
      send({ type: "error", message: msg });
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

    const { reply, command } = validated.data;
    if (userId) await saveMessages(userId, message, reply);
    res.json({ reply, command: command ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ reply: "I ran into an error. Please try again.", error: msg, command: null });
  }
});

export default router;
