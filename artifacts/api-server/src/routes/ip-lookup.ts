import { Router, type IRouter } from "express";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { db, invitesTable, locationUpdatesTable } from "@workspace/db";

const router: IRouter = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  return (
    !ip || ip === "unknown" || ip === "localhost" ||
    ip.startsWith("127.") || ip.startsWith("::1") ||
    ip.startsWith("10.") || ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === "::ffff:127.0.0.1"
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── Multi-source IP geolocation ─────────────────────────────────────────────

export interface GeoSource {
  provider: string;
  lat: number;
  lon: number;
  city?: string;
  regionName?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  timezone?: string;
  isp?: string;
  org?: string;
  asn?: string;
  asnName?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

async function queryIpApi(ip: string): Promise<GeoSource | null> {
  try {
    const fields = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query";
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as Record<string, unknown>;
    if (d.status !== "success" || typeof d.lat !== "number" || typeof d.lon !== "number") return null;
    return {
      provider: "ip-api.com",
      lat: d.lat, lon: d.lon,
      city: d.city as string | undefined,
      regionName: d.regionName as string | undefined,
      country: d.country as string | undefined,
      countryCode: d.countryCode as string | undefined,
      zip: d.zip as string | undefined,
      timezone: d.timezone as string | undefined,
      isp: d.isp as string | undefined,
      org: d.org as string | undefined,
      asn: d.as as string | undefined,
      asnName: d.asname as string | undefined,
      mobile: d.mobile as boolean | undefined,
      proxy: d.proxy as boolean | undefined,
      hosting: d.hosting as boolean | undefined,
    };
  } catch { return null; }
}

async function queryIpWhoIs(ip: string): Promise<GeoSource | null> {
  try {
    const r = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as Record<string, unknown>;
    if (!d.success || typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;
    const conn = d.connection as Record<string, unknown> | undefined;
    const tz = d.timezone as Record<string, unknown> | undefined;
    return {
      provider: "ipwho.is",
      lat: d.latitude, lon: d.longitude,
      city: d.city as string | undefined,
      regionName: d.region as string | undefined,
      country: d.country as string | undefined,
      countryCode: d.country_code as string | undefined,
      zip: d.postal as string | undefined,
      timezone: tz?.id as string | undefined,
      isp: conn?.isp as string | undefined,
      org: conn?.org as string | undefined,
      asn: conn?.asn != null ? `AS${conn.asn}` : undefined,
    };
  } catch { return null; }
}

async function queryIpInfo(ip: string): Promise<GeoSource | null> {
  try {
    const r = await fetch(
      `https://ipinfo.io/${encodeURIComponent(ip)}/json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as Record<string, unknown>;
    if (typeof d.loc !== "string") return null;
    const [latStr, lonStr] = d.loc.split(",");
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const orgStr = typeof d.org === "string" ? d.org : undefined;
    return {
      provider: "ipinfo.io",
      lat, lon,
      city: d.city as string | undefined,
      regionName: d.region as string | undefined,
      country: d.country as string | undefined,
      timezone: d.timezone as string | undefined,
      org: orgStr,
      asn: orgStr?.split(" ")[0],
      asnName: orgStr?.split(" ").slice(1).join(" "),
    };
  } catch { return null; }
}

async function queryFreeIpApi(ip: string): Promise<GeoSource | null> {
  try {
    const r = await fetch(
      `https://freeipapi.com/api/json/${encodeURIComponent(ip)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as Record<string, unknown>;
    if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;
    return {
      provider: "freeipapi.com",
      lat: d.latitude, lon: d.longitude,
      city: d.cityName as string | undefined,
      regionName: d.regionName as string | undefined,
      country: d.countryName as string | undefined,
      countryCode: d.countryCode as string | undefined,
      zip: d.zipCode as string | undefined,
      timezone: d.timeZone as string | undefined,
    };
  } catch { return null; }
}

export interface IpIntel {
  sources: GeoSource[];
  consensus: {
    lat: number;
    lon: number;
    radiusKm: number;
    confidencePct: number;
    agreementCount: number;
    totalQueried: number;
    method: string;
  };
  flags: {
    mobile: boolean;
    proxy: boolean;
    hosting: boolean;
    vpnLikely: boolean;
  };
  asn?: string;
  asnName?: string;
}

async function resolveIpIntelligence(ip: string): Promise<IpIntel | { note: string }> {
  if (isPrivateIp(ip)) {
    return { note: "Private/local address — no public geolocation available" };
  }

  const TOTAL_QUERIED = 4;

  // Query all four sources simultaneously
  const [src1, src2, src3, src4] = await Promise.all([
    queryIpApi(ip),
    queryIpWhoIs(ip),
    queryIpInfo(ip),
    queryFreeIpApi(ip),
  ]);

  const sources = [src1, src2, src3, src4].filter((s): s is GeoSource => s !== null);

  if (sources.length === 0) {
    return { note: "All geolocation providers returned no result for this IP" };
  }

  // Find the largest cluster of sources within 50 km of each other
  // (sources far apart = one of them is wrong; the majority cluster wins)
  let bestGroup: GeoSource[] = [];
  for (let i = 0; i < sources.length; i++) {
    const group = sources.filter((s) =>
      haversineKm(sources[i].lat, sources[i].lon, s.lat, s.lon) <= 50
    );
    if (group.length > bestGroup.length) bestGroup = group;
  }
  if (bestGroup.length === 0) bestGroup = [sources[0]];

  // Weighted centroid of the agreeing cluster
  const centerLat = bestGroup.reduce((a, s) => a + s.lat, 0) / bestGroup.length;
  const centerLon = bestGroup.reduce((a, s) => a + s.lon, 0) / bestGroup.length;

  // Uncertainty radius = how spread the agreeing cluster is
  const radiusKm = Math.max(
    ...bestGroup.map((s) => haversineKm(centerLat, centerLon, s.lat, s.lon)),
    0.3, // minimum 300 m to avoid a false zero
  );

  // Confidence scoring:
  // Each extra agreeing source adds confidence. Tight cluster = higher score.
  const agreeRatio = bestGroup.length / TOTAL_QUERIED;
  const spreadBonus = radiusKm < 2 ? 18 : radiusKm < 10 ? 10 : radiusKm < 30 ? 4 : 0;
  const sourcesAvailable = sources.length / TOTAL_QUERIED;
  const rawPct = agreeRatio * 65 + sourcesAvailable * 10 + spreadBonus;
  // IP geolocation is city-level at best; cap at 89 so GPS always wins
  const confidencePct = Math.min(Math.round(rawPct), 89);

  // Flags from ip-api.com (most complete) with fallback
  const ipApiSrc = sources.find((s) => s.provider === "ip-api.com");
  const mobile = ipApiSrc?.mobile ?? false;
  const proxy  = ipApiSrc?.proxy  ?? false;
  const hosting = ipApiSrc?.hosting ?? false;
  const vpnLikely = proxy || hosting ||
    sources.some((s) => /vpn|proxy|tor/i.test(`${s.asnName ?? ""} ${s.org ?? ""}`));

  const bestAsn = sources.find((s) => s.asn)?.asn;
  const bestAsnName = sources.find((s) => s.asnName)?.asnName ??
    sources.find((s) => s.org)?.org;

  return {
    sources,
    consensus: {
      lat: centerLat,
      lon: centerLon,
      radiusKm,
      confidencePct,
      agreementCount: bestGroup.length,
      totalQueried: TOTAL_QUERIED,
      method: `${bestGroup.length}/${sources.length} sources agree · ±${radiusKm < 1 ? `${(radiusKm * 1000).toFixed(0)} m` : `${radiusKm.toFixed(1)} km`}`,
    },
    flags: { mobile, proxy, hosting, vpnLikely },
    asn: bestAsn,
    asnName: bestAsnName,
  };
}

// ── GPS source quality score (higher = more precise) ────────────────────────
function gpsQuality(source: string | null, accuracyM: number | null): number {
  const base = source === "gps" ? 1000 : source === "fused" ? 500 : source === "network" ? 100 : 10;
  const accBoost = accuracyM != null && accuracyM > 0 ? Math.max(1, 500 / accuracyM) : 1;
  return base * accBoost;
}

// ── Route: return the caller's own public IP ──────────────────────────────────

/**
 * GET /api/ip-lookup/my-ip
 *
 * Returns the public IP address of whoever is making the request.
 * Relies on `app.set("trust proxy", true)` so req.ip reads from x-forwarded-for.
 */
router.get("/ip-lookup/my-ip", (req, res): void => {
  const raw = req.ip ?? req.socket.remoteAddress ?? "";
  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4)
  const ip = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (!ip || isPrivateIp(ip)) {
    res.status(422).json({ error: "Could not determine a public IP for this request" });
    return;
  }
  res.json({ ip });
});

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/ip-lookup?ip=X&userId=Y
 *
 * Precision location lookup using:
 * 1. 4-source IP geolocation with cross-reference triangulation
 * 2. All GPS fixes ever recorded for matching contacts
 * 3. Movement vector from sequential fixes
 *
 * Owner-scoped: only invites sent by userId are searched.
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

  // Run DB lookup + all 4 IP geo queries in parallel
  const [matched, ipIntel] = await Promise.all([
    db
      .select()
      .from(invitesTable)
      .where(
        and(
          eq(invitesTable.fromUserId, userId),
          or(eq(invitesTable.openedIp, ip), eq(invitesTable.grantedIp, ip)),
        ),
      )
      .orderBy(desc(invitesTable.grantedAt)),
    resolveIpIntelligence(ip),
  ]);

  if (matched.length === 0) {
    res.json({ contacts: [], ipIntel, searchedIp: ip, bestEstimate: null });
    return;
  }

  const tokens = matched.map((i) => i.token);

  const allLocs = await db
    .select()
    .from(locationUpdatesTable)
    .where(inArray(locationUpdatesTable.token, tokens))
    .orderBy(desc(locationUpdatesTable.createdAt));

  // Group by token (already desc, so index 0 = latest)
  const locsByToken = new Map<string, typeof allLocs>();
  for (const loc of allLocs) {
    if (!locsByToken.has(loc.token)) locsByToken.set(loc.token, []);
    locsByToken.get(loc.token)!.push(loc);
  }

  const contacts = matched.map((invite) => {
    const locs = locsByToken.get(invite.token) ?? [];
    const latest = locs[0] ?? null;

    const lat = latest?.latitude ?? invite.grantedLatitude ?? null;
    const lng = latest?.longitude ?? invite.grantedLongitude ?? null;

    // Movement vector from last 2 GPS fixes
    let movementVector: {
      bearingDeg: number; speedKmh: number; distanceM: number;
      ageSecs: number;
    } | null = null;

    if (locs.length >= 2) {
      const a = locs[0];
      const b = locs[1];
      const distKm = haversineKm(b.latitude, b.longitude, a.latitude, a.longitude);
      const timeDiffMs = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (distKm > 0.005 && timeDiffMs > 0) {
        const speedKmh = distKm / (timeDiffMs / 3_600_000);
        if (speedKmh < 350) {
          movementVector = {
            bearingDeg: bearingDeg(b.latitude, b.longitude, a.latitude, a.longitude),
            speedKmh: Math.round(speedKmh * 10) / 10,
            distanceM: Math.round(distKm * 1000),
            ageSecs: Math.round((Date.now() - new Date(a.createdAt).getTime()) / 1000),
          };
        }
      }
    }

    return {
      inviteId:         invite.id,
      token:            invite.token,
      toName:           invite.toName,
      toPhone:          invite.toPhone,
      status:           invite.status,
      grantedAt:        invite.grantedAt,
      openedAt:         invite.openedAt,
      openedIp:         invite.openedIp,
      grantedIp:        invite.grantedIp,
      ipInfo:           invite.ipInfo,
      latitude:         lat,
      longitude:        lng,
      address:          latest?.address ?? invite.grantedAddress ?? null,
      lastUpdate:       latest?.createdAt ?? invite.grantedAt,
      accuracy:         latest?.accuracy ?? null,
      batteryLevel:     latest?.batteryLevel ?? null,
      batteryCharging:  latest?.batteryCharging ?? null,
      activityType:     latest?.activityType ?? null,
      source:           latest?.source ?? null,
      hasGpsfix:        lat != null && lng != null,
      gpsQualityScore:  gpsQuality(latest?.source ?? null, latest?.accuracy ?? null),
      movementVector,
      // Full history for trail — up to 150 fixes
      locationHistory: locs.slice(0, 150).map((l) => ({
        lat:      l.latitude,
        lng:      l.longitude,
        accuracy: l.accuracy,
        source:   l.source,
        activity: l.activityType,
        battery:  l.batteryLevel,
        address:  l.address,
        ts:       l.createdAt,
      })),
      matchedOn: [
        invite.openedIp === ip ? "openedIp" : null,
        invite.grantedIp === ip ? "grantedIp" : null,
      ].filter(Boolean) as string[],
    };
  });

  // ── Best estimate: always from live IP geolocation (real-time, independent) ──
  // Stored GPS data from PhoneLink contacts is intentionally NOT used here —
  // it reflects a past location, not the current position of this IP address.
  let bestEstimate: {
    lat: number; lon: number; accuracyM: number;
    method: string; confidencePct: number;
    tier: "PRECISE" | "HIGH" | "MODERATE" | "LOW" | "ESTIMATE";
    contactName: string | null; contactPhone: string | null;
    source: string;
  } | null = null;

  if ("consensus" in ipIntel) {
    const acc = ipIntel.consensus.radiusKm * 1000;
    const pct = ipIntel.consensus.confidencePct;
    const tier: "PRECISE" | "HIGH" | "MODERATE" | "LOW" | "ESTIMATE" =
      pct >= 85 ? "HIGH" : pct >= 60 ? "MODERATE" : pct >= 40 ? "LOW" : "ESTIMATE";
    bestEstimate = {
      lat: ipIntel.consensus.lat,
      lon: ipIntel.consensus.lon,
      accuracyM: acc,
      method: `IP triangulation · ${ipIntel.consensus.method}`,
      confidencePct: pct,
      tier,
      contactName: contacts[0]?.toName ?? null,
      contactPhone: contacts[0]?.toPhone ?? null,
      source: "ip",
    };
  }

  res.json({ contacts, ipIntel, searchedIp: ip, bestEstimate });
});

export default router;
