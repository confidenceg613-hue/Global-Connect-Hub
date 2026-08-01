/**
 * Signal Fusion — multi-source location correlation engine.
 *
 * POST /api/signals/ingest          — bulk-ingest signals for a token
 * GET  /api/signals/fused/:token    — produce fused continuous timeline
 * GET  /api/signals/raw/:token      — raw signals (paginated)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte, lte, asc, desc, sql } from "drizzle-orm";
import { db, correlatedSignalsTable, inviteSessionsTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

// ── Source confidence defaults ────────────────────────────────────────────────
const SOURCE_CONFIDENCE: Record<string, number> = {
  gps:          0.95,
  telematics:   0.85,
  manual:       0.70,
  wifi:         0.65,
  network:      0.60,
  cellular:     0.50,
  bluetooth:    0.40,
  payment:      0.30,
  // Residual/quiet-device signals — no coordinates but provide temporal presence
  network_info: 0.35,
  barometer:    0.25,
  accelerometer:0.20,
  ambient_light:0.15,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371;
  const dL = ((la2 - la1) * Math.PI) / 180;
  const dO = ((lo2 - lo1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Snap a timestamp to the nearest N-minute bucket floor. */
function bucketFloor(ts: Date, bucketMinutes: number): number {
  const ms = bucketMinutes * 60 * 1000;
  return Math.floor(ts.getTime() / ms) * ms;
}

/**
 * Determine if a gap looks deliberately obscured rather than merely offline.
 * Heuristic: if non-GPS high-confidence signals are present inside a window
 * where GPS was previously active, GPS was likely disabled intentionally.
 */
function isObscured(
  gapHasNonGpsSignals: boolean,
  prevWindowHadGps: boolean,
  gapMinutes: number,
): boolean {
  // Short gap with network signals but no GPS = suspicious
  if (gapHasNonGpsSignals && prevWindowHadGps && gapMinutes < 120) return true;
  // Payment or telematics present = device was active but GPS hidden
  return false;
}

// ── Validation ────────────────────────────────────────────────────────────────

const SignalSchema = z.object({
  sourceType:  z.enum([
    "gps", "wifi", "cellular", "bluetooth", "payment", "telematics", "manual",
    // Residual/quiet-device signal types — temporal presence without GPS
    "accelerometer", "barometer", "network_info", "ambient_light",
  ]),
  latitude:    z.number().optional(),
  longitude:   z.number().optional(),
  accuracy:    z.number().optional(),
  confidence:  z.number().min(0).max(1).optional(),
  label:       z.string().optional(),
  metadata:    z.record(z.string(), z.unknown()).optional(),
  observedAt:  z.string().datetime(),
});

const IngestBody = z.object({
  token:   z.string().min(1),
  signals: z.array(SignalSchema).min(1).max(500),
});

/** Batch ingest — for offline-buffered replay from quiet/intermittent devices. */
const BatchIngestBody = z.object({
  batches: z.array(z.object({
    token:   z.string().min(1),
    signals: z.array(SignalSchema).min(1).max(500),
  })).min(1).max(50),
});

// ── POST /api/signals/ingest-batch ────────────────────────────────────────────
router.post("/signals/ingest-batch", async (req: Request, res: Response): Promise<void> => {
  const parsed = BatchIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = parsed.data.batches.flatMap(({ token, signals }) =>
    signals.map((s) => ({
      token,
      sourceType:  s.sourceType,
      latitude:    s.latitude ?? null,
      longitude:   s.longitude ?? null,
      accuracy:    s.accuracy ?? null,
      confidence:  s.confidence ?? SOURCE_CONFIDENCE[s.sourceType] ?? 0.3,
      label:       s.label ?? null,
      metadata:    s.metadata ?? null,
      observedAt:  new Date(s.observedAt),
    })),
  );

  if (rows.length === 0) {
    res.json({ ok: true, inserted: 0 });
    return;
  }

  await db.insert(correlatedSignalsTable).values(rows);
  res.json({ ok: true, inserted: rows.length, batches: parsed.data.batches.length });
});

