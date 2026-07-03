import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { assistantMessagesTable } from "@workspace/db";

const router = Router();

const SendMessageBody = z.object({
  userId: z.number(),
  message: z.string().min(1),
  conversationId: z.string().optional(),
});

router.post("/assistant", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, message, conversationId } = parsed.data;

  try {
    // Persist user message
    await db.insert(assistantMessagesTable).values({
      id: crypto.randomUUID(),
      userId,
      role: "user",
      content: message,
    });

    // Call OpenAI Chat Completions
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      res.status(500).json({ error: "AI provider not configured" });
      return;
    }

    const systemPrompt = `You are PhoneLink assistant. Help users with app tasks and act as an in-app assistant. Be concise.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 800,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("OpenAI error", resp.status, txt);
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    const json = await resp.json();
    const assistantText = json?.choices?.[0]?.message?.content ?? "";

    // Persist assistant response
    await db.insert(assistantMessagesTable).values({
      id: crypto.randomUUID(),
      userId,
      role: "assistant",
      content: assistantText,
    });

    res.json({ reply: assistantText, conversationId: conversationId ?? null });
  } catch (err) {
    console.error("/assistant error", err);
    res.status(500).json({ error: "Assistant failed" });
  }
});

export default router;
