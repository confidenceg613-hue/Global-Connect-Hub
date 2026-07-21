import { Router, type IRouter } from "express";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, groupSharesTable, groupShareMembersTable, usersTable, invitesTable, locationUpdatesTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

function shortId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CreateGroupBody = z.object({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(80),
});

const JoinGroupBody = z.object({
  displayName: z.string().max(60).optional(),
  // If the client already has a memberToken from a previous join (e.g. stored
  // in localStorage), send it here so the server can return the same slot
  // instead of creating a duplicate member row.
  existingMemberToken: z.string().optional(),
});

// ─── POST /api/group-shares  (owner creates a group share link) ──────────────
router.post("/group-shares", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { userId, name } = parsed.data;

  // Verify user exists
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const groupId = shortId(9); // 12-char URL-safe token

  const [group] = await db
    .insert(groupSharesTable)
    .values({ groupId, ownerUserId: userId, name })
    .returning();

  res.status(201).json(group);
});

// ─── GET /api/group-shares?userId=  (list owner's groups) ────────────────────
router.get("/group-shares", async (req, res): Promise<void> => {
  const userId = Number(req.query.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Missing userId" }); return;
  }

  // Single join query instead of N+1 per-group count queries
  const rows = await db
    .select({
      id: groupSharesTable.id,
      groupId: groupSharesTable.groupId,
      ownerUserId: groupSharesTable.ownerUserId,
      name: groupSharesTable.name,
      createdAt: groupSharesTable.createdAt,
      memberCount: count(groupShareMembersTable.id),
    })
    .from(groupSharesTable)
    .leftJoin(groupShareMembersTable, eq(groupShareMembersTable.groupShareId, groupSharesTable.id))
    .where(eq(groupSharesTable.ownerUserId, userId))
    .groupBy(
      groupSharesTable.id,
      groupSharesTable.groupId,
      groupSharesTable.ownerUserId,
      groupSharesTable.name,
      groupSharesTable.createdAt,
    );

  res.json(rows);
});

// ─── GET /api/group-shares/:groupId/info  (public — for join page) ───────────
router.get("/group-shares/:groupId/info", async (req, res): Promise<void> => {
  const { groupId } = req.params;

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const [owner] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, group.ownerUserId));

  res.json({ groupId: group.groupId, name: group.name, ownerName: owner?.name ?? "Someone" });
});

// ─── POST /api/group-shares/:groupId/join  (member joins, gets their tokens) ──
//
// Creates both:
//   1. A group_share_members row (memberToken = per-group identity stored in
//      the member's localStorage so a page reload resumes the same slot).
//   2. A real invite record (status = accepted) so the member can push location
//      to /api/location/push using inviteToken — giving live-map visibility,
//      geofence checks, push notifications, and full telemetry for free.
router.post("/group-shares/:groupId/join", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const parsed = JoinGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  // ── Idempotent rejoin: if the client already has a memberToken for this
  // group, return the same slot so no duplicate row is created.
  if (parsed.data.existingMemberToken) {
    const [existing] = await db
      .select()
      .from(groupShareMembersTable)
      .where(
        and(
          eq(groupShareMembersTable.memberToken, parsed.data.existingMemberToken),
          eq(groupShareMembersTable.groupShareId, group.id),
        ),
      );

    if (existing) {
      res.status(200).json({
        memberToken: existing.memberToken,
        inviteToken: existing.inviteToken,
        groupId,
        groupName:   group.name,
      });
      return;
    }
    // Token not found for this group (e.g. stale data from a different group) —
    // fall through and create a fresh slot below.
  }

  const memberToken = shortId(12); // 16-char unique per-member identity token
  const inviteToken = shortId(8);  // 11-char invite token used for location push

  // Build a synthetic "accepted" invite so the member's location flows through
  // the standard /api/location/push pipeline (live-map SSE, geofences, notifications).
  const syntheticPhone = `grp_${memberToken}`;
  const [invite] = await db
    .insert(invitesTable)
    .values({
      fromUserId:   group.ownerUserId,
      toPhone:      syntheticPhone,
      toName:       parsed.data.displayName ?? "Group member",
      message:      `[group:${groupId}]`,
      whatsappLink: "",
      status:       "accepted",
      consentType:  "location",
      token:        inviteToken,
      consentPageUrl: null,
      grantedAt:    new Date(),
    })
    .returning();

  const [member] = await db
    .insert(groupShareMembersTable)
    .values({
      groupShareId: group.id,
      memberToken,
      inviteToken:  invite.token,
      displayName:  parsed.data.displayName ?? null,
    })
    .returning();

  res.status(201).json({
    memberToken:  member.memberToken,
    inviteToken:  invite.token,
    groupId,
    groupName:    group.name,
  });
});

