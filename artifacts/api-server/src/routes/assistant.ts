import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { assistantMessagesTable, usersTable } from "@workspace/db";

const router = Router();

const KIMI_BASE_URL = "https://api.moonshot.cn/v1";
const KIMI_MODEL = "kimi-k2-0711-preview";

const SYSTEM_PROMPT = `You are the PhoneLink assistant — a helpful, concise in-app guide built into PhoneLink, a real-time location-sharing and personal safety platform.

PhoneLink features you know about:
- Location sharing with consent: users invite trusted contacts and explicitly grant/revoke location access
- Live Map: real-time location of contacts who have granted access
- GeoBoard: a camera-based geo-photo capture when consent is granted
- Geofences: virtual perimeters with entry/exit push notifications
- SOS alerts: emergency broadcast to all trusted contacts via push and WhatsApp
- Invites: users send invite links; the recipient grants or declines location sharing
- Permissions / Consents: granular control over who can see what
- Location History & Reports: historical movement data and analytics
- Push notifications: browser-based push for all safety events
- Activity feed: log of all location and consent events

When helping users, be direct and specific to PhoneLink. Keep answers short. If you don't know something, say so. Do not make up features.`;

const SendMessageBody = z.object({
  userId: z.number().int().positive(),
  message: z.string().min(1).max(4000),
});

/** Verify a userId actually exists in the DB — minimal protection without a session layer. */
async function validateUser(userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return rows.length > 0;
}

// POST /assistant — streaming SSE
router.post("/assistant", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, message } = parsed.data;

  if (!(await validateUser(userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const kimiKey = process.env.KIMI_API_KEY;
  if (!kimiKey) {
    res.status(500).json({ error: "AI provider not configured" });
    return;
  }

  // Switch to SSE before any async work so the client doesn't time out
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let disconnected = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  req.on("close", () => {
    disconnected = true;
    reader?.cancel().catch(() => {});
  });

  const sendEvent = (payload: object) => {
    if (!disconnected) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    // Persist user message
    await db.insert(assistantMessagesTable).values({
      id: crypto.randomUUID(),
      userId,
      role: "user",
      content: message,
    });

    // Fetch last 20 messages for multi-turn context
    const history = await db
      .select()
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.userId, userId))
      .orderBy(desc(assistantMessagesTable.createdAt))
      .limit(20);

    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    const upstream = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kimiKey}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: chatMessages,
        stream: true,
        max_tokens: 1024,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      console.error("Kimi error", upstream.status, txt);
      sendEvent({ error: "AI provider error" });
      res.end();
      return;
    }

    let fullText = "";
    const decoder = new TextDecoder();
    let sseBuffer = "";
    reader = upstream.body.getReader();

    while (!disconnected) {
      const { done, value } = await reader.read();
      if (done) break;

      // Accumulate across network chunks so multi-chunk SSE frames parse correctly
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? ""; // keep incomplete last line for next iteration

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          disconnected = true; // signal outer loop to stop
          break;
        }
        try {
          const chunk = JSON.parse(data);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            sendEvent({ content });
          }
        } catch {
          // skip malformed chunk
        }
      }
    }

    // Persist assistant turn only if we got something and the client didn't abort
    if (fullText && !req.destroyed) {
      await db.insert(assistantMessagesTable).values({
        id: crypto.randomUUID(),
        userId,
        role: "assistant",
        content: fullText,
      });
    }

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    console.error("/assistant error", err);
    sendEvent({ error: "Assistant failed" });
    res.end();
  }
});

// GET /assistant/history
router.get("/assistant/history", async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId || isNaN(userId)) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  if (!(await validateUser(userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const messages = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.userId, userId))
    .orderBy(desc(assistantMessagesTable.createdAt))
    .limit(50);

  res.json({ messages: messages.reverse() });
});

export default router;
