import { Router } from "express";
import { db } from "@workspace/db";
import {
  locationTypeReportsTable,
  CreateLocationTypeReportBody,
  invitesTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

// GET /api/location-reports/by-user/:userId — all reports for invites sent by a user
router.get("/location-reports/by-user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const rows = await db
    .select({
      id: locationTypeReportsTable.id,
      latitude: locationTypeReportsTable.latitude,
      longitude: locationTypeReportsTable.longitude,
      reportedType: locationTypeReportsTable.reportedType,
      suggestedType: locationTypeReportsTable.suggestedType,
      comment: locationTypeReportsTable.comment,
      createdAt: locationTypeReportsTable.createdAt,
      inviteToken: locationTypeReportsTable.inviteToken,
      toName: invitesTable.toName,
      toPhone: invitesTable.toPhone,
      grantedAddress: invitesTable.grantedAddress,
    })
    .from(locationTypeReportsTable)
    .innerJoin(invitesTable, eq(locationTypeReportsTable.inviteToken, invitesTable.token))
    .where(eq(invitesTable.fromUserId, userId))
    .orderBy(desc(locationTypeReportsTable.createdAt));

  res.json(rows);
});

// POST /api/location-reports — flag an auto-detected location type as incorrect
router.post("/location-reports", async (req, res): Promise<void> => {
  const parsed = CreateLocationTypeReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, latitude, longitude, reportedType, suggestedType, comment } = parsed.data;

  const [invite] = await db
    .select({ token: invitesTable.token })
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const [report] = await db
    .insert(locationTypeReportsTable)
    .values({
      inviteToken: token,
      latitude,
      longitude,
      reportedType,
      suggestedType,
      comment,
    })
    .returning();

  res.status(201).json({ id: report.id, createdAt: report.createdAt });
});

export default router;