// ─── GET /api/group-shares/:groupId/members  (owner — current member list) ───
//
// Returns each member with their inviteToken so the GMap frontend can subscribe
// to /api/location/stream/:inviteToken for live SSE updates per-member.
router.get("/group-shares/:groupId/members", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const userId = Number(req.query.userId);

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  if (group.ownerUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const members = await db
    .select()
    .from(groupShareMembersTable)
    .where(eq(groupShareMembersTable.groupShareId, group.id));

  // Batch: one DISTINCT ON query for latest location per member token (replaces N per-member queries)
  const inviteTokens = members.map((m) => m.inviteToken).filter(Boolean) as string[];

  const latestByToken = new Map<string, {
    lat: number; lng: number; accuracy: number | null; address: string | null;
    status: string; timestamp: Date; batteryLevel: number | null;
    batteryCharging: boolean | null; activityType: string | null;
  }>();

  if (inviteTokens.length > 0) {
    const allLocations = await db
      .select({
        token: locationUpdatesTable.token,
        latitude: locationUpdatesTable.latitude,
        longitude: locationUpdatesTable.longitude,
        accuracy: locationUpdatesTable.accuracy,
        address: locationUpdatesTable.address,
        status: locationUpdatesTable.status,
        createdAt: locationUpdatesTable.createdAt,
        batteryLevel: locationUpdatesTable.batteryLevel,
        batteryCharging: locationUpdatesTable.batteryCharging,
        activityType: locationUpdatesTable.activityType,
      })
      .from(locationUpdatesTable)
      .where(inArray(locationUpdatesTable.token, inviteTokens))
      .orderBy(desc(locationUpdatesTable.createdAt));

    for (const row of allLocations) {
      if (!latestByToken.has(row.token)) {
        latestByToken.set(row.token, {
          lat: row.latitude,
          lng: row.longitude,
          accuracy: row.accuracy,
          address: row.address,
          status: row.status,
          timestamp: row.createdAt,
          batteryLevel: row.batteryLevel,
          batteryCharging: row.batteryCharging,
          activityType: row.activityType,
        });
      }
    }
  }

  const enriched = members.map((m) => {
    let latest = null;
    if (m.inviteToken && latestByToken.has(m.inviteToken)) {
      latest = latestByToken.get(m.inviteToken)!;
    } else if (m.lastLat != null && m.lastLng != null) {
      // Fallback for legacy members that joined before inviteToken existed
      latest = {
        lat: m.lastLat,
        lng: m.lastLng,
        accuracy: null,
        address: m.lastAddress,
        status: "active" as const,
        timestamp: m.lastSeen,
        batteryLevel: null,
        batteryCharging: null,
        activityType: null,
      };
    }
    return { ...m, latest };
  });

  res.json(enriched);
});

// ─── DELETE /api/group-shares/:groupId  (owner deletes group) ────────────────
router.delete("/group-shares/:groupId", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const userId = Number(req.body?.userId ?? req.query.userId);

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  if (group.ownerUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  // Delete the group — cascades to group_share_members. The synthetic invites
  // are left in place so location history is preserved, but they no longer
  // affect anything since the group is gone.
  await db.delete(groupSharesTable).where(eq(groupSharesTable.id, group.id));

  res.json({ ok: true });
});

// ─── POST /api/group-shares/:groupId/push  (legacy — kept for backward compat)
//
// Old clients that joined before the inviteToken migration still push here.
// New clients push directly to /api/location/push using their inviteToken.
const LegacyPushBody = z.object({
  memberToken: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  address: z.string().optional(),
  status: z.enum(["active", "offline"]).default("active"),
});

router.post("/group-shares/:groupId/push", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const parsed = LegacyPushBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { memberToken, latitude, longitude, accuracy, address, status } = parsed.data;

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const [member] = await db
    .select()
    .from(groupShareMembersTable)
    .where(
      and(
        eq(groupShareMembersTable.memberToken, memberToken),
        eq(groupShareMembersTable.groupShareId, group.id),
      ),
    );

  if (!member) { res.status(403).json({ error: "Invalid member token" }); return; }

  // Update member's last-seen location (legacy path — no telemetry)
  await db
    .update(groupShareMembersTable)
    .set({ lastLat: latitude, lastLng: longitude, lastAddress: address ?? null, lastSeen: new Date() })
    .where(eq(groupShareMembersTable.id, member.id));

  res.json({ ok: true });
});

export default router;
