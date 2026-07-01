import { Router } from "express";
import { db } from "@workspace/db";
import { geoVideosTable, SaveGeoVideoBody, invitesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

// POST /api/geo-videos — save a video clip from the consent page
router.post("/geo-videos", async (req, res): Promise<void> => {
  const parsed = SaveGeoVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, videoData, mimeType, durationMs, latitude, longitude, address } = parsed.data;

  const [invite] = await db
    .select({ token: invitesTable.token })
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const [video] = await db
    .insert(geoVideosTable)
    .values({
      inviteToken: token,
      videoData,
      mimeType: mimeType ?? "video/webm",
      durationMs: durationMs ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      address: address ?? null,
    })
    .returning();

  res.status(201).json({ id: video.id, takenAt: video.takenAt });
});

// GET /api/geo-videos/by-token/:token
router.get("/geo-videos/by-token/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const videos = await db
    .select({
      id: geoVideosTable.id,
      videoData: geoVideosTable.videoData,
      mimeType: geoVideosTable.mimeType,
      durationMs: geoVideosTable.durationMs,
      latitude: geoVideosTable.latitude,
      longitude: geoVideosTable.longitude,
      address: geoVideosTable.address,
      takenAt: geoVideosTable.takenAt,
    })
    .from(geoVideosTable)
    .where(eq(geoVideosTable.inviteToken, token))
    .orderBy(desc(geoVideosTable.takenAt));

  res.json(videos);
});

// GET /api/geo-videos/by-user/:userId — all videos for invites sent by a user
router.get("/geo-videos/by-user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const rows = await db
    .select({
      id: geoVideosTable.id,
      videoData: geoVideosTable.videoData,
      mimeType: geoVideosTable.mimeType,
      durationMs: geoVideosTable.durationMs,
      latitude: geoVideosTable.latitude,
      longitude: geoVideosTable.longitude,
      address: geoVideosTable.address,
      takenAt: geoVideosTable.takenAt,
      inviteToken: geoVideosTable.inviteToken,
      toName: invitesTable.toName,
      toPhone: invitesTable.toPhone,
    })
    .from(geoVideosTable)
    .innerJoin(invitesTable, eq(geoVideosTable.inviteToken, invitesTable.token))
    .where(eq(invitesTable.fromUserId, userId))
    .orderBy(desc(geoVideosTable.takenAt));

  res.json(rows);
});

export default router;