// ── POST /api/signals/ingest ──────────────────────────────────────────────────
router.post("/signals/ingest", async (req: Request, res: Response): Promise<void> => {
  const parsed = IngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, signals } = parsed.data;

  const rows = signals.map((s) => ({
    token,
    sourceType:  s.sourceType,
    latitude:    s.latitude ?? null,
    longitude:   s.longitude ?? null,
    accuracy:    s.accuracy ?? null,
    confidence:  s.confidence ?? SOURCE_CONFIDENCE[s.sourceType] ?? 0.5,
    label:       s.label ?? null,
    metadata:    s.metadata ?? null,
    observedAt:  new Date(s.observedAt),
  }));

  await db.insert(correlatedSignalsTable).values(rows);
  res.json({ ok: true, inserted: rows.length });
});

// ── GET /api/signals/raw/:token ───────────────────────────────────────────────
router.get("/signals/raw/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

  const rows = await db
    .select()
    .from(correlatedSignalsTable)
    .where(and(
      eq(correlatedSignalsTable.token, token),
      gte(correlatedSignalsTable.observedAt, from),
      lte(correlatedSignalsTable.observedAt, to),
    ))
    .orderBy(asc(correlatedSignalsTable.observedAt))
    .limit(5000);

  res.setHeader("Cache-Control", "no-store");
  res.json(rows);
});

