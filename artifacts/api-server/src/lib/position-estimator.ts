/**
 * Position Estimator — synthesises a best-guess current position for a
 * contact token by combining every available signal, in priority order:
 *
 *  1. Fresh GPS fix         (< 30 s)            → return as-is
 *  2. Stationary device     (any age)            → extrapolate with slow accuracy decay
 *  3. Moving device, heading known               → dead-reckoning projection
 *  4. IP geolocation        (last stored IP)     → coarse but honest
 *  5. Last known position   (maximum uncertainty) → fallback of last resort
 *
 * This is the engine that keeps "quiet" devices visible even when their GPS
 * radio is off, the browser tab is backgrounded, or the device is indoors.
 */

import { db, locationUpdatesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BestEstimate {
  latitude: number;
  longitude: number;
  /** Estimated horizontal uncertainty radius in metres */
  accuracyMeters: number;
  /** 0–1: how confident we are in this position */
  confidence: number;
  /** How the estimate was derived */
  method: "gps_live" | "gps_extrapolated" | "dead_reckoning" | "ip_geo" | "last_known";
  /** Which signal types contributed */
  sources: string[];
  estimatedAt: string;
  /** Age of the underlying GPS fix in milliseconds */
  gpsAgeMs: number;
  /** For dead_reckoning: distance projected forward from the last known fix */
  deadReckoningDistanceM?: number;
}

type ActivityType = "stationary" | "walking" | "running" | "driving";

// Typical speeds per activity type (metres / second)
const ACTIVITY_SPEED_MPS: Record<ActivityType, number> = {
  stationary: 0,
  walking:    1.4,
  running:    3.5,
  driving:   13.9,  // ~50 km/h urban average
};

// How quickly the accuracy radius grows per second without a new GPS fix
const ACCURACY_GROWTH_PER_S: Record<ActivityType, number> = {
  stationary: 0.05,  // almost no drift for a still device
  walking:    1.5,
  running:    4.0,
  driving:   22.0,
};

// Confidence half-life (seconds) — time for confidence to drop to 50 % of its initial value
const CONFIDENCE_HALF_LIFE_S: Record<ActivityType, number> = {
  stationary: 1_800,  // 30 min
  walking:      900,  // 15 min
  running:      480,  //  8 min
  driving:      300,  //  5 min
};

// ── Geometry helpers ─────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dO = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Project a point forward by distM metres along bearingDeg (degrees true north). */
function projectPoint(lat: number, lng: number, distM: number, bearingDeg: number): [number, number] {
  const R = 6_371_000;
  const d  = distM / R;
  const b  = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, ((λ2 * 180) / Math.PI + 540) % 360 - 180];
}

function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── IP geolocation ────────────────────────────────────────────────────────────

