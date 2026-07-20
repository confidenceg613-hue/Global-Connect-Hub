import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { eq, and, desc } from "drizzle-orm";
import { db, locationUpdatesTable, invitesTable } from "@workspace/db";

const router: IRouter = Router();

// ── Mistral client (reuses the same key already loaded by assistant.ts) ───────
const mistralKey = process.env.MISTRAL_API_KEY?.trim();
const mistral = mistralKey
  ? new OpenAI({ apiKey: mistralKey, baseURL: "https://api.mistral.ai/v1" })
  : null;

// ── Per-contact brief generator ───────────────────────────────────────────────

interface ContactInput {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  activityType: string | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  accuracy: number | null;
  minutesSincePing: number;
}

async function generateBrief(
  c: ContactInput,
): Promise<{ brief: string; risk: "safe" | "warning" | "alert" }> {
  // Fallback (no AI key or network error)
  const fallback = (): { brief: string; risk: "safe" | "warning" | "alert" } => {
    const act = c.activityType ?? "stationary";
    const loc = c.address ?? "an unknown location";
    let risk: "safe" | "warning" | "alert" = "safe";
    if (c.minutesSincePing > 15 || (c.batteryLevel !== null && c.batteryLevel < 10)) risk = "alert";
    else if (c.minutesSincePing > 5 || (c.batteryLevel !== null && c.batteryLevel < 30)) risk = "warning";
    return {
      brief: `${c.name} is currently ${act} at ${loc}. Battery ${c.batteryLevel !== null ? `${c.batteryLevel}%` : "unknown"}, last ping ${c.minutesSincePing} minute${c.minutesSincePing !== 1 ? "s" : ""} ago.`,
      risk,
    };
  };

  if (!mistral) return fallback();

  const prompt = `You are Guardian Brief, a safety-aware AI. Write a concise 2–3 sentence situation report for a tracked contact based on their live telemetry.

Contact name: ${c.name}
Location: ${c.address ?? "unknown location"}
Coordinates: ${c.lat !== null ? `${c.lat.toFixed(5)}, ${c.lng?.toFixed(5)}` : "unavailable"}
Activity: ${c.activityType ?? "unknown"}
Battery: ${c.batteryLevel !== null ? `${c.batteryLevel}%${c.batteryCharging ? " (charging)" : ""}` : "unknown"}
GPS accuracy: ${c.accuracy !== null ? `±${Math.round(c.accuracy)}m` : "unknown"}
Minutes since last location ping: ${c.minutesSincePing}

Write a natural, calm, human-readable situation report in third person. Be specific — mention the location name, activity, and any noteworthy signals. Then assign a risk level:
- "safe"    → normal activity, battery ≥30%, ping ≤5min
- "warning" → stationary >30min, battery <30%, or ping >5min
- "alert"   → no ping >15min or battery <10%

Respond ONLY as valid JSON — no markdown, no extra keys:
{"brief": "2–3 sentence report.", "risk": "safe"}`;

  try {
    const res = await mistral.chat.completions.create({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.35,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const risk = (["safe", "warning", "alert"] as const).includes(parsed.risk)
      ? parsed.risk as "safe" | "warning" | "alert"
      : "safe";
    return { brief: String(parsed.brief ?? ""), risk };
  } catch {
    return fallback();
  }
}

// ── GET /api/guardian/brief?userId=X ─────────────────────────────────────────
router.get("/guardian/brief", async (req, res): Promise<void> => {
  const userId = Number(req.query.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  // All accepted invites owned by this user
  const invites = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.fromUserId, userId), eq(invitesTable.status, "accepted")));

  if (invites.length === 0) {
    res.json({ results: [] });
    return;
  }

  const now = Date.now();

  // Fetch latest location update for every token, then generate briefs in parallel
  const results = await Promise.all(
    invites.map(async (invite) => {
      const [latest] = await db
        .select()
        .from(locationUpdatesTable)
        .where(eq(locationUpdatesTable.token, invite.token))
        .orderBy(desc(locationUpdatesTable.createdAt))
        .limit(1);

      const minutesSincePing = latest
        ? Math.floor((now - new Date(latest.createdAt).getTime()) / 60000)
        : 999;

      const { brief, risk } = await generateBrief({
        name:            invite.toName ?? "Contact",
        address:         latest?.address        ?? invite.grantedAddress   ?? null,
        lat:             latest?.latitude       ?? invite.grantedLatitude  ?? null,
        lng:             latest?.longitude      ?? invite.grantedLongitude ?? null,
        activityType:    latest?.activityType   ?? null,
        batteryLevel:    latest?.batteryLevel   ?? null,
        batteryCharging: latest?.batteryCharging ?? null,
        accuracy:        latest?.accuracy       ?? null,
        minutesSincePing,
      });

      return {
        token:           invite.token,
        name:            invite.toName ?? "Contact",
        brief,
        risk,
        lat:             latest?.latitude       ?? invite.grantedLatitude  ?? null,
        lng:             latest?.longitude      ?? invite.grantedLongitude ?? null,
        address:         latest?.address        ?? invite.grantedAddress   ?? null,
        battery:         latest?.batteryLevel   ?? null,
        batteryCharging: latest?.batteryCharging ?? false,
        activity:        latest?.activityType   ?? null,
        accuracy:        latest?.accuracy       ?? null,
        minutesSincePing,
      };
    }),
  );

  res.json({ results });
});

export default router;
