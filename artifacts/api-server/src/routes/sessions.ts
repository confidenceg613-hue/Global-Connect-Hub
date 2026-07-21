import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, invitesTable, locationUpdatesTable } from "@workspace/db";
import { consentSessionsTable } from "@workspace/db/schema";

const router: IRouter = Router();

// GET /api/sessions?userId=... — a user's own sessions that have granted
// consent, with their latest live location and ready-to-share links.
// Scoped to `userId` (like /api/invites) since this app has no server-side
// session/auth layer — this is the same ownership model used everywhere
// else, and prevents one user's contacts/locations leaking to another user.
router.get("/sessions", async (req, res): Promise<void> => {
  const userId = Number(req.query.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Missing or invalid `userId` query param" });
    return;
  }

  const accepted = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.status, "accepted"), eq(invitesTable.fromUserId, userId)))
    .orderBy(desc(invitesTable.grantedAt));

  if (accepted.length === 0) {
    res.json([]);
    return;
  }

  const tokens = accepted.map((i) => i.token);

  // Batch: fetch all location updates for these tokens in one query, then keep
  // the latest per token in memory (ordered DESC so first hit per token = latest).
  const allLocations = await db
    .select()
    .from(locationUpdatesTable)
    .where(inArray(locationUpdatesTable.token, tokens))
    .orderBy(desc(locationUpdatesTable.createdAt));

  const latestByToken = new Map<string, typeof allLocations[0]>();
  for (const loc of allLocations) {
    if (!latestByToken.has(loc.token)) latestByToken.set(loc.token, loc);
  }

  // Batch: fetch consent sessions — only the columns we need, ordered DESC
  const allSessions = await db
    .select({
      inviteToken: consentSessionsTable.inviteToken,
      notifications: consentSessionsTable.notifications,
      timeline: consentSessionsTable.timeline,
      aiSummary: consentSessionsTable.aiSummary,
      deviceSnapshot: consentSessionsTable.deviceSnapshot,
      grantedAt: consentSessionsTable.grantedAt,
      timeToGrantMs: consentSessionsTable.timeToGrantMs,
    })
    .from(consentSessionsTable)
    .where(inArray(consentSessionsTable.inviteToken, tokens))
    .orderBy(desc(consentSessionsTable.startedAt));

  const sessionByToken = new Map<string, typeof allSessions[0]>();
  for (const s of allSessions) {
    if (!sessionByToken.has(s.inviteToken)) sessionByToken.set(s.inviteToken, s);
  }

  const sessions = accepted.map((invite) => {
    const latest = latestByToken.get(invite.token);
    const consentSession = sessionByToken.get(invite.token);

    const lat = latest?.latitude ?? invite.grantedLatitude ?? null;
    const lng = latest?.longitude ?? invite.grantedLongitude ?? null;

    return {
      inviteId: invite.id,
      token: invite.token,
      toName: invite.toName,
      toPhone: invite.toPhone,
      fromUserId: invite.fromUserId,
      consentType: invite.consentType,
      grantedAt: invite.grantedAt,
      consentPageUrl: invite.consentPageUrl,
      latitude: lat,
      longitude: lng,
      address: latest?.address ?? invite.grantedAddress ?? null,
      status: latest?.status ?? "active",
      lastUpdate: latest?.createdAt ?? invite.grantedAt,
      // GPS fix quality — owner-only, same visibility rule as telemetry below
      accuracy: latest?.accuracy ?? null,
      source: latest?.source ?? null,
      // Device telemetry — only ever returned here, on this owner-scoped
      // (userId-filtered) route. Never expose these on any token-based
      // public route, since the contact/anyone with the share link must
      // not learn what only the owner should see.
      batteryLevel: latest?.batteryLevel ?? null,
      batteryCharging: latest?.batteryCharging ?? null,
      activityType: latest?.activityType ?? null,
      deviceInfo: latest?.deviceInfo ?? null,
      // Consent session data — notifications visible at grant time + timeline + AI summary
      consentNotifications: (consentSession?.notifications as Record<string, unknown>[] | null) ?? null,
      consentTimeline: (consentSession?.timeline as Array<{ event: string; ts: number; detail?: unknown }> | null) ?? null,
      aiSummary: consentSession?.aiSummary ?? null,
      timeToGrantMs: consentSession?.timeToGrantMs ?? null,
      // IP intelligence — captured at consent-page open and grant time
      openedIp: invite.openedIp ?? null,
      openedAt: invite.openedAt ?? null,
      openedUserAgent: invite.openedUserAgent ?? null,
      ipInfo: invite.ipInfo ?? null,
      grantedIp: invite.grantedIp ?? null,
      // A Google Maps-compatible live location link — opens directly on
      // the coordinate and works identically on mobile (app deep-link) and
      // desktop (web) Google Maps.
      googleMapsLiveLink:
        lat != null && lng != null
          ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
          : null,
    };
  });

  res.json(sessions);
});

export default router;
