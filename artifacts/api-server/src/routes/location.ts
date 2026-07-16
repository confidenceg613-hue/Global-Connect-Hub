import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, lt, gte, sql } from "drizzle-orm";
import { db, locationUpdatesTable, invitesTable, geofencesTable } from "@workspace/db";
import { z } from "zod";
import { sendPushAndLog, haversineMeters } from "../lib/notifications";

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

async function checkGeofences(
  userId: number,
  contactName: string,
  prevLat: number | null,
  prevLng: number | null,
  curLat: number,
  curLng: number,
): Promise<void> {
  const fences = await db.select().from(geofencesTable).where(eq(geofencesTable.userId, userId));
  if (!fences.length) return;

  for (const fence of fences) {
    const curDist = haversineMeters(curLat, curLng, fence.latitude, fence.longitude);
    const curInside = curDist <= fence.radiusMeters;

    if (prevLat != null && prevLng != null) {
      const prevDist = haversineMeters(prevLat, prevLng, fence.latitude, fence.longitude);
      const prevInside = prevDist <= fence.radiusMeters;

      if (!prevInside && curInside) {
        await sendPushAndLog(userId, {
          type: "geofence_enter",
          title: `📍 Entered ${fence.name}`,
          body: `${contactName} arrived at ${fence.name}`,
          tag: `geofence-enter-${fence.id}`,
          data: { fenceId: fence.id, fenceName: fence.name, latitude: curLat, longitude: curLng },
        });
      } else if (prevInside && !curInside) {
        await sendPushAndLog(userId, {
          type: "geofence_exit",
          title: `🚪 Left ${fence.name}`,
          body: `${contactName} departed from ${fence.name}`,
          tag: `geofence-exit-${fence.id}`,
          data: { fenceId: fence.id, fenceName: fence.name, latitude: curLat, longitude: curLng },
        });
      }
    }
  }
}

const PushLocationBody = z.object({
  token: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  source: z.enum(["gps", "network", "fused"]).optional(),
  address: z.string().optional(),
  status: z.enum(["active", "offline"]).default("active"),
  // Device telemetry — stored but only ever exposed via the owner-scoped
  // /api/sessions route (see routes/sessions.ts). Never echoed back on the
  // token-authenticated push response or broadcast to SSE listeners, since
  // those are reachable by whoever holds the share link.
  batteryLevel: z.number().min(0).max(100).optional(),
  batteryCharging: z.boolean().optional(),
  activityType: z.enum(["stationary", "walking", "running", "driving"]).optional(),
  // Freeform device/network/raw-GPS bag — same owner-only visibility rule.
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});

// POST /api/location/push  — contact posts their live GPS
router.post("/location/push", async (req, res): Promise<void> => {
  const parsed = PushLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, latitude, longitude, accuracy, source, address, status, batteryLevel, batteryCharging, activityType, deviceInfo } = parsed.data;

  // Capture real public IP from proxy/request headers — merged into the
  // owner-only deviceInfo blob so it appears in the Active Sessions panel.
  const clientIp =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string | undefined) ||
    req.socket.remoteAddress ||
    null;

  const enrichedDeviceInfo = clientIp
    ? {
        ...(deviceInfo ?? {}),
        network: {
          ...((deviceInfo as Record<string, unknown> | undefined)?.["network"] as Record<string, unknown> | undefined ?? {}),
          publicIp: clientIp,
        },
      }
    : deviceInfo;

  const [prev] = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(1);

  const [update] = await db
    .insert(locationUpdatesTable)
    .values({ token, latitude, longitude, accuracy, source, address, status, batteryLevel, batteryCharging, activityType, deviceInfo: enrichedDeviceInfo })
    .returning();

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  // broadcast uses lat/lng to match the LivePos interface on the frontend
  broadcastToToken(token, { lat: latitude, lng: longitude, accuracy, source, address, status, timestamp: update.createdAt });

  if (invite) {
    const contactName = invite.toName ?? invite.toPhone;
    const prevStatus = prev?.status ?? "active";

    if (status === "offline" && prevStatus === "active") {
      sendPushAndLog(invite.fromUserId, {
        type: "location_offline",
        title: "📴 Location went offline",
        body: `${contactName}'s device GPS turned off`,
        tag: `offline-${token}`,
        data: { token, contactName },
      }).catch(() => {});
    } else if (status === "active" && prevStatus === "offline") {
      sendPushAndLog(invite.fromUserId, {
        type: "location_online",
        title: "📍 Location back online",
        body: `${contactName} is online again — tap to track`,
        tag: `online-${token}`,
        data: { token, contactName },
      }).catch(() => {});
    }

    if (status === "active") {
      // Count total updates for this token (used in the live notification counter)
      const [countRow] = await db
        .select({ n: sql<number>`cast(count(*) as int)` })
        .from(locationUpdatesTable)
        .where(eq(locationUpdatesTable.token, token));
      const updateNumber = countRow?.n ?? 1;

      // Live location update notification — uses a single tag so it REPLACES
      // the previous notification (Android) or collapses (iOS), giving the owner
      // a live counter without spamming them with separate notifications.
      const locationLabel = address
        ? address.split(",").slice(0, 2).join(",")
        : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      sendPushAndLog(invite.fromUserId, {
        type: "location_update",
        title: `📍 ${contactName} — Update #${updateNumber}`,
        body: `${locationLabel}`,
        tag: `live-update-${token}`,
        data: { token, contactName, latitude, longitude },
      }).catch(() => {});

      // Fresh location received — reset staleness alert so it can fire again
      // if this contact goes stale in the future
      clearStalenessAlert(token);

      checkGeofences(
        invite.fromUserId,
        contactName,
        prev?.latitude ?? null,
        prev?.longitude ?? null,
        latitude,
        longitude,
      ).catch(() => {});
    }
  }

  res.json({ ok: true });
});

