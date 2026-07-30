/**
 * Movement Analysis — reconstructs historical movement patterns from sparse
 * GPS signals, classifying gaps and returning enriched segments for the
 * pattern-analysis page to visualise.
 *
 * GET /api/location/movement-analysis/:token
 *   ?from=ISO  (default: 30 days ago)
 *   ?to=ISO    (default: now)
 *
 * Response shape:
 * {
 *   segments: Array<RealSegment | GapSegment>,
 *   dailyCounts: Record<"YYYY-MM-DD", number>,
 *   summary: {
 *     totalPoints, totalRealKm, totalGapKm,
 *     totalGaps, gapTotalMinutes, longestGapMinutes,
 *     activeDays, dateFrom, dateTo
 *   }
 * }
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { db, locationUpdatesTable } from "@workspace/db";

const router: IRouter = Router();

// ── helpers ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Classify why a gap likely occurred based on duration and context. */
function classifyGap(
  gapMinutes: number,
  prevStatus: "active" | "offline" | null,
): { reason: string; severity: "minor" | "moderate" | "significant" | "major" } {
  if (prevStatus === "offline") {
    if (gapMinutes < 60) return { reason: "Device reported offline", severity: "minor" };
    if (gapMinutes < 360) return { reason: "GPS disabled or offline mode", severity: "moderate" };
    return { reason: "Extended offline / device off", severity: "significant" };
  }
  if (gapMinutes < 10) return { reason: "Brief signal loss", severity: "minor" };
  if (gapMinutes < 60) return { reason: "App backgrounded or GPS paused", severity: "minor" };
  if (gapMinutes < 360) return { reason: "Probable airplane mode or location disabled", severity: "moderate" };
  if (gapMinutes < 1440) return { reason: "Extended offline period — device off or in airplane mode", severity: "significant" };
  const days = Math.round(gapMinutes / 1440);
  return { reason: `Tracking paused for ~${days} day${days > 1 ? "s" : ""} — location services disabled`, severity: "major" };
}

/** Interpolate N intermediate points along the great-circle arc between two coords. */
function interpolatePath(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  steps: number,
): Array<{ latitude: number; longitude: number }> {
  const pts: Array<{ latitude: number; longitude: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ latitude: lat1 + (lat2 - lat1) * t, longitude: lng1 + (lng2 - lng1) * t });
  }
  return pts;
}

// ── route ────────────────────────────────────────────────────────────────────

const GAP_THRESHOLD_MINUTES = 5; // gaps under this are just normal sampling intervals

