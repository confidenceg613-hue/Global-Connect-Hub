/**
 * Quiet-Device Inference Engine
 *
 * Produces best-estimate positional data during silent/intermittent periods by
 * combining every available residual signal:
 *   • Dead-reckoning from last known GPS velocity + heading
 *   • Battery drain rate as an activity-intensity proxy
 *   • Correlated signals (WiFi, BT, cellular, accelerometer, barometer,
 *     network_info) ingested by quiet devices as temporal/spatial anchors
 *   • Linear interpolation blend toward the next confirmed GPS fix
 *
 * GET /api/signals/quiet-inference/:token?from=ISO&to=ISO&stepMinutes=N
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte, lte, asc, sql } from "drizzle-orm";
import { db, locationUpdatesTable, correlatedSignalsTable } from "@workspace/db";

const router: IRouter = Router();

// ── Math helpers ──────────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dL = (la2 - la1) * DEG2RAD;
  const dO = (lo2 - lo1) * DEG2RAD;
  const a = Math.sin(dL / 2) ** 2 + Math.cos(la1 * DEG2RAD) * Math.cos(la2 * DEG2RAD) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Project a position forward in time using speed (m/s) and compass heading (°N cw).
 * Returns new (lat, lng).
 */
function deadReckon(
  lat: number, lng: number,
  speedMps: number, headingDeg: number,
  dtSeconds: number,
): { lat: number; lng: number } {
  const dist = speedMps * dtSeconds;
  const h = headingDeg * DEG2RAD;
  const dlat = (dist * Math.cos(h)) / 111_320;
  const dlng = (dist * Math.sin(h)) / (111_320 * Math.cos(lat * DEG2RAD));
  return { lat: lat + dlat, lng: lng + dlng };
}

/**
 * Blend two positions linearly; t ∈ [0, 1] where 0 = a, 1 = b.
 */
