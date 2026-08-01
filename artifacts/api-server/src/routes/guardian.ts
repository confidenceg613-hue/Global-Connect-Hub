import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { eq, and, desc } from "drizzle-orm";
import { db, locationUpdatesTable, invitesTable } from "@workspace/db";
import { geoPhotosTable } from "@workspace/db/schema";
import { geoVideosTable } from "@workspace/db/schema";

const router: IRouter = Router();

// ── Mistral clients ───────────────────────────────────────────────────────────
const mistralKey = process.env.MISTRAL_API_KEY?.trim();
const mistral = mistralKey
  ? new OpenAI({ apiKey: mistralKey, baseURL: "https://api.mistral.ai/v1" })
  : null;

// Models
const TEXT_MODEL   = "mistral-large-latest";
const VISION_MODEL = "pixtral-12b-2409"; // multimodal — handles images + text

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface PhotoContext {
  photoData: string;      // full data URL e.g. "data:image/jpeg;base64,..."
  cameraFacing: string;   // "user" | "environment"
  takenAt: Date;
}

interface VideoMeta {
  durationMs: number | null;
  cameraFacing: string;
  takenAt: Date;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Cap a base64 data URL so it doesn't exceed Pixtral's per-image limit (~4 MB). */
function trimImage(dataUrl: string, maxBytes = 3_500_000): string | null {
  if (dataUrl.length > maxBytes) return null; // skip oversized frames
  return dataUrl;
}

function cameraLabel(facing: string) {
  return facing === "user" ? "selfie camera" : "environment camera";
}

// ── Core brief generator ──────────────────────────────────────────────────────

async function generateBrief(
  c: ContactInput,
  photos: PhotoContext[],
  videos: VideoMeta[],
): Promise<{ brief: string; risk: "safe" | "warning" | "alert"; hasVisuals: boolean }> {

  // Text-only fallback (no Mistral key, or catches error)
  const fallback = (): { brief: string; risk: "safe" | "warning" | "alert"; hasVisuals: boolean } => {
    const act = c.activityType ?? "stationary";
    const loc = c.address ?? "an unknown location";
    let risk: "safe" | "warning" | "alert" = "safe";
    if (c.minutesSincePing > 15 || (c.batteryLevel !== null && c.batteryLevel < 10)) risk = "alert";
    else if (c.minutesSincePing > 5 || (c.batteryLevel !== null && c.batteryLevel < 30)) risk = "warning";
    return {
      brief: `${c.name} is currently ${act} at ${loc}. Battery ${c.batteryLevel !== null ? `${c.batteryLevel}%` : "unknown"}, last ping ${c.minutesSincePing} minute${c.minutesSincePing !== 1 ? "s" : ""} ago.`,
      risk,
      hasVisuals: false,
    };
  };

  if (!mistral) return fallback();

  // ── Build image payload ──────────────────────────────────────────────────
  // Take up to 4 photos (prefer most recent — already sorted desc from DB).
  // Keep at most 2 selfie + 2 environment to give balanced visual context.
  const selfies = photos.filter(p => p.cameraFacing === "user").slice(0, 2);
  const envShots = photos.filter(p => p.cameraFacing === "environment").slice(0, 2);
  const selectedPhotos = [...selfies, ...envShots];

  const imageItems: OpenAI.ChatCompletionContentPartImage[] = selectedPhotos
    .map(p => trimImage(p.photoData))
    .filter((d): d is string => d !== null)
    .map(dataUrl => ({
      type: "image_url" as const,
      image_url: { url: dataUrl, detail: "high" as const },
    }));

  const hasVisuals = imageItems.length > 0;

  // ── Build telemetry text ─────────────────────────────────────────────────
  const photoDesc = hasVisuals
    ? [
        ...selfies.length > 0 ? [`${selfies.length} selfie camera frame${selfies.length > 1 ? "s" : ""}`] : [],
        ...envShots.length > 0 ? [`${envShots.length} environment camera frame${envShots.length > 1 ? "s" : ""}`] : [],
      ].join(" and ")
    : "";

  const videoDesc = videos.length > 0
    ? videos
        .map(v => {
          const secs = v.durationMs ? `${(v.durationMs / 1000).toFixed(1)}s` : "duration unknown";
          const when = new Date(v.takenAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          return `${cameraLabel(v.cameraFacing)} video clip (${secs}) recorded at ${when}`;
        })
        .join("; ")
    : "";

  const mediaContext = [
    hasVisuals ? `Visual frames attached for analysis: ${photoDesc}` : "",
    videoDesc   ? `Video clips (metadata only — not image-analysable): ${videoDesc}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are Guardian Brief, a safety-aware AI. Write a concise 2–3 sentence situation report for a tracked contact.

Contact: ${c.name}
Location: ${c.address ?? "unknown location"}
Coordinates: ${c.lat !== null ? `${c.lat.toFixed(5)}, ${c.lng?.toFixed(5)}` : "unavailable"}
Activity: ${c.activityType ?? "unknown"}
Battery: ${c.batteryLevel !== null ? `${c.batteryLevel}%${c.batteryCharging ? " (charging)" : ""}` : "unknown"}
GPS accuracy: ${c.accuracy !== null ? `±${Math.round(c.accuracy)}m` : "unknown"}
Minutes since last ping: ${c.minutesSincePing}
${mediaContext ? `\n${mediaContext}` : ""}
${hasVisuals ? "\nAnalyse the attached camera frames to describe the person's appearance, surroundings, and any contextual details visible in the images. Combine this with the telemetry above." : ""}

Write a natural, calm, third-person report. Be specific. If images are present, describe what you see (appearance, environment, lighting, setting). Then assign risk:
- "safe"    → normal activity, battery ≥30%, ping ≤5min
- "warning" → stationary >30min, battery <30%, or ping >5min
- "alert"   → no ping >15min or battery <10%

Respond ONLY as valid JSON, no markdown:
{"brief": "2–3 sentence report.", "risk": "safe"}`;

  // ── Build message content ────────────────────────────────────────────────
  const userContent: OpenAI.ChatCompletionUserMessageParam["content"] = hasVisuals
    ? [
        ...imageItems,
        { type: "text" as const, text: prompt },
      ]
    : prompt;

  const model = hasVisuals ? VISION_MODEL : TEXT_MODEL;

  try {
    const res = await mistral.chat.completions.create({
      model,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.35,
      max_tokens: 250,
      // response_format only works on text-only requests for Pixtral
      ...(hasVisuals ? {} : { response_format: { type: "json_object" as const } }),
    });

    const raw = res.choices[0]?.message?.content ?? "{}";

    // Extract JSON even when response_format isn't enforced (vision model)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    const risk = (["safe", "warning", "alert"] as const).includes(parsed.risk)
      ? parsed.risk as "safe" | "warning" | "alert"
      : "safe";

    return { brief: String(parsed.brief ?? ""), risk, hasVisuals };
  } catch {
    return { ...fallback(), hasVisuals };
  }
}

// ── GET /guardian/brief?userId=X ──────────────────────────────────────────────
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

  const results = await Promise.all(
    invites.map(async (invite) => {
      // Fetch latest location ping, geo photos, and video metadata in parallel
      const [locationRows, photoRows, videoRows] = await Promise.all([
        db
          .select()
          .from(locationUpdatesTable)
          .where(eq(locationUpdatesTable.token, invite.token))
          .orderBy(desc(locationUpdatesTable.createdAt))
          .limit(1),

        db
          .select({
            photoData:    geoPhotosTable.photoData,
            cameraFacing: geoPhotosTable.cameraFacing,
            takenAt:      geoPhotosTable.takenAt,
          })
          .from(geoPhotosTable)
          .where(eq(geoPhotosTable.inviteToken, invite.token))
          .orderBy(desc(geoPhotosTable.takenAt))
          .limit(4),

        // Select only metadata for videos — skip the large videoData blob
        db
          .select({
            durationMs:   geoVideosTable.durationMs,
            cameraFacing: geoVideosTable.cameraFacing,
            takenAt:      geoVideosTable.takenAt,
          })
          .from(geoVideosTable)
          .where(eq(geoVideosTable.inviteToken, invite.token))
          .orderBy(desc(geoVideosTable.takenAt))
          .limit(4),
      ]);

      const latest = locationRows[0] ?? null;
      const minutesSincePing = latest
        ? Math.floor((now - new Date(latest.createdAt).getTime()) / 60000)
        : 999;

      const { brief, risk, hasVisuals } = await generateBrief(
        {
          name:            invite.toName    ?? "Contact",
          address:         latest?.address  ?? invite.grantedAddress   ?? null,
          lat:             latest?.latitude ?? invite.grantedLatitude  ?? null,
          lng:             latest?.longitude?? invite.grantedLongitude ?? null,
          activityType:    latest?.activityType   ?? null,
          batteryLevel:    latest?.batteryLevel   ?? null,
          batteryCharging: latest?.batteryCharging ?? null,
          accuracy:        latest?.accuracy       ?? null,
          minutesSincePing,
        },
        photoRows as PhotoContext[],
        videoRows as VideoMeta[],
      );

      return {
        token:           invite.token,
        name:            invite.toName ?? "Contact",
        brief,
        risk,
        hasVisuals,
        photoCount:      photoRows.length,
        videoCount:      videoRows.length,
        lat:             latest?.latitude  ?? invite.grantedLatitude  ?? null,
        lng:             latest?.longitude ?? invite.grantedLongitude ?? null,
        address:         latest?.address   ?? invite.grantedAddress   ?? null,
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