router.get("/location/movement-analysis/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const fromDate = req.query.from ? new Date(req.query.from as string) : defaultFrom;
  const toDate = req.query.to ? new Date(req.query.to as string) : now;

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid from/to date" });
    return;
  }

  // Fetch up to 10 000 points — oldest first
  const rawPoints = await db
    .select({
      id: locationUpdatesTable.id,
      latitude: locationUpdatesTable.latitude,
      longitude: locationUpdatesTable.longitude,
      accuracy: locationUpdatesTable.accuracy,
      address: locationUpdatesTable.address,
      status: locationUpdatesTable.status,
      activityType: locationUpdatesTable.activityType,
      createdAt: locationUpdatesTable.createdAt,
    })
    .from(locationUpdatesTable)
    .where(and(
      eq(locationUpdatesTable.token, token),
      gte(locationUpdatesTable.createdAt, fromDate),
      lte(locationUpdatesTable.createdAt, toDate),
    ))
    .orderBy(asc(locationUpdatesTable.createdAt))
    .limit(10000);

  if (rawPoints.length === 0) {
    res.json({
      segments: [],
      dailyCounts: {},
      summary: {
        totalPoints: 0, totalRealKm: 0, totalGapKm: 0,
        totalGaps: 0, gapTotalMinutes: 0, longestGapMinutes: 0,
        activeDays: 0, dateFrom: fromDate.toISOString(), dateTo: toDate.toISOString(),
      },
    });
    return;
  }

  // ── Build segments ─────────────────────────────────────────────────────────
  type RealSegment = {
    type: "real";
    points: typeof rawPoints;
    distanceKm: number;
    durationMinutes: number;
    startTime: string;
    endTime: string;
  };

  type GapSegment = {
    type: "gap";
    fromPoint: { latitude: number; longitude: number; createdAt: Date };
    toPoint: { latitude: number; longitude: number; createdAt: Date };
    interpolated: Array<{ latitude: number; longitude: number }>;
    gapMinutes: number;
    distanceKm: number;
    reason: string;
    severity: "minor" | "moderate" | "significant" | "major";
    startTime: string;
    endTime: string;
  };

  const segments: Array<RealSegment | GapSegment> = [];
  let currentRun: typeof rawPoints = [rawPoints[0]];

  let totalRealKm = 0;
  let totalGapKm = 0;
  let totalGaps = 0;
  let gapTotalMinutes = 0;
  let longestGapMinutes = 0;

  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const gapMs = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
    const gapMin = gapMs / 60000;

    if (gapMin >= GAP_THRESHOLD_MINUTES) {
      // Close the current real segment
      if (currentRun.length > 0) {
        let segKm = 0;
        for (let j = 1; j < currentRun.length; j++) {
          segKm += haversineKm(currentRun[j-1].latitude, currentRun[j-1].longitude, currentRun[j].latitude, currentRun[j].longitude);
        }
        totalRealKm += segKm;
        const segDurMin = currentRun.length > 1
          ? (new Date(currentRun[currentRun.length-1].createdAt).getTime() - new Date(currentRun[0].createdAt).getTime()) / 60000
          : 0;
        segments.push({
          type: "real",
          points: currentRun,
          distanceKm: segKm,
          durationMinutes: Math.round(segDurMin),
          startTime: new Date(currentRun[0].createdAt).toISOString(),
          endTime: new Date(currentRun[currentRun.length - 1].createdAt).toISOString(),
        });
        currentRun = [];
      }

      // Insert a gap segment
      const gapKm = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      totalGapKm += gapKm;
      totalGaps++;
      gapTotalMinutes += gapMin;
      if (gapMin > longestGapMinutes) longestGapMinutes = gapMin;

      const { reason, severity } = classifyGap(gapMin, prev.status as "active" | "offline");
      const interpolated = interpolatePath(prev.latitude, prev.longitude, curr.latitude, curr.longitude, Math.min(10, Math.ceil(gapKm)));

      segments.push({
        type: "gap",
        fromPoint: { latitude: prev.latitude, longitude: prev.longitude, createdAt: prev.createdAt },
        toPoint: { latitude: curr.latitude, longitude: curr.longitude, createdAt: curr.createdAt },
        interpolated,
        gapMinutes: Math.round(gapMin),
        distanceKm: gapKm,
        reason,
        severity,
        startTime: new Date(prev.createdAt).toISOString(),
        endTime: new Date(curr.createdAt).toISOString(),
      });
    }

    currentRun.push(curr);
  }

  // Flush the final real segment
  if (currentRun.length > 0) {
    let segKm = 0;
    for (let j = 1; j < currentRun.length; j++) {
      segKm += haversineKm(currentRun[j-1].latitude, currentRun[j-1].longitude, currentRun[j].latitude, currentRun[j].longitude);
    }
    totalRealKm += segKm;
    const segDurMin = currentRun.length > 1
      ? (new Date(currentRun[currentRun.length-1].createdAt).getTime() - new Date(currentRun[0].createdAt).getTime()) / 60000
      : 0;
    segments.push({
      type: "real",
      points: currentRun,
      distanceKm: segKm,
      durationMinutes: Math.round(segDurMin),
      startTime: new Date(currentRun[0].createdAt).toISOString(),
      endTime: new Date(currentRun[currentRun.length - 1].createdAt).toISOString(),
    });
  }

  // ── Daily counts ───────────────────────────────────────────────────────────
  const dailyCounts: Record<string, number> = {};
  for (const pt of rawPoints) {
    const day = new Date(pt.createdAt).toISOString().slice(0, 10);
    dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
  }

  const activeDays = Object.keys(dailyCounts).length;

  res.setHeader("Cache-Control", "no-store");
  res.json({
    segments,
    dailyCounts,
    summary: {
      totalPoints: rawPoints.length,
      totalRealKm: Math.round(totalRealKm * 100) / 100,
      totalGapKm: Math.round(totalGapKm * 100) / 100,
      totalGaps,
      gapTotalMinutes: Math.round(gapTotalMinutes),
      longestGapMinutes: Math.round(longestGapMinutes),
      activeDays,
      dateFrom: fromDate.toISOString(),
      dateTo: toDate.toISOString(),
    },
  });
});

export default router;
