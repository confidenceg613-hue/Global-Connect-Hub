import { Router, type IRouter } from "express";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { db, notificationsLogTable } from "@workspace/db";
import { addNotifSseClient, removeNotifSseClient } from "../lib/notifications.js";

const router: IRouter = Router();

// ── SSE stream ────────────────────────────────────────────────────────────────
// GET /api/notifications/:userId/stream
// Keeps an open connection and pushes new notifications as `data:` events.
// The client is identified by userId only (same trust model as the REST
// endpoints below — no server-side session, ownership enforced by userId param).
router.get("/notifications/:userId/stream", (req, res): void => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: disable proxy buffering
  res.flushHeaders();

  // Send a heartbeat comment every 25 s to keep the connection alive through
  // proxies / load balancers that time out idle connections.
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  addNotifSseClient(userId, res);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeNotifSseClient(userId, res);
  });
});

// ── List ──────────────────────────────────────────────────────────────────────
// GET /api/notifications/:userId[?inviteId=N&type=X]
// Returns up to 50 most recent notifications for the user.
// Optional query params:
//   inviteId — filter to notifications whose JSON `data` contains { inviteId: N }
//   type     — filter by notification type string
router.get("/notifications/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }

  const inviteIdRaw = req.query.inviteId as string | undefined;
  const typeFilter  = req.query.type as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(notificationsLogTable.userId, userId)];

  if (inviteIdRaw) {
    const inviteId = parseInt(inviteIdRaw, 10);
    if (!isNaN(inviteId)) {
      // JSONB containment: data @> '{"inviteId": N}'
      conditions.push(
        sql`${notificationsLogTable.data} @> CAST(${JSON.stringify({ inviteId })} AS jsonb)` as any,
      );
    }
  }

  if (typeFilter) {
    conditions.push(eq(notificationsLogTable.type, typeFilter as any));
  }

  const rows = await db
    .select()
    .from(notificationsLogTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsLogTable.createdAt))
    .limit(50);

  res.json(rows);
});

// ── Unread count ──────────────────────────────────────────────────────────────
router.get("/notifications/:userId/unread-count", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  const { count } = await import("drizzle-orm");
  const [{ value }] = await db
    .select({ value: count() })
    .from(notificationsLogTable)
    .where(
      and(
        eq(notificationsLogTable.userId, userId),
        eq(notificationsLogTable.read, false),
      ),
    );
  res.json({ count: Number(value) });
});

// ── Mark all read ─────────────────────────────────────────────────────────────
router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const { userId } = req.body as { userId?: number };
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db
    .update(notificationsLogTable)
    .set({ read: true })
    .where(eq(notificationsLogTable.userId, userId));
  res.json({ ok: true });
});

// ── Mark specific IDs read ────────────────────────────────────────────────────
router.post("/notifications/read", async (req, res): Promise<void> => {
  const { ids } = req.body as { ids?: number[] };
  if (!ids?.length) { res.status(400).json({ error: "ids required" }); return; }
  await db
    .update(notificationsLogTable)
    .set({ read: true })
    .where(inArray(notificationsLogTable.id, ids));
  res.json({ ok: true });
});

// ── Delete a single notification ──────────────────────────────────────────────
// DELETE /api/notifications/:id?userId=N
// Requires userId so the server can verify ownership before deleting.
router.delete("/notifications/:id", async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id, 10);
  const userId = parseInt(req.query.userId as string ?? "", 10);
  if (isNaN(id) || isNaN(userId)) {
    res.status(400).json({ error: "id and userId required" }); return;
  }
  await db
    .delete(notificationsLogTable)
    .where(and(eq(notificationsLogTable.id, id), eq(notificationsLogTable.userId, userId)));
  res.json({ ok: true });
});

// ── Clear all notifications for a user ───────────────────────────────────────
router.delete("/notifications/clear/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  await db
    .delete(notificationsLogTable)
    .where(eq(notificationsLogTable.userId, userId));
  res.json({ ok: true });
});

export default router;
