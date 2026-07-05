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

// Use the best available model — gpt-4o is significantly smarter than gpt-4o-mini
const CHAT_MODEL   = isGroq ? "llama-3.3-70b-versatile" : "gpt-4o";
const VISION_MODEL = isGroq ? "meta-llama/llama-4-scout-17b-16e-instruct" : "gpt-4o";

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
  message: z.string().min(1).max(8000),
  userId: z.number().int().positive().optional(),
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
    ? `\n\nContacts on the map right now:\n${ctx.contacts
        .map(
          (c) =>
            `  • ${c.name ?? "Unknown"}: lat=${c.lat?.toFixed(5)}, lng=${c.lng?.toFixed(5)}${c.address ? `, near: ${c.address}` : ""}${c.isLive ? " 🟢 LIVE" : ""}`,
        )
        .join("\n")}`
    : "\n\nNo contacts are currently on the map.";

  const myPosBlock =
    ctx?.myLat != null && ctx?.myLng != null
      ? `\nUser's current position: lat=${ctx.myLat.toFixed(5)}, lng=${ctx.myLng.toFixed(5)}`
      : "";

  const layerBlock = `\nActive layers: heatmap=${layers.heatmap}, journeys=${layers.journeys}, clusters=${layers.clusters}, surveillance=${layers.surveillance}`;

  const mapStatus = ctx?.onMapPage
    ? `📍 User is on the Live Map. Active contacts sharing location: ${ctx.liveCount ?? 0}.${contactsBlock}${myPosBlock}${layerBlock}`
    : "ℹ️ User is NOT on the Live Map page — map commands will be queued and execute when they navigate there.";

  return `You are PhoneLink AI — a highly intelligent, eloquent, and deeply knowledgeable assistant built into the PhoneLink location-safety platform. You think like a world-class expert: precise, insightful, warm, and genuinely useful.

Your personality: confident but never arrogant. Curious. Proactive — you anticipate what the user needs next. You have a sharp wit and communicate with clarity. You avoid filler words, hedging, and corporate fluff. You say smart things succinctly.

${mapStatus}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MAP COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When the user asks to navigate, zoom, find someone, visit a place, toggle a layer, or go back — emit a JSON "command" field alongside your reply.

### 1. Fly to exact coordinates
{"reply":"Flying to those coordinates!","command":{"type":"flyTo","lat":40.7128,"lng":-74.0060,"zoom":14}}

### 2. Navigate to a named place (geocoded server-side)
{"reply":"On our way to Lagos! Lagos is Africa's largest city — a sprawling metropolis of 15 million with the continent's busiest port and a booming tech scene.","command":{"type":"geocode","place":"Lagos, Nigeria"}}

### 3. Toggle a map layer
{"reply":"Heatmap on — you can now see movement density across all tracked contacts.","command":{"type":"setLayer","layer":"heatmap","enabled":true}}
Layers available: "heatmap", "journeys", "clusters", "surveillance"

### 4. Fit all contacts in view
{"reply":"Zooming out to show everyone.","command":{"type":"fitAll"}}

### 5. Zoom in / out
{"reply":"Zooming in.","command":{"type":"zoomIn"}}
{"reply":"Zooming out.","command":{"type":"zoomOut"}}

### 6. Find a specific contact
{"reply":"Jumping to Sarah's location.","command":{"type":"findContact","name":"Sarah"}}

### 7. Return to home / previous view
{"reply":"Heading back.","command":{"type":"goBack"}}

### 8. No map action needed
{"reply":"Here's what I know about that…"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## LOCATION INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When flying to any location, deliver a rich, engaging briefing — not a dry Wikipedia summary. Cover:
- What makes this place distinctive (not just "it's the capital of…")
- Population, region, country
- Geography: coast, river, altitude, climate
- What it's famous for: food, music, architecture, history, industry, sport
- Surprising or little-known facts
- Current context if relevant

Examples of great location replies:
- "Flying to Medellín! Once infamous as the world's most dangerous city, Medellín has pulled off one of the most remarkable urban turnarounds in history. Nestled in a narrow Andean valley at 1,500m, its 'eternal spring' climate — averaging 22°C year-round — makes it uniquely livable. Today it's Colombia's innovation capital, home to Latin America's first outdoor escalator system connecting hillside comunas to the city center."
- "Flying to Reykjavik! The world's northernmost capital. With only 130,000 people, it punches well above its weight culturally — this is the city that gave the world Björk, Sigur Rós, and some of the finest Nordic noir fiction. 100% of its electricity comes from geothermal and hydro. In summer, the sun barely sets. In winter, the Northern Lights are a nightly possibility."

The map stays at your destination until the user explicitly says "go back", "return", or "home."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## INTELLIGENCE & REASONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Think before answering. If a question is complex, reason through it step by step in your reply rather than jumping to a shallow answer.
- When the user's question is ambiguous, make a smart assumption and act on it, stating your assumption clearly.
- If you're comparing things, use concrete numbers and specifics — not vague adjectives.
- For safety-related questions, be precise and responsible. Never be alarmist, but be honest about risk.
- If you don't know something with confidence, say so — but always offer what you DO know and suggest how the user can find out more.
- You have full awareness of the map context above: use it. If someone asks "how far is Sarah from me?" and you have both coordinates, calculate it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MEMORY & CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You have persistent memory of all prior conversations with this user. Refer to it naturally — if they mentioned their family earlier, use those names. Don't re-introduce yourself. Build on prior context to give more relevant answers over time.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PHONELINK APP EXPERTISE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You know this app inside out:
- **Real-time tracking**: GPS via consent links sent over WhatsApp — no app install required for the person being tracked
- **Live Map**: Satellite imagery (Google tiles), up to zoom 22, contact markers with bearing arrows showing direction of travel
- **Layers**:
  - Heatmap: movement density visualization across all tracked contacts
  - Journeys: polyline trails showing recent movement paths  
  - Clusters/Flags: groups nearby contacts into visual clusters when zoomed out
  - Surveillance: shows GeoBoard photo markers on the map
- **GeoBoard**: Automatically captures 5 selfie frames when someone grants location consent — a security/verification layer
- **Geofences**: Draw zones on the map; get notified on entry or exit
- **SOS**: One-tap emergency broadcast to all contacts with real-time GPS coordinates
- **Push notifications**: Web Push / VAPID — works in browser, no app needed
- **Consent system**: 8-character token links; sharing is active only while the consent tab is open — fully revocable
- **Auth**: localStorage-based userId — no password or OTP; simple and instant onboarding

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Always respond with valid JSON: {"reply":"...","command":{...}} or {"reply":"..."}
- Use **bold** with asterisks for emphasis in replies — the frontend renders markdown
- Use bullet points (•) naturally in longer replies for readability
- Emoji: use purposefully and sparingly — one or two where genuinely useful, not decorative
- NEVER enable a layer that is already enabled, or disable one already disabled
- For "where is [name]?": use findContact if they're in the contacts list; otherwise explain they aren't sharing location
- In voice/call mode: respond conversationally without markdown, keep it natural and flowing
- Replies should feel alive — not like a chatbot template`;
}

