import { Router } from "express";
import { db } from "@workspace/db";
import { geoPhotosTable, SaveGeoPhotoBody, invitesTable, usersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

// POST /api/geo-photos — save a single geo photo from the consent page
router.post("/geo-photos", async (req, res): Promise<void> => {
  const parsed = SaveGeoPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, photoData, latitude, longitude, address } = parsed.data;

  // Validate that the invite token exists
  const [invite] = await db
    .select({ token: invitesTable.token })
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const [photo] = await db
    .insert(geoPhotosTable)
    .values({ inviteToken: token, photoData, latitude, longitude, address })
    .returning();

  res.status(201).json({ id: photo.id, takenAt: photo.takenAt });
});

// GET /api/geo-photos/by-token/:token — photos for a specific invite token
router.get("/geo-photos/by-token/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const photos = await db
    .select({
      id: geoPhotosTable.id,
      photoData: geoPhotosTable.photoData,
      latitude: geoPhotosTable.latitude,
      longitude: geoPhotosTable.longitude,
      address: geoPhotosTable.address,
      takenAt: geoPhotosTable.takenAt,
    })
    .from(geoPhotosTable)
    .where(eq(geoPhotosTable.inviteToken, token))
    .orderBy(desc(geoPhotosTable.takenAt));

  res.json(photos);
});

// GET /api/geo-photos/by-user/:userId — all photos for all invites sent by a user
router.get("/geo-photos/by-user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const rows = await db
    .select({
      id: geoPhotosTable.id,
      photoData: geoPhotosTable.photoData,
      latitude: geoPhotosTable.latitude,
      longitude: geoPhotosTable.longitude,
      address: geoPhotosTable.address,
      takenAt: geoPhotosTable.takenAt,
      inviteToken: geoPhotosTable.inviteToken,
      toName: invitesTable.toName,
      toPhone: invitesTable.toPhone,
    })
    .from(geoPhotosTable)
    .innerJoin(invitesTable, eq(geoPhotosTable.inviteToken, invitesTable.token))
    .where(eq(invitesTable.fromUserId, userId))
    .orderBy(desc(geoPhotosTable.takenAt));

  res.json(rows);
});

export default router;
