import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, notificationsLogTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/notifications/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  const rows = await db
    .select()
    .from(notificationsLogTable)
    .where(eq(notificationsLogTable.userId, userId))
    .orderBy(desc(notificationsLogTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.get("/notifications/:userId/unread-count", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  const { count } = await import("drizzle-orm");
  const [{ value }] = await db
    .select({ value: count() })
    .from(notificationsLogTable)
    .where(
      (await import("drizzle-orm")).and(
        eq(notificationsLogTable.userId, userId),
        eq(notificationsLogTable.read, false),
      ),
    );
  res.json({ count: Number(value) });
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const { userId } = req.body as { userId?: number };
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db
    .update(notificationsLogTable)
    .set({ read: true })
    .where(eq(notificationsLogTable.userId, userId));
  res.json({ ok: true });
});

router.post("/notifications/read", async (req, res): Promise<void> => {
  const { ids } = req.body as { ids?: number[] };
  if (!ids?.length) { res.status(400).json({ error: "ids required" }); return; }
  await db
    .update(notificationsLogTable)
    .set({ read: true })
    .where(inArray(notificationsLogTable.id, ids));
  res.json({ ok: true });
});

export default router;
