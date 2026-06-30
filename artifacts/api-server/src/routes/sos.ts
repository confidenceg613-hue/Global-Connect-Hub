import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, invitesTable } from "@workspace/db";
import { z } from "zod";
import { sendPushAndLog } from "../lib/notifications";

const router: IRouter = Router();

const SosBody = z.object({
  userId: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().optional(),
});

router.post("/sos", async (req, res): Promise<void> => {
  const parsed = SosBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { userId, latitude, longitude, address } = parsed.data;

  const invites = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.fromUserId, userId));

  const recipientUserIds = new Set<number>();
  for (const inv of invites) {
    if (inv.status === "accepted") {
      recipientUserIds.add(inv.fromUserId);
    }
  }

  const coordStr = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const notifPayload = {
    type: "sos" as const,
    title: "🆘 SOS — Emergency Alert",
    body: address
      ? `Emergency at ${address}`
      : `Emergency at ${coordStr}`,
    tag: `sos-${userId}-${Date.now()}`,
    data: { latitude, longitude, address: address ?? null, fromUserId: userId },
  };

  await sendPushAndLog(userId, notifPayload);

  const otherIds = [...recipientUserIds].filter((id) => id !== userId);
  await Promise.all(otherIds.map((id) => sendPushAndLog(id, notifPayload)));

  res.json({ ok: true, notified: otherIds.length + 1 });
});

export default router;
