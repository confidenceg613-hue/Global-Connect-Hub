import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, lt, gte, sql, inArray } from "drizzle-orm";
import { db, locationUpdatesTable, invitesTable, inviteSessionsTable, geofencesTable, correlatedSignalsTable } from "@workspace/db";
import type { NewCorrelatedSignal } from "@workspace/db";
import { z } from "zod";
import { sendPushAndLog, haversineMeters } from "../lib/notifications";
import { scoreInline } from "../lib/spoof-inline";

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
  inviteId: number,
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
          data: { inviteId, fenceId: fence.id, fenceName: fence.name, latitude: curLat, longitude: curLng },
        });
      } else if (prevInside && !curInside) {
        await sendPushAndLog(userId, {
          type: "geofence_exit",
          title: `🚪 Left ${fence.name}`,
          body: `${contactName} departed from ${fence.name}`,
          tag: `geofence-exit-${fence.id}`,
          data: { inviteId, fenceId: fence.id, fenceName: fence.name, latitude: curLat, longitude: curLng },
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

  // Resolve: token may be a sessionToken (new flow) or an inviteToken (legacy/direct).
  // Try session lookup first; fall back to direct invite lookup.
  let inviteToken = token;
  let sessionForToken: { inviteToken: string; expiresAt: Date | null; status: string } | null = null;
  const [maybeSession] = await db
    .select({
      inviteToken: inviteSessionsTable.inviteToken,
      expiresAt: inviteSessionsTable.expiresAt,
      status: inviteSessionsTable.status,
    })
    .from(inviteSessionsTable)
    .where(eq(inviteSessionsTable.sessionToken, token))
    .limit(1);

  if (maybeSession) {
    const isExpired = maybeSession.expiresAt != null && maybeSession.expiresAt <= new Date();
    if (maybeSession.status !== "active" || isExpired) {
      if (maybeSession.status === "active" && isExpired) {
        db
          .update(inviteSessionsTable)
          .set({ status: "ended" })
          .where(eq(inviteSessionsTable.sessionToken, token))
          .catch(() => {});
      }
      res.status(410).json({ error: "This 10-minute location sharing session has ended." });
      return;
    }
    sessionForToken = maybeSession;
    inviteToken = maybeSession.inviteToken;
  }

  // Always store location updates under the invite token so all existing read endpoints
  // (latest, history, SSE stream initial payload, staleness detector) keep working
  // regardless of whether the push came from a session token or the invite token directly.
  const storeToken = inviteToken;

  // Fetch recent points + invite in parallel before inserting.
  // We need recent points to run inline spoof scoring before the insert.
  const [[invite], recent] = await Promise.all([
    db
      .select()
      .from(invitesTable)
      .where(eq(invitesTable.token, inviteToken)),
    db
      .select({
        latitude:        locationUpdatesTable.latitude,
        longitude:       locationUpdatesTable.longitude,
        accuracy:        locationUpdatesTable.accuracy,
        source:          locationUpdatesTable.source,
        status:          locationUpdatesTable.status,
        activityType:    locationUpdatesTable.activityType,
        batteryLevel:    locationUpdatesTable.batteryLevel,
        batteryCharging: locationUpdatesTable.batteryCharging,
        deviceInfo:      locationUpdatesTable.deviceInfo,
        createdAt:       locationUpdatesTable.createdAt,
      })
      .from(locationUpdatesTable)
      .where(eq(locationUpdatesTable.token, storeToken))
      .orderBy(desc(locationUpdatesTable.createdAt))
      .limit(50),
  ]);

  // Oldest-first for the scorer
  const recentAsc = recent.slice().reverse() as Parameters<typeof scoreInline>[1];
  const prev = recent[0] ?? null;

  // Inline spoof scoring — synchronous, fast, never throws
  let spoofScore = 0;
  let spoofFlags: string[] = [];
  try {
    const newPtForScoring = {
      latitude, longitude,
      accuracy: accuracy ?? null,
      source: source ?? null,
      activityType: activityType ?? null,
      batteryLevel: batteryLevel ?? null,
      batteryCharging: batteryCharging ?? null,
      deviceInfo: (enrichedDeviceInfo ?? null) as Record<string, unknown> | null,
      createdAt: new Date(),
    };
    const result = scoreInline(newPtForScoring, recentAsc);
    spoofScore = result.score;
    spoofFlags = result.flags;
  } catch { /* scoring failure must never block the insert */ }

  const [update] = await db
    .insert(locationUpdatesTable)
    .values({
      token: storeToken, latitude, longitude, accuracy, source, address,
      status, batteryLevel, batteryCharging, activityType,
      deviceInfo: enrichedDeviceInfo,
      spoofScore,
      spoofFlags: spoofFlags.length > 0 ? spoofFlags : null,
    })
    .returning();

  // Broadcast SSE on the invite token channel (owner's dashboard map).
  // Include spoof score/flags so the live map can show a trust indicator
  // without requiring an extra API round-trip.
  const ssePaylod = {
    lat: latitude, lng: longitude, accuracy, source, address, status,
    timestamp: update.createdAt,
    spoofScore,
    spoofFlags: spoofFlags.length > 0 ? spoofFlags : undefined,
  };
  broadcastToToken(inviteToken, ssePaylod);
  // Also broadcast on the session token channel if this came from a session push
  // (enables per-session SSE streams in future dashboard features)
  if (sessionForToken && token !== inviteToken) {
    broadcastToToken(token, ssePaylod);
  }

  // Respond to the contact's device right away — notifications and geofence
  // checks run fully in the background and must not delay the 200 OK.
  res.json({ ok: true });

  if (invite) {
    const contactName = invite.toName ?? invite.toPhone;
    const prevStatus = prev?.status ?? "active";

    if (status === "offline" && prevStatus === "active") {
      sendPushAndLog(invite.fromUserId, {
        type: "location_offline",
        title: "📴 Location went offline",
        body: `${contactName}'s device GPS turned off`,
        tag: `offline-${token}`,
        data: { token, inviteId: invite.id, contactName },
      }).catch(() => {});
    } else if (status === "active" && prevStatus === "offline") {
      sendPushAndLog(invite.fromUserId, {
        type: "location_online",
        title: "📍 Location back online",
        body: `${contactName} is online again — tap to track`,
        tag: `online-${token}`,
        data: { token, inviteId: invite.id, contactName },
      }).catch(() => {});
    }

    if (status === "active") {
      // All of this runs after the 200 OK is already sent — fully fire-and-forget.
      // Count + notification + geofence checks must never block the response.
      Promise.resolve().then(async () => {
        const [countRow] = await db
          .select({ n: sql<number>`cast(count(*) as int)` })
          .from(locationUpdatesTable)
          .where(eq(locationUpdatesTable.token, storeToken));
        const updateNumber = countRow?.n ?? 1;

        const locationLabel = address
          ? address.split(",").slice(0, 2).join(",")
          : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        sendPushAndLog(invite.fromUserId, {
          type: "location_update",
          title: `📍 ${contactName} — Update #${updateNumber}`,
          body: `${locationLabel}`,
          tag: `live-update-${token}`,
          data: { token, inviteId: invite.id, contactName, latitude, longitude },
        } as any).catch(() => {});

        clearStalenessAlert(token);

        checkGeofences(
          invite.fromUserId,
          invite.id,
          contactName,
          prev?.latitude ?? null,
          prev?.longitude ?? null,
          latitude,
          longitude,
        ).catch(() => {});
      }).catch(() => {});
    }
  }
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

  if (invites.length === 0) {
    res.json([]);
    return;
  }

  const tokens = invites.map((i) => i.token);

  // Batch: all location updates for these tokens in one query; keep latest per token in memory
  const allLocations = await db
    .select()
    .from(locationUpdatesTable)
    .where(inArray(locationUpdatesTable.token, tokens))
    .orderBy(desc(locationUpdatesTable.createdAt));

  const latestByToken = new Map<string, typeof allLocations[0]>();
  for (const loc of allLocations) {
    if (!latestByToken.has(loc.token)) latestByToken.set(loc.token, loc);
  }

  const results = invites.map((invite) => ({
    token: invite.token,
    toName: invite.toName,
    toPhone: invite.toPhone,
    latest: latestByToken.get(invite.token) ?? null,
  }));

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

// ── POST /api/location/heartbeat ─────────────────────────────────────────────
// Telemetry-only ping from a quiet/GPS-dark device.  No GPS coordinates
// required — the server resolves the requesting IP to a coarse position and
// records it as a correlated_signal entry so the position estimator keeps
// working even when GPS is unavailable.
const HeartbeatBody = z.object({
  token:           z.string(),
  // Optional device-provided coordinates (even very coarse ones help)
  latitude:        z.number().optional(),
  longitude:       z.number().optional(),
  accuracy:        z.number().optional(),
  // Telemetry
  activityType:    z.enum(["stationary", "walking", "running", "driving"]).optional(),
  accelMagnitude:  z.number().optional(),
  batteryLevel:    z.number().min(0).max(100).optional(),
  batteryCharging: z.boolean().optional(),
  networkType:     z.string().optional(),
});

router.post("/location/heartbeat", async (req, res): Promise<void> => {
  const parsed = HeartbeatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, latitude, longitude, accuracy, activityType, accelMagnitude, batteryLevel, batteryCharging, networkType } = parsed.data;

  // Resolve session token → invite token (same pattern as /location/push)
  let inviteToken = token;
  const [maybeSession] = await db
    .select({ inviteToken: inviteSessionsTable.inviteToken, expiresAt: inviteSessionsTable.expiresAt, status: inviteSessionsTable.status })
    .from(inviteSessionsTable)
    .where(eq(inviteSessionsTable.sessionToken, token))
    .limit(1);

  if (maybeSession) {
    if (maybeSession.status !== "active" || (maybeSession.expiresAt && maybeSession.expiresAt <= new Date())) {
      res.status(410).json({ error: "Session expired" });
      return;
    }
    inviteToken = maybeSession.inviteToken;
  }

  // Extract client IP
  const clientIp: string | null =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    (req.headers["x-real-ip"] as string | undefined) ??
    req.socket.remoteAddress ??
    null;

  const now = new Date();
  const signals: NewCorrelatedSignal[] = [];

  // Always record the presence signal (proves device is online with this network context)
  signals.push({
    token:      inviteToken,
    sourceType: "network_info",
    latitude:   null,
    longitude:  null,
    accuracy:   null,
    confidence: 0.35,
    label:      null,
    metadata:   { networkType: networkType ?? null, accelMagnitude: accelMagnitude ?? null, batteryLevel: batteryLevel ?? null, batteryCharging: batteryCharging ?? null, publicIp: clientIp, heartbeat: true },
    observedAt: now,
  });

  if (latitude != null && longitude != null) {
    // Device provided its own coarse coordinates — record them directly
    signals.push({
      token:      inviteToken,
      sourceType: "network_info",
      latitude,
      longitude,
      accuracy:   accuracy ?? 1_000,
      confidence: 0.40,
      label:      "device_heartbeat",
      metadata:   { source: "device_provided" },
      observedAt: now,
    });
  } else if (clientIp) {
    // No device coordinates — resolve the request IP to a coarse position
    const isPrivate =
      clientIp.startsWith("127.") || clientIp.startsWith("::1") ||
      clientIp.startsWith("10.")  || clientIp.startsWith("192.168.") ||
      clientIp === "::ffff:127.0.0.1";

    if (!isPrivate) {
      try {
        const r = await fetch(
          `http://ip-api.com/json/${encodeURIComponent(clientIp)}?fields=status,lat,lon`,
          { signal: AbortSignal.timeout(3_000) },
        );
        if (r.ok) {
          const geo = await r.json() as { status: string; lat?: number; lon?: number };
          if (geo.status === "success" && geo.lat != null && geo.lon != null) {
            signals.push({
              token:      inviteToken,
              sourceType: "network_info",
              latitude:   geo.lat,
              longitude:  geo.lon,
              accuracy:   5_000,
              confidence: 0.35,
              label:      "ip_geo",
              metadata:   { ip: clientIp, source: "ip_geo" },
              observedAt: now,
            });
          }
        }
      } catch { /* non-critical — respond even if IP geo lookup fails */ }
    }
  }

  if (signals.length > 0) {
    await db.insert(correlatedSignalsTable).values(signals);
  }

  // Return the latest best estimate so clients can display something
  const { estimatePosition } = await import("../lib/position-estimator.js");
  const estimate = await estimatePosition(inviteToken);

  res.json({ ok: true, estimate: estimate ?? null });
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

      // Filter to only tokens not yet notified this stale period
      const candidateInvites = acceptedInvites.filter((i) => !notifiedStale.has(i.token));
      if (candidateInvites.length === 0) return;

      const candidateTokens = candidateInvites.map((i) => i.token);

      // Batch: fetch all recent updates for candidate tokens, keep latest per token in memory
      const allLatest = await db
        .select({
          token: locationUpdatesTable.token,
          status: locationUpdatesTable.status,
          createdAt: locationUpdatesTable.createdAt,
        })
        .from(locationUpdatesTable)
        .where(inArray(locationUpdatesTable.token, candidateTokens))
        .orderBy(desc(locationUpdatesTable.createdAt));

      const lastByToken = new Map<string, { token: string; status: string; createdAt: Date }>();
      for (const row of allLatest) {
        if (!lastByToken.has(row.token)) lastByToken.set(row.token, row);
      }

      for (const inv of candidateInvites) {
        const last = lastByToken.get(inv.token);
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
