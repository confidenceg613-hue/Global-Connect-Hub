import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, locationUpdatesTable, invitesTable, pushSubscriptionsTable } from "@workspace/db";
import webpush from "web-push";
import { z } from "zod";

const router: IRouter = Router();

// In-memory SSE client registry: token -> Set of SSE responses
const sseClients = new Map<string, Set<Response>>();

function broadcastToToken(token: string, data: object) {
  const clients = sseClients.get(token);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* client gone */ }
  }
}

// Helper to send a push notification to all subscriptions for a user
export async function sendPushToUser(userId: number, payload: { title: string; body: string; tag?: string }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:app@phonelink.local",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { auth: sub.keysAuth, p256dh: sub.keysP256dh },
        },
        JSON.stringify(payload),
      );
    } catch (err: any) {
      // 410 Gone means the subscription is no longer valid — clean it up
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
      }
    }
  }
}

const PushLocationBody = z.object({
  token: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  address: z.string().optional(),
  status: z.enum(["active", "offline"]).default("active"),
});

// POST /api/location/push  — sister posts her live GPS
router.post("/location/push", async (req, res): Promise<void> => {
  const parsed = PushLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, latitude, longitude, accuracy, address, status } = parsed.data;

  // Check previous status to detect online/offline transitions
  const [prev] = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(1);

  // Save the location update
  const [update] = await db
    .insert(locationUpdatesTable)
    .values({ token, latitude, longitude, accuracy, address, status })
    .returning();

  // Look up invite to find the owner and contact name
  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  // Broadcast real-time to SSE clients watching this token
  broadcastToToken(token, { latitude, longitude, accuracy, address, status, timestamp: update.createdAt });

  // Send push notifications on status transitions
  if (invite) {
    const contactName = invite.toName ?? invite.toPhone;
    const prevStatus = prev?.status ?? "active";

    if (status === "offline" && prevStatus === "active") {
      sendPushToUser(invite.fromUserId, {
        title: "📴 Location went offline",
        body: `${contactName}'s device GPS turned off`,
        tag: `offline-${token}`,
      }).catch(() => {});
    } else if (status === "active" && prevStatus === "offline") {
      sendPushToUser(invite.fromUserId, {
        title: "📍 Location back online",
        body: `${contactName} is online again — tap to track`,
        tag: `online-${token}`,
      }).catch(() => {});
    }
  }

  res.json({ ok: true });
});

// GET /api/location/latest/:token  — get last known location
router.get("/location/latest/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const [update] = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(1);

  if (!update) {
    res.status(404).json({ error: "No location found" });
    return;
  }

  res.json(update);
});

// GET /api/location/history/:token  — full GPS trail for a token
router.get("/location/history/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { from, to, limit: limitParam } = req.query as { from?: string; to?: string; limit?: string };

  const conditions: ReturnType<typeof eq>[] = [eq(locationUpdatesTable.token, token)];

  if (from) {
    const { gte } = await import("drizzle-orm");
    conditions.push(gte(locationUpdatesTable.createdAt, new Date(from)));
  }
  if (to) {
    const { lte } = await import("drizzle-orm");
    conditions.push(lte(locationUpdatesTable.createdAt, new Date(to)));
  }

  const limitN = Math.min(parseInt(limitParam ?? "2000", 10), 5000);

  const { and } = await import("drizzle-orm");
  const updates = await db
    .select()
    .from(locationUpdatesTable)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(locationUpdatesTable.createdAt)
    .limit(limitN);

  res.json(updates);
});

// GET /api/location/stream/:token  — SSE stream for real-time location
router.get("/location/stream/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send the latest known position immediately on connect
  const [latest] = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(1);

  if (latest) {
    res.write(`data: ${JSON.stringify({
      latitude: latest.latitude,
      longitude: latest.longitude,
      accuracy: latest.accuracy,
      address: latest.address,
      status: latest.status,
      timestamp: latest.createdAt,
    })}\n\n`);
  }

  // Heartbeat every 20s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 20000);

  // Register this client
  if (!sseClients.has(token)) sseClients.set(token, new Set());
  sseClients.get(token)!.add(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.get(token)?.delete(res);
    if (sseClients.get(token)?.size === 0) sseClients.delete(token);
  });
});

export default router;