// GET /api/location/latest/:token
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

// GET /api/location/latest-for-user/:userId — latest fix for every invite
// belonging to a user, used by the Activity dashboard's location-quality view.
router.get("/location/latest-for-user/:userId", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const invites = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.fromUserId, userId), eq(invitesTable.status, "accepted")));

  const results = await Promise.all(
    invites.map(async (invite) => {
      const [latest] = await db
        .select()
        .from(locationUpdatesTable)
        .where(eq(locationUpdatesTable.token, invite.token))
        .orderBy(desc(locationUpdatesTable.createdAt))
        .limit(1);

      return {
        token: invite.token,
        toName: invite.toName,
        toPhone: invite.toPhone,
        latest: latest ?? null,
      };
    }),
  );

  res.json(results);
});

// GET /api/location/history/:token
router.get("/location/history/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { from, to, limit: limitParam } = req.query as { from?: string; to?: string; limit?: string };

  const conditions: ReturnType<typeof eq>[] = [eq(locationUpdatesTable.token, token)];

  if (from) conditions.push(gte(locationUpdatesTable.createdAt, new Date(from)));
  if (to) {
    const { lte } = await import("drizzle-orm");
    conditions.push(lte(locationUpdatesTable.createdAt, new Date(to)));
  }

  const limitN = Math.min(parseInt(limitParam ?? "2000", 10), 5000);
  const { and: andFn } = await import("drizzle-orm");

  const updates = await db
    .select()
    .from(locationUpdatesTable)
    .where(conditions.length > 1 ? andFn(...conditions) : conditions[0])
    .orderBy(locationUpdatesTable.createdAt)
    .limit(limitN);

  res.setHeader("Cache-Control", "no-store");
  res.json(updates);
});

// GET /api/location/stream/:token — SSE stream
router.get("/location/stream/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const [latest] = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(1);

  if (latest) {
    // use lat/lng to match the LivePos interface on the frontend
    res.write(`data: ${JSON.stringify({
      lat: latest.latitude,
      lng: latest.longitude,
      accuracy: latest.accuracy,
      address: latest.address,
      status: latest.status,
      timestamp: latest.createdAt,
    })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 20000);

  if (!sseClients.has(token)) sseClients.set(token, new Set());
  sseClients.get(token)!.add(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.get(token)?.delete(res);
    if (sseClients.get(token)?.size === 0) sseClients.delete(token);
  });
});

// Staleness detector — alerts once per stale period per contact.
// Re-arms only when a fresh active location clears the token.
const notifiedStale = new Set<string>();
let detectorRunning = false;

export function clearStalenessAlert(token: string) {
  notifiedStale.delete(token);
}

export function startStalenessDetector() {
  const STALE_MS = 15 * 60 * 1000;
  const CHECK_MS = 5 * 60 * 1000;

  setInterval(async () => {
    // Skip if a previous run is still in flight (prevents overlap duplicates)
    if (detectorRunning) return;
    detectorRunning = true;
    try {
      const acceptedInvites = await db
        .select({
          token: invitesTable.token,
          fromUserId: invitesTable.fromUserId,
          toName: invitesTable.toName,
          toPhone: invitesTable.toPhone,
        })
        .from(invitesTable)
        .where(eq(invitesTable.status, "accepted"));

      // Prune tokens no longer in accepted invites to avoid unbounded growth
      const activeTokens = new Set(acceptedInvites.map((i) => i.token));
      for (const t of notifiedStale) {
        if (!activeTokens.has(t)) notifiedStale.delete(t);
      }

      for (const inv of acceptedInvites) {
        // Already notified this stale period — skip
        if (notifiedStale.has(inv.token)) continue;

        const [last] = await db
          .select()
          .from(locationUpdatesTable)
          .where(eq(locationUpdatesTable.token, inv.token))
          .orderBy(desc(locationUpdatesTable.createdAt))
          .limit(1);

        if (!last) continue;
        if (last.status === "offline") continue;

        const lastTime = new Date(last.createdAt).getTime();
        if (Date.now() - lastTime < STALE_MS) continue;

        const minutesAgo = Math.round((Date.now() - lastTime) / 60000);
        const contactName = inv.toName ?? inv.toPhone;

        try {
          await sendPushAndLog(inv.fromUserId, {
            type: "location_stale",
            title: "⏱ No location update",
            body: `${contactName} hasn't updated in ${minutesAgo} min`,
            tag: `stale-${inv.token}`,
            data: { token: inv.token, contactName, minutesAgo },
          });
          // Only suppress future alerts after a successful send
          notifiedStale.add(inv.token);
        } catch { /* push failed — will retry next cycle */ }
      }
    } catch { /* non-critical */ }
    finally { detectorRunning = false; }
  }, CHECK_MS);
}

export default router;
