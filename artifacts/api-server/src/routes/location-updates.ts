import { Router } from "express";
import { db } from "@workspace/db";
import {
  locationUpdatesTable,
  invitesTable,
} from "@workspace/db/schema";
import { desc, eq, inArray } from "drizzle-orm";

const router = Router();

// GET /api/location-updates/:userId — every GPS fix recorded for invites the
// user sent, newest first. Powers Settings → Export Data; also handy for
// offline analysis. Ownership is enforced via the invite join so a user can
// only export their own contacts' data.
router.get("/location-updates/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const limit = Math.min(10_000, Math.max(1, parseInt(String(req.query.limit ?? ""), 10) || 10_000));

  try {
    const rows = await db
      .select({
        id: locationUpdatesTable.id,
        token: locationUpdatesTable.token,
        inviteId: invitesTable.id,
        latitude: locationUpdatesTable.latitude,
        longitude: locationUpdatesTable.longitude,
        accuracy: locationUpdatesTable.accuracy,
        source: locationUpdatesTable.source,
        address: locationUpdatesTable.address,
        status: locationUpdatesTable.status,
        batteryLevel: locationUpdatesTable.batteryLevel,
        batteryCharging: locationUpdatesTable.batteryCharging,
        activityType: locationUpdatesTable.activityType,
        createdAt: locationUpdatesTable.createdAt,
        toName: invitesTable.toName,
        toPhone: invitesTable.toPhone,
      })
      .from(locationUpdatesTable)
      .innerJoin(invitesTable, eq(invitesTable.token, locationUpdatesTable.token))
      .where(eq(invitesTable.fromUserId, userId))
      .orderBy(desc(locationUpdatesTable.createdAt))
      .limit(limit);

    res.json(rows);
  } catch {
    // Fail soft — export should never hard-crash the settings page.
    res.json([]);
  }
});

export default router;
