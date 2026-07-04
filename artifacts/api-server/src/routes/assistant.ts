import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";

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

// Use a model appropriate for the provider; Groq model supports JSON mode
const CHAT_MODEL = isGroq ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

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

  return `You are the PhoneLink AI assistant — a smart, friendly helper for a real-time location-tracking and safety app. You can answer questions about the app AND control the live map directly.

${mapStatus}

## Map Navigation Commands
When the user asks you to navigate, zoom, find someone, go to a place, or change a layer, include a "command" in your JSON response.

Available commands:

1. Fly to coordinates:
{"reply":"Flying there!","command":{"type":"flyTo","lat":40.7128,"lng":-74.0060,"zoom":14}}

2. Search for a place by name (frontend geocodes via Nominatim):
{"reply":"Flying to London!","command":{"type":"geocode","place":"London, UK"}}

3. Enable or disable a layer (use current layer states above to avoid redundant toggles):
{"reply":"Turning on the heatmap.","command":{"type":"setLayer","layer":"heatmap","enabled":true}}
{"reply":"Hiding journeys.","command":{"type":"setLayer","layer":"journeys","enabled":false}}
Layers: "heatmap", "journeys", "clusters", "surveillance"

4. Fit all contacts in view:
{"reply":"Fitting all contacts.","command":{"type":"fitAll"}}

5. Zoom:
{"reply":"Zooming in!","command":{"type":"zoomIn"}}
{"reply":"Zooming out.","command":{"type":"zoomOut"}}

6. Find a contact by name:
{"reply":"Flying to Sarah!","command":{"type":"findContact","name":"Sarah"}}

7. No map command (general question):
{"reply":"Here's what you need to know…"}

## Rules
- Always respond with valid JSON: {"reply":"...","command":{...}} or {"reply":"..."}
- NEVER set a layer that is already in the requested state (e.g. don't enable heatmap if it's already on)
- For "where is X?" use findContact if X is in the contacts list, else explain they're not sharing
- Keep replies concise. Use emoji naturally but sparingly.

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

// ── Routes ────────────────────────────────────────────────────────────────────

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

  const { message, history = [], mapContext } = parsed.data;

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(mapContext) },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: 512,
      messages: chatMessages,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content
      ?? '{"reply":"Sorry, I had trouble with that. Try again!"}';

    let aiObj: unknown;
    try {
      aiObj = JSON.parse(raw);
    } catch {
      res.json({ reply: raw, command: null });
      return;
    }

    // Validate AI output — drop malformed commands gracefully
    const validated = AiResponseSchema.safeParse(aiObj);
    if (!validated.success) {
      const fallback = typeof (aiObj as Record<string, unknown>)?.reply === "string"
        ? (aiObj as { reply: string }).reply
        : "Got it!";
      res.json({ reply: fallback, command: null });
      return;
    }

    res.json({ reply: validated.data.reply, command: validated.data.command ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ reply: "I ran into an error. Please try again.", error: msg, command: null });
  }
});

router.get("/assistant/history", (_req, res) => {
  res.json({ messages: [] });
});

export default router;
