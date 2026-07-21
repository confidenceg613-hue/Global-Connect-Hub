import { Router, type IRouter } from "express";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { db, invitesTable, locationUpdatesTable } from "@workspace/db";

const router: IRouter = Router();

/** Fire-and-forget ip-api.com lookup. Returns null on any error or private IP. */
async function lookupIp(ip: string): Promise<Record<string, unknown> | null> {
  if (
    !ip || ip === "unknown" ||
    ip.startsWith("127.") || ip.startsWith("::1") ||
    ip.startsWith("10.") || ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") || ip === "::ffff:127.0.0.1"
  ) {
    return { note: "private/local address — no public geo data available", query: ip };
  }
  try {
    const fields = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query";
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`);
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * GET /api/ip-lookup?ip=X&userId=Y
 *
 * Searches ALL invites belonging to this user where openedIp or grantedIp
 * matches the given address, returns their latest known location plus a
 * fresh ip-api.com geolocation of the IP itself for when no GPS fix exists.
 *
 * Owner-scoped (userId filter) — only the person who sent the invite can look
 * up their contacts' IPs.
 */
router.get("/ip-lookup", async (req, res): Promise<void> => {
  const userId = Number(req.query.userId);
  const ip = String(req.query.ip ?? "").trim();

  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Missing or invalid `userId` query param" });
    return;
  }
  if (!ip) {
    res.status(400).json({ error: "Missing `ip` query param" });
    return;
  }

  // Find every invite sent by this user that matches the IP (either at open
  // time or at grant time — covers both link-snooping and consented contacts).
  const matched = await db
    .select()
    .from(invitesTable)
    .where(
      and(
        eq(invitesTable.fromUserId, userId),
        or(
          eq(invitesTable.openedIp, ip),
          eq(invitesTable.grantedIp, ip),
        ),
      ),
    )
    .orderBy(desc(invitesTable.grantedAt));

  // Also resolve fresh geo for the IP itself (runs in parallel with DB fetch).
  const [geoResult] = await Promise.all([
    lookupIp(ip),
  ]);

  if (matched.length === 0) {
    // No contact matched but we still return geo so the map can place the IP.
    res.json({ contacts: [], ipGeo: geoResult, searchedIp: ip });
    return;
  }

  const tokens = matched.map((i) => i.token);

  // Latest location per token.
  const allLocs = await db
    .select()
    .from(locationUpdatesTable)
    .where(inArray(locationUpdatesTable.token, tokens))
    .orderBy(desc(locationUpdatesTable.createdAt));

  const latestByToken = new Map<string, typeof allLocs[0]>();
  for (const loc of allLocs) {
    if (!latestByToken.has(loc.token)) latestByToken.set(loc.token, loc);
  }

  const contacts = matched.map((invite) => {
    const loc = latestByToken.get(invite.token);
    const lat = loc?.latitude ?? invite.grantedLatitude ?? null;
    const lng = loc?.longitude ?? invite.grantedLongitude ?? null;

    return {
      inviteId:      invite.id,
      token:         invite.token,
      toName:        invite.toName,
      toPhone:       invite.toPhone,
      status:        invite.status,
      grantedAt:     invite.grantedAt,
      openedAt:      invite.openedAt,
      openedIp:      invite.openedIp,
      grantedIp:     invite.grantedIp,
      ipInfo:        invite.ipInfo,
      latitude:      lat,
      longitude:     lng,
      address:       loc?.address ?? invite.grantedAddress ?? null,
      lastUpdate:    loc?.createdAt ?? invite.grantedAt,
      accuracy:      loc?.accuracy ?? null,
      batteryLevel:  loc?.batteryLevel ?? null,
      batteryCharging: loc?.batteryCharging ?? null,
      activityType:  loc?.activityType ?? null,
      source:        loc?.source ?? null,
      hasGpsfix:     lat != null && lng != null,
      // Which IP field(s) matched
      matchedOn: [
        invite.openedIp === ip ? "openedIp" : null,
        invite.grantedIp === ip ? "grantedIp" : null,
      ].filter(Boolean) as string[],
    };
  });

  res.json({ contacts, ipGeo: geoResult, searchedIp: ip });
});

export default router;