// ── GET /api/signals/fused/:token ─────────────────────────────────────────────
router.get("/signals/fused/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const BUCKET_MIN = Number(req.query.bucket ?? 5);
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

  // Fetch GPS location_updates for this token as well — treated as high-confidence GPS signals
  const { locationUpdatesTable } = await import("@workspace/db");
  const [rawSignals, gpsUpdates] = await Promise.all([
    db.select().from(correlatedSignalsTable)
      .where(and(
        eq(correlatedSignalsTable.token, token),
        gte(correlatedSignalsTable.observedAt, from),
        lte(correlatedSignalsTable.observedAt, to),
      ))
      .orderBy(asc(correlatedSignalsTable.observedAt))
      .limit(10000),
    db.select({
      id: locationUpdatesTable.id,
      latitude: locationUpdatesTable.latitude,
      longitude: locationUpdatesTable.longitude,
      accuracy: locationUpdatesTable.accuracy,
      source: locationUpdatesTable.source,
      status: locationUpdatesTable.status,
      createdAt: locationUpdatesTable.createdAt,
    })
    .from(locationUpdatesTable)
    .where(and(
      eq(locationUpdatesTable.token, token),
      gte(locationUpdatesTable.createdAt, from),
      lte(locationUpdatesTable.createdAt, to),
    ))
    .orderBy(asc(locationUpdatesTable.createdAt))
    .limit(10000),
  ]);

  // Normalise GPS updates into the same signal shape
  interface NormSignal {
    id: string;
    sourceType: string;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    confidence: number;
    label: string | null;
    metadata: unknown;
    observedAt: Date;
    fromGpsTable: boolean;
  }

  const normGps: NormSignal[] = gpsUpdates.map((u) => ({
    id: `gps-${u.id}`,
    sourceType: u.source ?? "gps",
    latitude:   u.latitude,
    longitude:  u.longitude,
    accuracy:   u.accuracy ?? null,
    confidence: SOURCE_CONFIDENCE[u.source ?? "gps"] ?? 0.95,
    label:      u.status === "offline" ? "Device offline" : null,
    metadata:   { status: u.status },
    observedAt: u.createdAt,
    fromGpsTable: true,
  }));

  const normOther: NormSignal[] = rawSignals.map((s) => ({
    id: `cs-${s.id}`,
    sourceType: s.sourceType,
    latitude:   s.latitude ?? null,
    longitude:  s.longitude ?? null,
    accuracy:   s.accuracy ?? null,
    confidence: s.confidence,
    label:      s.label ?? null,
    metadata:   s.metadata,
    observedAt: s.observedAt,
    fromGpsTable: false,
  }));

  const allSignals: NormSignal[] = [...normGps, ...normOther].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
  );

  if (allSignals.length === 0) {
    res.json({
      fusedTimeline: [],
      sourceSummary: {},
      gaps: [],
      obscuredPeriods: [],
      totalSignals: 0,
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
    });
    return;
  }

  // ── Bucket signals ─────────────────────────────────────────────────────────
  type Bucket = {
    bucketTs: number;
    signals: NormSignal[];
  };

  const buckets = new Map<number, Bucket>();
  for (const sig of allSignals) {
    const bk = bucketFloor(sig.observedAt, BUCKET_MIN);
    if (!buckets.has(bk)) buckets.set(bk, { bucketTs: bk, signals: [] });
    buckets.get(bk)!.signals.push(sig);
  }

  // ── Fuse each bucket ───────────────────────────────────────────────────────
  interface FusedPoint {
    bucketTs: string;
    latitude: number | null;
    longitude: number | null;
    confidence: number;
    fusedFrom: string[];          // source types that contributed
    signalCount: number;
    multiSourceAgreement: boolean;
    tag: "confirmed" | "inferred" | "temporal-only";
    label: string | null;
  }

  const fusedTimeline: FusedPoint[] = [];
  const sortedBuckets = [...buckets.values()].sort((a, b) => a.bucketTs - b.bucketTs);

  for (const bk of sortedBuckets) {
    // Only consider signals that actually have coordinates
    const positioned = bk.signals.filter((s) => s.latitude != null && s.longitude != null);
    const temporal   = bk.signals.filter((s) => s.latitude == null);

    if (positioned.length === 0) {
      // Temporal-only bucket (e.g. payment with no coords yet)
      const types = [...new Set(bk.signals.map((s) => s.sourceType))];
      const maxConf = Math.max(...bk.signals.map((s) => s.confidence));
      fusedTimeline.push({
        bucketTs: new Date(bk.bucketTs).toISOString(),
        latitude: null, longitude: null,
        confidence: maxConf,
        fusedFrom: types,
        signalCount: bk.signals.length,
        multiSourceAgreement: false,
        tag: "temporal-only",
        label: temporal.map((s) => s.label).filter(Boolean).join("; ") || null,
      });
      continue;
    }

    // Sort positioned by confidence descending, pick primary
    positioned.sort((a, b) => b.confidence - a.confidence);
    const primary = positioned[0];

    // Agreement bonus: if ≥2 sources place device within 500m, boost confidence
    let agreedCount = 1;
    let agreementBonus = 0;
    for (let i = 1; i < positioned.length; i++) {
      const dist = haversineKm(primary.latitude!, primary.longitude!, positioned[i].latitude!, positioned[i].longitude!);
      if (dist < 0.5) { agreedCount++; agreementBonus = Math.min(0.05 * agreedCount, 0.15); }
    }

    const fusedConfidence = Math.min(0.99, primary.confidence + agreementBonus);
    const types = [...new Set(positioned.map((s) => s.sourceType))];

    fusedTimeline.push({
      bucketTs: new Date(bk.bucketTs).toISOString(),
      latitude:  primary.latitude,
      longitude: primary.longitude,
      confidence: fusedConfidence,
      fusedFrom: types,
      signalCount: bk.signals.length,
      multiSourceAgreement: agreedCount > 1,
      tag: fusedConfidence >= 0.6 ? "confirmed" : "inferred",
      label: primary.label,
    });
  }

  // ── Gap + obscured detection ───────────────────────────────────────────────
  interface GapRecord {
    startTime: string;
    endTime: string;
    gapMinutes: number;
    availableSources: string[];
    obscured: boolean;
    obscuredReason: string | null;
  }

  const gaps: GapRecord[] = [];
  const obscuredPeriods: GapRecord[] = [];

  for (let i = 1; i < fusedTimeline.length; i++) {
    const prev = fusedTimeline[i - 1];
    const curr = fusedTimeline[i];
    const gapMs = new Date(curr.bucketTs).getTime() - new Date(prev.bucketTs).getTime();
    const gapMin = gapMs / 60000;

    if (gapMin <= BUCKET_MIN * 1.5) continue; // expected sampling gap

    // Find any signals that fell inside this gap (non-GPS sources may have data)
    const gapStart = new Date(prev.bucketTs).getTime();
    const gapEnd   = new Date(curr.bucketTs).getTime();
    const gapSignals = allSignals.filter(
      (s) => s.observedAt.getTime() > gapStart && s.observedAt.getTime() < gapEnd,
    );
    const gapSources = [...new Set(gapSignals.map((s) => s.sourceType))];

    const prevHadGps = prev.fusedFrom.some((t) => t === "gps" || t === "fused" || t === "network");
    const gapHasNonGps = gapSources.some((t) => t !== "gps" && t !== "fused" && t !== "network");
    const obscured = isObscured(gapHasNonGps, prevHadGps, gapMin);

    const gapRecord: GapRecord = {
      startTime: new Date(gapStart).toISOString(),
      endTime:   new Date(gapEnd).toISOString(),
      gapMinutes: Math.round(gapMin),
      availableSources: gapSources,
      obscured,
      obscuredReason: obscured
        ? gapSources.includes("payment")
          ? "Payment activity detected — device was active; GPS likely disabled"
          : gapSources.includes("telematics")
          ? "Vehicle telematics active — device was in motion; GPS likely disabled"
          : gapSources.includes("bluetooth") || gapSources.includes("cellular")
          ? "Network/BT signals present — location services appear intentionally disabled"
          : null
        : null,
    };

    gaps.push(gapRecord);
    if (obscured) obscuredPeriods.push(gapRecord);
  }

  // ── Source summary ─────────────────────────────────────────────────────────
  const sourceSummary: Record<string, { count: number; withCoords: number; avgConfidence: number }> = {};
  for (const sig of allSignals) {
    if (!sourceSummary[sig.sourceType]) sourceSummary[sig.sourceType] = { count: 0, withCoords: 0, avgConfidence: 0 };
    sourceSummary[sig.sourceType].count++;
    if (sig.latitude != null) sourceSummary[sig.sourceType].withCoords++;
    sourceSummary[sig.sourceType].avgConfidence += sig.confidence;
  }
  for (const k of Object.keys(sourceSummary)) {
    sourceSummary[k].avgConfidence = Math.round((sourceSummary[k].avgConfidence / sourceSummary[k].count) * 100) / 100;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    fusedTimeline,
    sourceSummary,
    gaps,
    obscuredPeriods,
    totalSignals: allSignals.length,
    dateFrom: from.toISOString(),
    dateTo:   to.toISOString(),
  });
});

// ── GET /api/signals/estimate/:token ─────────────────────────────────────────
// Returns the best current position estimate for a token, synthesising
// live GPS, dead reckoning, and IP geolocation as available.
router.get("/signals/estimate/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  // Resolve session token → invite token so either form of token works
  const [maybeSession] = await db
    .select({ inviteToken: inviteSessionsTable.inviteToken })
    .from(inviteSessionsTable)
    .where(eq(inviteSessionsTable.sessionToken, token))
    .limit(1);

  const lookupToken = maybeSession?.inviteToken ?? token;

  const { estimatePosition } = await import("../lib/position-estimator.js");
  const estimate = await estimatePosition(lookupToken);

  if (!estimate) {
    res.status(404).json({ error: "No location data for this token" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(estimate);
});

export default router;
