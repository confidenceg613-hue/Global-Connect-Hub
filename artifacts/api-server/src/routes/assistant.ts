import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { assistantMessagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// ── Client setup — supports both OpenAI (sk-…) and Groq (gsk_…) keys ─────────
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("[assistant] OPENAI_API_KEY is not set — /api/assistant will return 503");
}

const isGroq = API_KEY?.startsWith("gsk_");
const openai = API_KEY
  ? new OpenAI({
      apiKey: API_KEY,
      ...(isGroq ? { baseURL: "https://api.groq.com/openai/v1" } : {}),
    })
  : null;

const CHAT_MODEL        = isGroq ? "llama-3.3-70b-versatile"     : "gpt-4o-mini";
const VISION_MODEL      = isGroq ? "meta-llama/llama-4-scout-17b-16e-instruct" : "gpt-4o-mini";

// ── Command schema (Zod) ──────────────────────────────────────────────────────
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

const LayerStates = z.object({
  heatmap: z.boolean(),
  journeys: z.boolean(),
  clusters: z.boolean(),
  surveillance: z.boolean(),
}).optional();

const MapContext = z.object({
  onMapPage: z.boolean().optional(),
  contacts: z.array(ContactCtx).optional(),
  liveCount: z.number().optional(),
  myLat: z.number().optional(),
  myLng: z.number().optional(),
  layers: LayerStates,
});

const SendMessageBody = z.object({
  message: z.string().min(1).max(4000),
  userId: z.number().int().positive().optional(),
  // base64 data-URI; validated format + capped at ~2MB encoded (~1.5MB raw image)
  image: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, "Invalid image data-URI format")
    .max(2_800_000, "Image too large — max ~2 MB")
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional(),
  mapContext: MapContext.optional(),
});

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx?: z.infer<typeof MapContext>): string {
  const layers = ctx?.layers ?? { heatmap: false, journeys: false, clusters: false, surveillance: false };

  const contactsBlock = ctx?.contacts?.length
    ? `\n\nContacts currently on the map:\n${ctx.contacts
        .map(
          (c) =>
            `- ${c.name ?? "Unknown"}: lat=${c.lat?.toFixed(5)}, lng=${c.lng?.toFixed(5)}${c.address ? `, address: ${c.address}` : ""}${c.isLive ? " [LIVE]" : ""}`,
        )
        .join("\n")}`
    : "\n\nNo contacts are currently on the map.";

  const myPosBlock =
    ctx?.myLat != null && ctx?.myLng != null
      ? `\nUser's own position: lat=${ctx.myLat.toFixed(5)}, lng=${ctx.myLng.toFixed(5)}`
      : "";

  const layerBlock = `\nCurrent layer states: heatmap=${layers.heatmap}, journeys=${layers.journeys}, clusters=${layers.clusters}, surveillance=${layers.surveillance}`;

  const mapStatus = ctx?.onMapPage
    ? `The user is on the Live Map. Active contacts: ${ctx.liveCount ?? 0}.${contactsBlock}${myPosBlock}${layerBlock}`
    : "The user is NOT currently on the Live Map page — map commands will still be queued and executed when they open the map.";

  return `You are the PhoneLink AI assistant — a smart, friendly, knowledgeable companion for a real-time location-tracking and safety app. You can answer questions about the app, navigate the live map, AND share rich information about any place in the world.

${mapStatus}

## Map Navigation Commands
When the user asks you to navigate, zoom, find someone, go to a place, change a layer, or go back — include a "command" in your JSON response.

Available commands:

1. Fly to exact coordinates:
{"reply":"Flying there!","command":{"type":"flyTo","lat":40.7128,"lng":-74.0060,"zoom":14}}

2. Search for a place by name (geocoded on the frontend via Nominatim):
{"reply":"Flying to Lagos, Nigeria! Lagos is the largest city in Africa and a major economic hub with over 15 million people.","command":{"type":"geocode","place":"Lagos, Nigeria"}}

3. Enable or disable a layer:
{"reply":"Turning on the heatmap.","command":{"type":"setLayer","layer":"heatmap","enabled":true}}
Layers: "heatmap", "journeys", "clusters", "surveillance"

4. Fit all contacts in view:
{"reply":"Fitting all contacts.","command":{"type":"fitAll"}}

5. Zoom:
{"reply":"Zooming in!","command":{"type":"zoomIn"}}

6. Find a contact by name:
{"reply":"Flying to Sarah!","command":{"type":"findContact","name":"Sarah"}}

7. Go back to the previous/home view (contacts or user position):
{"reply":"Going back to home view.","command":{"type":"goBack"}}

8. No map command (general question):
{"reply":"Here's what you need to know…"}

## Location Knowledge Rules
- When flying to ANY location, ALWAYS include rich facts in your reply: country, population, what it's famous for, key landmarks, culture, geography, and any interesting facts. Be informative and engaging.
- Example: "Flying to Tokyo! Tokyo is Japan's capital and the world's most populous metropolitan area with ~37 million people. It's known for its blend of ultramodern and traditional architecture, world-class cuisine, and the iconic Mount Fuji visible on clear days."
- For lesser-known places, still share what you know: region, country, nearest major city, any notable characteristics.
- The map stays at the location you fly to. The user must say "go back", "return", or "home" for you to send the goBack command.

## Memory
You have persistent memory. You remember all previous conversations with this user. Refer to prior context when relevant.

## Other Rules
- Always respond with valid JSON: {"reply":"...","command":{...}} or {"reply":"..."}
- NEVER set a layer that is already in the requested state
- For "where is X?" use findContact if X is in the contacts list, else explain they're not sharing
- Keep replies concise but informative. Use emoji naturally but sparingly.
- In voice/call mode the user will speak to you naturally — respond conversationally.

## PhoneLink App Knowledge
- Real-time GPS tracking via consent links sent over WhatsApp — no app install for recipients
- Live Map: satellite imagery (Google tiles), up to zoom 22, contact markers with bearing arrows
- Layers: Heatmap (movement density), Journeys (trail polylines), Clusters/Flags (grouped contacts), Surveillance (GeoBoard photo markers)
- GeoBoard: auto-captures 5 selfie photos + 5-second video when someone grants consent
- Geofences: notify on entry/exit of defined zones
- SOS: broadcasts emergency to all contacts with your GPS coordinates
- Push notifications via Web Push / VAPID
- Auth is localStorage-only (userId stored in browser, no password/OTP)
- Consent links are 8-char tokens; sharing lasts while the consent tab is open`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function loadHistory(userId: number, limit = 40): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const rows = await db
      .select({ role: assistantMessagesTable.role, content: assistantMessagesTable.content })
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.userId, userId))
      .orderBy(desc(assistantMessagesTable.createdAt))
      .limit(limit);
    return rows.reverse() as { role: "user" | "assistant"; content: string }[];
  } catch {
    return [];
  }
}

