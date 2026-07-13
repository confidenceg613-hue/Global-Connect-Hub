import { Router, type IRouter, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, groupSharesTable, groupShareMembersTable, usersTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

function shortId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

// ─── In-memory SSE registry: groupId → Set<Response> ────────────────────────
const groupSseClients = new Map<string, Set<Response>>();

function broadcastToGroup(groupId: string, data: object) {
  const clients = groupSseClients.get(groupId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* client gone */ }
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CreateGroupBody = z.object({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(80),
});

const JoinGroupBody = z.object({
  displayName: z.string().max(60).optional(),
});

const PushGroupLocationBody = z.object({
  memberToken: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  address: z.string().optional(),
  status: z.enum(["active", "offline"]).default("active"),
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

  const groups = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.ownerUserId, userId));

  // For each group, count members
  const result = await Promise.all(
    groups.map(async (g) => {
      const members = await db
        .select()
        .from(groupShareMembersTable)
        .where(eq(groupShareMembersTable.groupShareId, g.id));
      return { ...g, memberCount: members.length };
    }),
  );

  res.json(result);
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

// ─── POST /api/group-shares/:groupId/join  (member joins, gets their token) ──
router.post("/group-shares/:groupId/join", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const parsed = JoinGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const memberToken = shortId(12); // 16-char unique per-member token

  const [member] = await db
    .insert(groupShareMembersTable)
    .values({
      groupShareId: group.id,
      memberToken,
      displayName: parsed.data.displayName ?? null,
    })
    .returning();

  res.status(201).json({ memberToken: member.memberToken, groupId, groupName: group.name });
});

// ─── POST /api/group-shares/:groupId/push  (member pushes their location) ────
router.post("/group-shares/:groupId/push", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const parsed = PushGroupLocationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { memberToken, latitude, longitude, accuracy, address, status } = parsed.data;

  // Verify memberToken belongs to this group
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

  // Update member's last-seen location
  await db
    .update(groupShareMembersTable)
    .set({
      lastLat: latitude,
      lastLng: longitude,
      lastAddress: address ?? null,
      lastSeen: new Date(),
    })
    .where(eq(groupShareMembersTable.id, member.id));

  // Broadcast to all GMap SSE listeners for this group
  broadcastToGroup(groupId, {
    memberToken,
    displayName: member.displayName,
    lat: latitude,
    lng: longitude,
    accuracy,
    address,
    status,
    timestamp: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// ─── GET /api/group-shares/:groupId/stream  (SSE for GMap — owner only) ──────
router.get("/group-shares/:groupId/stream", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const userId = Number(req.query.userId);

  // Auth: verify the requester owns this group
  const [group] = await db
    .select()
    .from(groupSharesTable)
    .where(eq(groupSharesTable.groupId, groupId));

  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  if (group.ownerUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current snapshot of all members' last-known positions
  const members = await db
    .select()
    .from(groupShareMembersTable)
    .where(eq(groupShareMembersTable.groupShareId, group.id));

  for (const m of members) {
    if (m.lastLat != null && m.lastLng != null) {
      res.write(`data: ${JSON.stringify({
        memberToken: m.memberToken,
        displayName: m.displayName,
        lat: m.lastLat,
        lng: m.lastLng,
        address: m.lastAddress,
        status: "active",
        timestamp: m.lastSeen?.toISOString() ?? new Date().toISOString(),
        snapshot: true,
      })}\n\n`);
    }
  }

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 20000);

  if (!groupSseClients.has(groupId)) groupSseClients.set(groupId, new Set());
  groupSseClients.get(groupId)!.add(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    groupSseClients.get(groupId)?.delete(res);
    if (groupSseClients.get(groupId)?.size === 0) groupSseClients.delete(groupId);
  });
});

// ─── GET /api/group-shares/:groupId/members  (owner — current member list) ───
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

  res.json(members);
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

  await db.delete(groupSharesTable).where(eq(groupSharesTable.id, group.id));
  groupSseClients.delete(groupId); // close all SSE streams for this group

  res.json({ ok: true });
});

export default router;
