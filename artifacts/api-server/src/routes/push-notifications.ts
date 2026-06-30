import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const SubscribeBody = z.object({
  userId: z.number(),
  endpoint: z.string(),
  keys: z.object({
    auth: z.string(),
    p256dh: z.string(),
  }),
});

// GET /api/push/vapid-public-key — return VAPID public key to frontend
router.get("/push/vapid-public-key", (_req, res): void => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(503).json({ error: "Push notifications not configured" });
    return;
  }
  res.json({ publicKey: key });
});

// POST /api/push/subscribe — save a push subscription for a user
router.post("/push/subscribe", async (req, res): Promise<void> => {
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, endpoint, keys } = parsed.data;

  await db
    .insert(pushSubscriptionsTable)
    .values({ userId, endpoint, keysAuth: keys.auth, keysP256dh: keys.p256dh })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId, keysAuth: keys.auth, keysP256dh: keys.p256dh },
    });

  res.status(201).json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
router.delete("/push/subscribe", async (req, res): Promise<void> => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  res.json({ ok: true });
});

export default router;