async function saveMessages(
  userId: number,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  try {
    await db.insert(assistantMessagesTable).values([
      { id: randomUUID(), userId, role: "user",      content: userMsg },
      { id: randomUUID(), userId, role: "assistant", content: assistantMsg },
    ]);
  } catch (e) {
    console.error("[assistant] Failed to save messages:", e);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/assistant/history?userId=N — return saved conversation
router.get("/assistant/history", async (req, res) => {
  const uid = parseInt(req.query.userId as string);
  if (!uid || isNaN(uid)) { res.json({ messages: [] }); return; }
  const messages = await loadHistory(uid, 60);
  res.json({ messages });
});

// POST /api/assistant — main chat endpoint
router.post("/assistant", async (req, res) => {
  if (!openai) {
    res.status(503).json({ reply: "AI assistant is unavailable — OPENAI_API_KEY is not configured.", command: null });
    return;
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, userId, image, mapContext } = parsed.data;

  // Load persistent history from DB when userId is provided; fall back to in-request history
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (userId) {
    history = await loadHistory(userId, 30);
  } else if (parsed.data.history?.length) {
    history = parsed.data.history.slice(-20);
  }

  // Build user content — plain text or vision (text + image) content block
  const userContent: OpenAI.ChatCompletionUserMessageParam["content"] = image
    ? [
        {
          type: "image_url" as const,
          image_url: { url: image, detail: "high" as const },
        },
        { type: "text" as const, text: message },
      ]
    : message;

  const useVision = Boolean(image);
  const model = useVision ? VISION_MODEL : CHAT_MODEL;

  const systemPrompt = buildSystemPrompt(mapContext) +
    (useVision
      ? "\n\nThe user has shared a screenshot of their screen. Carefully analyze the image and describe what you see in detail before answering. Identify UI elements, content, errors, or anything notable. Be specific and helpful."
      : "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Vision models work best without long history — trim to last 6 turns when image present
    ...(useVision ? history.slice(-6) : history).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model,
      max_tokens: 900,
      messages: chatMessages,
      // json_object mode may not be supported by all vision models — omit when using vision
      ...(useVision ? {} : { response_format: { type: "json_object" } }),
    });

    const raw = completion.choices[0]?.message?.content
      ?? '{"reply":"Sorry, I had trouble with that. Try again!"}';

    // Vision responses may be plain prose — extract JSON if present, else wrap in reply
    let aiObj: unknown;
    try {
      // Try direct parse first
      aiObj = JSON.parse(raw);
    } catch {
      // Try extracting a JSON object embedded in prose (vision model often adds text around JSON)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { aiObj = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
    }

    // If no parseable JSON, treat the whole response as a plain reply (vision plain-text mode)
    if (!aiObj) {
      const reply = typeof raw === "string" && raw.trim() ? raw.trim() : "Got it!";
      if (userId) await saveMessages(userId, message, reply);
      res.json({ reply, command: null });
      return;
    }

    const validated = AiResponseSchema.safeParse(aiObj);
    if (!validated.success) {
      const fallback =
        typeof (aiObj as Record<string, unknown>)?.reply === "string"
          ? (aiObj as { reply: string }).reply
          : "Got it!";
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
