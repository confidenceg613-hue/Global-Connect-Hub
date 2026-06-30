import { Router } from "express";
import { db } from "@workspace/db";
import {
  locationTypeReportsTable,
  CreateLocationTypeReportBody,
  invitesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

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