function lerp(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GpsFix {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  activityType: string | null;
  batteryLevel: number | null;
  deviceInfo: unknown;
  createdAt: Date;
}

interface InferredPosition {
  timestamp: string;
  latitude: number;
  longitude: number;
  /** 1-sigma uncertainty radius in metres */
  uncertaintyMeters: number;
  method: "dead_reckoning" | "blend" | "last_known" | "signal_anchor";
  sources: string[];
  confidence: number;
  gapId: number;
}

// ── Activity speed priors (m/s) ───────────────────────────────────────────────
const ACTIVITY_SPEED: Record<string, number> = {
  stationary: 0.0,
  walking: 1.2,
  running: 3.5,
  driving: 14.0,
};

// Battery drain heuristic: drain rate (% / minute) above this threshold
// suggests sustained activity (walking/running); below suggests stationary.
const DRAIN_ACTIVE_THRESHOLD = 0.08; // > 0.08 %/min ≈ active

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/signals/quiet-inference/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86_400_000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();
  const stepMinutes = Math.max(1, Math.min(30, Number(req.query.stepMinutes ?? 5)));
  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5-minute gap triggers inference

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid from/to" });
    return;
  }

  // Fetch GPS fixes and correlated signals in parallel
  const [gpsRows, correlatedRows] = await Promise.all([
    db.select({
      id:           locationUpdatesTable.id,
      latitude:     locationUpdatesTable.latitude,
      longitude:    locationUpdatesTable.longitude,
      accuracy:     locationUpdatesTable.accuracy,
      activityType: locationUpdatesTable.activityType,
      batteryLevel: locationUpdatesTable.batteryLevel,
      deviceInfo:   locationUpdatesTable.deviceInfo,
      createdAt:    locationUpdatesTable.createdAt,
    })
    .from(locationUpdatesTable)
    .where(and(
      eq(locationUpdatesTable.token, token),
      gte(locationUpdatesTable.createdAt, from),
      lte(locationUpdatesTable.createdAt, to),
      sql`${locationUpdatesTable.status} = 'active'`,
    ))
    .orderBy(asc(locationUpdatesTable.createdAt))
    .limit(5000),

    db.select()
    .from(correlatedSignalsTable)
    .where(and(
      eq(correlatedSignalsTable.token, token),
      gte(correlatedSignalsTable.observedAt, from),
      lte(correlatedSignalsTable.observedAt, to),
    ))
    .orderBy(asc(correlatedSignalsTable.observedAt))
    .limit(20000),
  ]);

  if (gpsRows.length === 0) {
    // No GPS at all — use correlated signals only for a temporal-only timeline
    const temporalOnly = correlatedRows.map((s) => ({
      timestamp:        s.observedAt.toISOString(),
      latitude:         s.latitude ?? null,
      longitude:        s.longitude ?? null,
      uncertaintyMeters: s.latitude != null ? 200 : null,
      method:           "signal_anchor" as const,
      sources:          [s.sourceType],
      confidence:       s.confidence,
      gapId:            0,
    }));
    res.json({
      inferredPositions: temporalOnly,
      gapsFilled: 0,
      totalGapMinutes: 0,
      totalInferredPoints: temporalOnly.length,
      message: "No GPS fixes in range; correlated signals returned as temporal anchors.",
    });
    return;
  }

  const fixes = gpsRows as GpsFix[];
  const inferred: InferredPosition[] = [];
  let gapsFilled = 0;
  let totalGapMs = 0;

  for (let i = 0; i < fixes.length - 1; i++) {
    const prev = fixes[i];
    const next = fixes[i + 1];
    const gapMs = next.createdAt.getTime() - prev.createdAt.getTime();

    if (gapMs <= GAP_THRESHOLD_MS) continue;

    gapsFilled++;
    totalGapMs += gapMs;
    const gapStartMs = prev.createdAt.getTime();
    const gapEndMs   = next.createdAt.getTime();

    // ── Extract velocity from deviceInfo ────────────────────────────────────
    const di = (prev.deviceInfo as Record<string, unknown> | null) ?? {};
    const speedMps    = typeof di.speedMps === "number"    ? di.speedMps    : null;
    const headingDeg  = typeof di.headingDeg === "number"  ? di.headingDeg  : null;

    // ── Correlated signals inside this gap ──────────────────────────────────
    const gapSignals = correlatedRows.filter(
      (s) => s.observedAt.getTime() > gapStartMs && s.observedAt.getTime() < gapEndMs,
    );

    // Spatial anchors: signals with coordinates inside the gap
    const anchors = gapSignals.filter((s) => s.latitude != null && s.longitude != null);

    // ── Accelerometer signals → activity speed prior ─────────────────────────
    const accelSignals = gapSignals.filter((s) => s.sourceType === "accelerometer");
    let activitySpeedPrior: number | null = null;
    if (accelSignals.length > 0) {
      // Average magnitude from metadata.magnitude
      const mags = accelSignals.map((s) => {
        const m = (s.metadata as Record<string, unknown> | null)?.magnitude;
        return typeof m === "number" ? m : null;
      }).filter((m): m is number => m !== null);
      if (mags.length > 0) {
        const avgMag = mags.reduce((a, b) => a + b, 0) / mags.length;
        // Magnitude heuristic: < 0.1 = stationary, 0.1–0.5 = walking, > 0.5 = running/driving
        activitySpeedPrior = avgMag < 0.1 ? 0 : avgMag < 0.5 ? 1.2 : avgMag < 2.0 ? 3.5 : 8.0;
      }
    }

    // ── Battery drain rate → activity intensity ──────────────────────────────
    const battNow  = prev.batteryLevel;
    const battNext = next.batteryLevel;
    let batteryActivityPrior: number | null = null;
    if (battNow != null && battNext != null && battNow > battNext) {
      const drainPctPerMin = ((battNow - battNext) / (gapMs / 60000));
      batteryActivityPrior = drainPctPerMin > DRAIN_ACTIVE_THRESHOLD ? ACTIVITY_SPEED["walking"] : 0;
    }

    // ── Activity speed estimate (priority: GPS speed > accel > battery > activity type) ──
    const activitySpeed: number =
      (speedMps != null && speedMps > 0) ? speedMps :
      activitySpeedPrior != null ? activitySpeedPrior :
      batteryActivityPrior != null ? batteryActivityPrior :
      ACTIVITY_SPEED[prev.activityType ?? "stationary"] ?? 0;

    // ── Drift coefficient: uncertainty grows as sqrt(dt) ────────────────────
    // Base accuracy from last GPS fix; minimum 10m
    const baseAccuracy = Math.max(prev.accuracy ?? 20, 10);
    // Drift: 3 m/√s for known heading, 10 m/√s for unknown
    const driftCoeff = (speedMps != null && headingDeg != null) ? 3 : 10;

    // ── Sample the gap at stepMinutes intervals ──────────────────────────────
    const stepMs = stepMinutes * 60 * 1000;
    let sampleTs = gapStartMs + stepMs;

    while (sampleTs < gapEndMs) {
      const dtFromPrevS = (sampleTs - gapStartMs) / 1000;
      const tBlend      = (sampleTs - gapStartMs) / gapMs; // [0,1] toward next fix

      let lat: number, lng: number;
      let method: InferredPosition["method"];
      let uncertainty: number;
      let sources: string[] = ["gps"];

      // ── Check if a spatial anchor covers this timestamp ──────────────────
      const nearAnchor = anchors.find((a) => {
        const anchorMs = a.observedAt.getTime();
        return Math.abs(anchorMs - sampleTs) <= stepMs;
      });

      if (nearAnchor) {
        lat    = nearAnchor.latitude!;
        lng    = nearAnchor.longitude!;
        method = "signal_anchor";
        uncertainty = Math.max(nearAnchor.accuracy ?? 150, 50);
        sources = [nearAnchor.sourceType, "gps"];
      } else if (speedMps != null && headingDeg != null && speedMps > 0.5) {
        // Dead-reckon from prev fix then blend toward next fix
        const dr    = deadReckon(prev.latitude, prev.longitude, speedMps, headingDeg, dtFromPrevS);
        const blend = lerp(dr, { lat: next.latitude, lng: next.longitude }, tBlend * tBlend);
        lat    = blend.lat;
        lng    = blend.lng;
        method = "dead_reckoning";
        // Uncertainty grows with sqrt of time since last confirmed fix, capped at 5 km
        uncertainty = Math.min(baseAccuracy + driftCoeff * Math.sqrt(dtFromPrevS), 5000);
        sources = ["gps"];
      } else {
        // No velocity — linearly interpolate between known fixes
        const b = lerp(
          { lat: prev.latitude, lng: prev.longitude },
          { lat: next.latitude, lng: next.longitude },
          tBlend,
        );
        lat    = b.lat;
        lng    = b.lng;
        method = "blend";
        uncertainty = Math.min(baseAccuracy + driftCoeff * Math.sqrt(dtFromPrevS), 10_000);
        sources = ["gps"];
      }

      // Add accel/battery sources if they contributed
      if (accelSignals.length > 0) sources.push("accelerometer");
      if (gapSignals.some((s) => s.sourceType === "network_info")) sources.push("network_info");
      if (batteryActivityPrior != null) sources.push("battery");
      sources = [...new Set(sources)];

      // Confidence: starts high for dead_reckoning, decays with uncertainty
      const maxRange = method === "dead_reckoning" ? 1000 : method === "blend" ? 5000 : 500;
      const confidence = Math.max(0.05, 1 - uncertainty / maxRange);

      inferred.push({
        timestamp:        new Date(sampleTs).toISOString(),
        latitude:         lat,
        longitude:        lng,
        uncertaintyMeters: Math.round(uncertainty),
        method,
        sources,
        confidence: Math.round(confidence * 100) / 100,
        gapId:            i,
      });

      sampleTs += stepMs;
    }
  }

  // Sort by timestamp (gap fill points are already ordered but be safe)
  inferred.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  res.setHeader("Cache-Control", "no-store");
  res.json({
    inferredPositions:    inferred,
    gapsFilled,
    totalGapMinutes:      Math.round(totalGapMs / 60000),
    totalInferredPoints:  inferred.length,
    gpsFixesUsed:         fixes.length,
    correlatedSignalsUsed: correlatedRows.length,
    dateFrom: from.toISOString(),
    dateTo:   to.toISOString(),
  });
});

export default router;