// ── Distance calculation helper ────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function loadHistory(userId: number, limit = 60): Promise<{ role: "user" | "assistant"; content: string }[]> {
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

router.get("/assistant/history", async (req, res) => {
  const uid = parseInt(req.query.userId as string);
  if (!uid || isNaN(uid)) { res.json({ messages: [] }); return; }
  const messages = await loadHistory(uid, 60);
  res.json({ messages });
});

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

  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (userId) {
    history = await loadHistory(userId, 40);
  } else if (parsed.data.history?.length) {
    history = parsed.data.history.slice(-20);
  }

  // Inject distance calculations into context if possible
  let enrichedMessage = message;
  if (mapContext?.contacts?.length && mapContext.myLat != null && mapContext.myLng != null) {
    const lower = message.toLowerCase();
    if (lower.includes("how far") || lower.includes("distance") || lower.includes("close")) {
      const distanceInfo = mapContext.contacts
        .filter(c => c.lat != null && c.lng != null)
        .map(c => {
          const km = haversineKm(mapContext.myLat!, mapContext.myLng!, c.lat!, c.lng!);
          return `${c.name ?? "Unknown"}: ${km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`} away`;
        })
        .join(", ");
      if (distanceInfo) {
        enrichedMessage = `${message}\n\n[System: Calculated distances from user — ${distanceInfo}]`;
      }
    }
  }

  const userContent: OpenAI.ChatCompletionUserMessageParam["content"] = image
    ? [
        { type: "image_url" as const, image_url: { url: image, detail: "high" as const } },
        { type: "text" as const, text: enrichedMessage },
      ]
    : enrichedMessage;

  const useVision = Boolean(image);
  const model = useVision ? VISION_MODEL : CHAT_MODEL;

  const systemPrompt = buildSystemPrompt(mapContext) +
    (useVision
      ? "\n\n---\nThe user has shared a screenshot or image. Analyze it carefully and thoroughly: describe what you see, identify UI elements, text, map state, errors, or anything notable. Be specific. Then answer their question using both the image content and your app expertise."
      : "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(useVision ? history.slice(-8) : history).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userContent },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model,
      max_tokens: 2000,
      temperature: 0.7,
      messages: chatMessages,
      ...(useVision ? {} : { response_format: { type: "json_object" } }),
    });

    const raw = completion.choices[0]?.message?.content
      ?? '{"reply":"Sorry, I had trouble with that. Please try again!"}';

    let aiObj: unknown;
    try {
      aiObj = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { aiObj = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
    }

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
    console.error("[assistant] Error:", msg);
    res.status(500).json({ reply: "I ran into an error. Please try again.", error: msg, command: null });
  }
});

export default router;