/** Resolve an IP address to lat/lng via ip-api.com (free, no key). Returns null on error. */
async function resolveIpGeo(ip: string): Promise<{ lat: number; lng: number } | null> {
  if (
    !ip || ip === "unknown" ||
    ip.startsWith("127.") || ip.startsWith("::1") ||
    ip.startsWith("10.")  || ip.startsWith("192.168.") ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.")
  ) return null;

  try {
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon`,
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as { status: string; lat?: number; lon?: number };
    if (d.status !== "success" || d.lat == null || d.lon == null) return null;
    return { lat: d.lat, lng: d.lon };
  } catch {
    return null;
  }
}

/** Extract the public IP stored in the device_info blob. */
function extractStoredIp(deviceInfo: unknown): string | null {
  const di = deviceInfo as Record<string, unknown> | null;
  if (!di) return null;
  const net = di.network as Record<string, unknown> | null;
  return typeof net?.publicIp === "string" ? net.publicIp : null;
}

// ── Main estimator ────────────────────────────────────────────────────────────

/**
 * Compute the best current position estimate for a contact invite token.
 * Returns null only when no location data exists at all for the token.
 */
export async function estimatePosition(token: string): Promise<BestEstimate | null> {
  const now = Date.now();

  const recent = await db
    .select()
    .from(locationUpdatesTable)
    .where(eq(locationUpdatesTable.token, token))
    .orderBy(desc(locationUpdatesTable.createdAt))
    .limit(3);

  if (recent.length === 0) return null;

  const last = recent[0];
  const prev = recent[1] ?? null;

  const gpsAgeMs   = now - new Date(last.createdAt).getTime();
  const gpsAgeSec  = gpsAgeMs / 1000;
  const baseAcc    = last.accuracy ?? 50;
  const activity   = (last.activityType ?? "stationary") as ActivityType;
  const speed      = ACTIVITY_SPEED_MPS[activity];
  const growthRate = ACCURACY_GROWTH_PER_S[activity];
  const halfLife   = CONFIDENCE_HALF_LIFE_S[activity];

  // ── 1. Live GPS (< 30 s) — return as-is ─────────────────────────────────
  if (gpsAgeMs < 30_000) {
    return {
      latitude: last.latitude,
      longitude: last.longitude,
      accuracyMeters: baseAcc,
      confidence: 0.95,
      method: "gps_live",
      sources: [last.source ?? "gps"],
      estimatedAt: new Date().toISOString(),
      gpsAgeMs,
    };
  }

  // ── 2. Stationary or slow device — extrapolate with growing radius ───────
  if (activity === "stationary" || speed === 0) {
    const projAcc    = Math.min(baseAcc + growthRate * gpsAgeSec, 50_000);
    const confidence = Math.max(0.10, 0.92 * Math.exp((-0.693 * gpsAgeSec) / halfLife));
    return {
      latitude:  last.latitude,
      longitude: last.longitude,
      accuracyMeters: projAcc,
      confidence,
      method: "gps_extrapolated",
      sources: ["gps", "time_extrapolation"],
      estimatedAt: new Date().toISOString(),
      gpsAgeMs,
    };
  }

  // ── 3. Moving device — try dead reckoning ────────────────────────────────
  // Prefer GPS-reported heading; fall back to the vector between the last two fixes.
  const di           = last.deviceInfo as Record<string, unknown> | null;
  const gpsExtras    = di?.gps as Record<string, unknown> | null;
  const storedHdg    = gpsExtras?.headingDeg ?? di?.headingDeg;
  let   bearing: number | null = typeof storedHdg === "number" ? storedHdg : null;

  if (bearing == null && prev) {
    const d = haversineM(prev.latitude, prev.longitude, last.latitude, last.longitude);
    if (d > 5) bearing = bearingBetween(prev.latitude, prev.longitude, last.latitude, last.longitude);
  }

  if (bearing != null) {
    // Cap projection at 90 min — beyond that the uncertainty is too large to be useful
    const cappedSec    = Math.min(gpsAgeSec, 5_400);
    const distanceM    = speed * cappedSec;
    const [pLat, pLng] = projectPoint(last.latitude, last.longitude, distanceM, bearing);
    const projAcc      = Math.min(baseAcc + growthRate * gpsAgeSec, 50_000);
    const confidence   = Math.max(0.10, 0.80 * Math.exp((-0.693 * gpsAgeSec) / halfLife));
    return {
      latitude:  pLat,
      longitude: pLng,
      accuracyMeters: projAcc,
      confidence,
      method: "dead_reckoning",
      sources: ["gps", "accelerometer", "dead_reckoning"],
      estimatedAt: new Date().toISOString(),
      gpsAgeMs,
      deadReckoningDistanceM: distanceM,
    };
  }

  // ── 4. IP geolocation — no usable heading ────────────────────────────────
  const ip = extractStoredIp(last.deviceInfo);
  if (ip) {
    const geo = await resolveIpGeo(ip);
    if (geo) {
      const ipConf = Math.max(0.08, 0.35 * Math.exp((-0.693 * gpsAgeSec) / 7_200));
      return {
        latitude:  geo.lat,
        longitude: geo.lng,
        accuracyMeters: 5_000,
        confidence: ipConf,
        method: "ip_geo",
        sources: ["ip_geo"],
        estimatedAt: new Date().toISOString(),
        gpsAgeMs,
      };
    }
  }

  // ── 5. Last known position (maximum uncertainty) ─────────────────────────
  const projAcc    = Math.min(baseAcc + growthRate * gpsAgeSec, 50_000);
  const confidence = Math.max(0.05, 0.70 * Math.exp((-0.693 * gpsAgeSec) / halfLife));
  return {
    latitude:  last.latitude,
    longitude: last.longitude,
    accuracyMeters: projAcc,
    confidence,
    method: "last_known",
    sources: [last.source ?? "gps"],
    estimatedAt: new Date().toISOString(),
    gpsAgeMs,
  };
}
