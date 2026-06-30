import { Router } from "express";
import { db } from "@workspace/db";
import {
  locationTypeReportsTable,
  locationTypeOverridesTable,
  CreateLocationTypeReportBody,
  invitesTable,
  roundCoordKey,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";

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

// GET /api/location-overrides/by-token/:token — overrides to apply to a given invite's pins
router.get("/location-overrides/by-token/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const rows = await db
    .select()
    .from(locationTypeOverridesTable)
    .where(eq(locationTypeOverridesTable.inviteToken, token));
  res.json(rows);
});

// POST /api/location-reports/:id/resolve — accept the suggested type, creating/updating an override
router.post("/location-reports/:id/resolve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }

  const [report] = await db
    .select()
    .from(locationTypeReportsTable)
    .where(eq(locationTypeReportsTable.id, id));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const latKey = roundCoordKey(report.latitude);
  const lngKey = roundCoordKey(report.longitude);

  const [existing] = await db
    .select()
    .from(locationTypeOverridesTable)
    .where(
      and(
        eq(locationTypeOverridesTable.inviteToken, report.inviteToken),
        eq(locationTypeOverridesTable.latKey, latKey),
        eq(locationTypeOverridesTable.lngKey, lngKey),
      ),
    );

  if (existing) {
    await db
      .update(locationTypeOverridesTable)
      .set({ overrideType: report.suggestedType, sourceReportId: report.id })
      .where(eq(locationTypeOverridesTable.id, existing.id));
  } else {
    await db.insert(locationTypeOverridesTable).values({
      inviteToken: report.inviteToken,
      latKey,
      lngKey,
      overrideType: report.suggestedType,
      sourceReportId: report.id,
    });
  }

  await db
    .update(locationTypeReportsTable)
    .set({ status: "resolved" })
    .where(eq(locationTypeReportsTable.id, id));

  res.json({ ok: true });
});

// POST /api/location-reports/:id/dismiss — reject the report without creating an override
router.post("/location-reports/:id/dismiss", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }

  const [report] = await db
    .select({ id: locationTypeReportsTable.id })
    .from(locationTypeReportsTable)
    .where(eq(locationTypeReportsTable.id, id));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  await db
    .update(locationTypeReportsTable)
    .set({ status: "dismissed" })
    .where(eq(locationTypeReportsTable.id, id));

  res.json({ ok: true });
});

export default router;
