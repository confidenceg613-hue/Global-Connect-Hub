/**
 * Spoof Detection — identifies deliberate deception in location streams.
 *
 * Runs 11 independent forensic detectors against the raw location_updates
 * history for a token and returns a composite risk score with per-finding
 * evidence.
 *
 * GET /api/signals/spoof-analysis/:token?from=ISO&to=ISO
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { db, locationUpdatesTable } from "@workspace/db";

const router: IRouter = Router();

// ── types ────────────────────────────────────────────────────────────────────

interface RawPoint {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: string | null;
  status: string;
  activityType: string | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  deviceInfo: Record<string, unknown> | null;
  createdAt: Date;
}

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface SpoofFinding {
  detector:    string;
  severity:    FindingSeverity;
  score:       number;            // contribution to total risk (0-40)
  title:       string;
  description: string;
  evidence:    Record<string, unknown>;
  pointIds:    number[];          // which location update IDs triggered this
}

// ── helpers ──────────────────────────────────────────────────────────────────

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371;
  const dL = ((la2 - la1) * Math.PI) / 180;
  const dO = ((lo2 - lo1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function std(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}

function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

/**
 * Cross-product z-component for three points — measures collinearity.
 * Zero = perfectly collinear.
 */
function crossZ(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Known emulator GPU strings
const EMULATOR_GPU = ["llvmpipe", "mesa", "softpipe", "virgl", "swiftshader", "angle (swiftshader"]
  .map((s) => s.toLowerCase());

// Known VPN / datacenter ASN markers in userAgent / deviceInfo
const DATACENTER_HINTS = [
  "aws", "amazon", "digitalocean", "linode", "vultr", "ovh", "hetzner",
  "azure", "googlecloud", "google cloud", "cloudflare", "fastly", "akamai",
  "choopa", "psychz", "quadranet", "nexeon", "wholesale internet",
];

// ── detectors ────────────────────────────────────────────────────────────────

function detectImpossibleSpeed(pts: RawPoint[]): SpoofFinding[] {
  const findings: SpoofFinding[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dt = (b.createdAt.getTime() - a.createdAt.getTime()) / 3600000; // hours
    if (dt <= 0) continue;
    const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const kmh = km / dt;
    if (kmh > 900) {
      findings.push({
        detector: "impossible_speed",
        severity: "critical",
        score: 40,
        title: "Physically impossible speed",
        description: `${Math.round(kmh).toLocaleString()} km/h between two consecutive points — faster than any surface vehicle or subsonic aircraft.`,
        evidence: { speedKmh: Math.round(kmh), distanceKm: Math.round(km * 10) / 10, deltaMinutes: Math.round(dt * 60) },
        pointIds: [a.id, b.id],
      });
    } else if (kmh > 400) {
      findings.push({
        detector: "impossible_speed",
        severity: "high",
        score: 25,
        title: "Implausible ground speed",
        description: `${Math.round(kmh).toLocaleString()} km/h between consecutive points — faster than any ground vehicle; suggests GPS teleportation.`,
        evidence: { speedKmh: Math.round(kmh), distanceKm: Math.round(km * 10) / 10, deltaMinutes: Math.round(dt * 60) },
        pointIds: [a.id, b.id],
      });
    }
  }
  return findings;
}

function detectAccuracyLock(pts: RawPoint[]): SpoofFinding[] {
  const findings: SpoofFinding[] = [];
  const accVals = pts.filter((p) => p.accuracy != null).map((p) => p.accuracy!);
  if (accVals.length < 10) return [];

  const sd = std(accVals);
  const avg = mean(accVals);

  if (sd < 0.5 && avg < 20) {
    findings.push({
      detector: "accuracy_lock",
      severity: "high",
      score: 28,
      title: "Accuracy value frozen — mock GPS signature",
      description: `GPS accuracy reported as ${avg.toFixed(1)}m ±${sd.toFixed(2)}m across ${accVals.length} readings. Real GPS accuracy fluctuates continuously with multipath, satellite geometry and atmospheric conditions. A locked value is characteristic of software-emulated location providers.`,
      evidence: { meanAccuracyM: Math.round(avg * 10) / 10, stdDevM: Math.round(sd * 100) / 100, sampleCount: accVals.length },
      pointIds: pts.filter((p) => p.accuracy != null).map((p) => p.id),
    });
  } else if (avg < 2) {
    // Suspiciously perfect accuracy
    const sub2count = accVals.filter((a) => a < 2).length;
    if (sub2count / accVals.length > 0.8) {
      findings.push({
        detector: "perfect_accuracy",
        severity: "medium",
        score: 18,
        title: "Suspiciously perfect GPS accuracy",
        description: `${Math.round((sub2count / accVals.length) * 100)}% of readings report <2m accuracy. Consumer GPS chips — even high-end — rarely sustain sub-2m in real-world conditions; sustained perfection indicates a simulated provider.`,
        evidence: { pctBelow2m: Math.round((sub2count / accVals.length) * 100), sampleCount: accVals.length },
        pointIds: pts.filter((p) => (p.accuracy ?? 999) < 2).slice(0, 20).map((p) => p.id),
      });
    }
  }
  return findings;
}

function detectActivityMismatch(pts: RawPoint[]): SpoofFinding[] {
  const findings: SpoofFinding[] = [];
  const mismatches: number[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (!b.activityType) continue;
    const dt = (b.createdAt.getTime() - a.createdAt.getTime()) / 3600000;
    if (dt <= 0 || dt > 0.5) continue; // only for short intervals
    const km  = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const kmh = km / dt;

    const stationary = b.activityType === "stationary";
    if (stationary && kmh > 10) mismatches.push(b.id);
    if (!stationary && b.activityType === "walking" && kmh > 15) mismatches.push(b.id);
    if (!stationary && b.activityType === "running" && kmh > 40) mismatches.push(b.id);
  }

  if (mismatches.length > 3) {
    findings.push({
      detector: "activity_mismatch",
      severity: "medium",
      score: 20,
      title: "Activity type contradicts movement speed",
      description: `${mismatches.length} points where the reported activity type (stationary / walking / running) is inconsistent with the actual movement speed derived from coordinate deltas. Spoofed routes overlaid on a real device activity classifier produce this pattern.`,
      evidence: { mismatchCount: mismatches.length },
      pointIds: mismatches.slice(0, 10),
    });
  }
  return findings;
}

function detectTimestampRegularity(pts: RawPoint[]): SpoofFinding[] {
  if (pts.length < 20) return [];
  const gaps = [];
  for (let i = 1; i < pts.length; i++) {
    gaps.push(pts[i].createdAt.getTime() - pts[i - 1].createdAt.getTime());
  }
  const gapStd  = std(gaps);
  const gapMean = mean(gaps);
  const cv      = gapStd / (gapMean || 1); // coefficient of variation

  if (cv < 0.02 && gapMean < 15000) {
    return [{
      detector: "timestamp_regularity",
      severity: "high",
      score: 22,
      title: "Machine-regular update intervals — scripted playback",
      description: `Updates arrive every ${(gapMean / 1000).toFixed(2)}s ±${(gapStd / 1000).toFixed(3)}s (CV=${(cv * 100).toFixed(2)}%). Human-operated GPS produces irregular intervals due to network jitter, battery optimisation and sleep cycles. This regularity is characteristic of a route-replay script or location automation tool.`,
      evidence: { meanIntervalMs: Math.round(gapMean), stdIntervalMs: Math.round(gapStd), cvPct: Math.round(cv * 10000) / 100, sampleCount: gaps.length },
      pointIds: pts.slice(0, 5).map((p) => p.id),
    }];
  }
  return [];
}

function detectPathCollinearity(pts: RawPoint[]): SpoofFinding[] {
  if (pts.length < 5) return [];
  const collinearRuns: number[][] = [];
  let run: number[] = [pts[0].id, pts[1].id];

  for (let i = 2; i < pts.length; i++) {
    const a = pts[i - 2], b = pts[i - 1], c = pts[i];
    const z = crossZ(a.longitude, a.latitude, b.longitude, b.latitude, c.longitude, c.latitude);
    // Normalise by approximate distance to make threshold scale-invariant
    const dAB = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const norm = dAB > 0.001 ? Math.abs(z) / (dAB * dAB) : Math.abs(z);
    if (norm < 1e-6) {
      run.push(c.id);
    } else {
      if (run.length >= 8) collinearRuns.push([...run]);
      run = [b.id, c.id];
    }
  }
  if (run.length >= 8) collinearRuns.push(run);

  if (collinearRuns.length === 0) return [];

  const longestRun = collinearRuns.reduce((best, r) => r.length > best.length ? r : best, []);
  return [{
    detector: "path_collinearity",
    severity: "medium",
    score: 15,
    title: "Unnaturally straight path segments — simulated route",
    description: `${collinearRuns.length} perfectly collinear run${collinearRuns.length > 1 ? "s" : ""} detected (longest: ${longestRun.length} consecutive points). Real pedestrian and vehicle paths have natural curvature and GPS micro-jitter. Dead-straight segments at macroscopic scale are characteristic of route-simulation tools interpolating along a straight line.`,
    evidence: { collinearRunCount: collinearRuns.length, longestRunPoints: longestRun.length },
    pointIds: longestRun.slice(0, 10),
  }];
}

function detectAltitudeFreeze(pts: RawPoint[]): SpoofFinding[] {
  const alts: number[] = pts
    .map((p) => {
      const di = p.deviceInfo as Record<string, unknown> | null;
      return typeof di?.altitude === "number" ? di.altitude as number : null;
    })
    .filter((a): a is number => a !== null);

  if (alts.length < 10) return [];
  const sd  = std(alts);
  const avg = mean(alts);

  if (sd < 0.1) {
    return [{
      detector: "altitude_freeze",
      severity: "medium",
      score: 18,
      title: "Altitude perfectly constant — GPS simulation",
      description: `Barometric/GPS altitude is ${avg.toFixed(1)}m ±${sd.toFixed(2)}m across ${alts.length} readings. Real-world altitude readings fluctuate by several metres even when stationary, due to atmospheric pressure changes and satellite geometry drift. A frozen altitude is a strong indicator of a software location provider that does not simulate altimetry.`,
      evidence: { meanAltitudeM: Math.round(avg * 10) / 10, stdDevM: Math.round(sd * 100) / 100, sampleCount: alts.length },
      pointIds: pts.slice(0, 5).map((p) => p.id),
    }];
  }
  return [];
}

function detectHeadingMismatch(pts: RawPoint[]): SpoofFinding[] {
  if (pts.length < 5) return [];
  const mismatches: number[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const di = b.deviceInfo as Record<string, unknown> | null;
    if (typeof di?.heading !== "number") continue;
    const reportedHeading = di.heading as number;
    if (reportedHeading < 0) continue; // negative = invalid

    // Compute bearing from coordinate delta
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const lat1  = (a.latitude  * Math.PI) / 180;
    const lat2  = (b.latitude  * Math.PI) / 180;
    const y     = Math.sin(dLng) * Math.cos(lat2);
    const x     = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    let bearing  = (Math.atan2(y, x) * 180) / Math.PI;
    bearing = (bearing + 360) % 360;

    const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    if (km < 0.01) continue; // too short to compute reliable bearing

    const diff = Math.abs(((reportedHeading - bearing + 540) % 360) - 180);
    if (diff > 60) mismatches.push(b.id);
  }

  if (mismatches.length > 5) {
    return [{
      detector: "heading_mismatch",
      severity: "medium",
      score: 16,
      title: "Device heading inconsistent with direction of travel",
      description: `${mismatches.length} points where the reported compass heading diverges >60° from the bearing derived from coordinate deltas. Mock location providers often generate heading values independently from actual path direction, producing this forensic signature.`,
      evidence: { mismatchCount: mismatches.length },
      pointIds: mismatches.slice(0, 10),
    }];
  }
  return [];
}

function detectEmulatorFingerprint(pts: RawPoint[]): SpoofFinding[] {
  const findings: SpoofFinding[] = [];

  for (const pt of pts) {
    const di = pt.deviceInfo as Record<string, unknown> | null;
    if (!di) continue;

    const gpuRenderer = String(di.gpuRenderer ?? "").toLowerCase();
    const userAgent   = String(di.userAgent ?? "").toLowerCase();
    const cpuCores    = typeof di.cpuCores === "number" ? di.cpuCores : null;
    const memGb       = typeof di.deviceMemoryGb === "number" ? di.deviceMemoryGb : null;

    const gpuHit   = EMULATOR_GPU.some((e) => gpuRenderer.includes(e));
    const uaHit    = userAgent.includes("x11") && (userAgent.includes("linux x86_64") || userAgent.includes("linux armv"));
    const weakHw   = cpuCores !== null && cpuCores <= 2 && memGb !== null && memGb <= 1;

    if (gpuHit || (uaHit && weakHw)) {
      findings.push({
        detector: "emulator_fingerprint",
        severity: "critical",
        score: 38,
        title: "Emulator / virtual device fingerprint",
        description: gpuHit
          ? `GPU renderer "${di.gpuRenderer}" matches known software-rasteriser strings used by Android emulators (AVD/Genymotion/Bluestacks) and iOS Simulator. Physical devices always report hardware GPU vendors (Qualcomm Adreno, ARM Mali, Apple GPU).`
          : `Combination of Linux x86_64 user-agent, ${cpuCores} CPU core${cpuCores !== 1 ? "s" : ""} and ${memGb}GB reported memory is consistent with an Android Studio Virtual Device. Physical mobile devices ship with ≥4 cores and ≥2GB RAM.`,
        evidence: { gpuRenderer: di.gpuRenderer, userAgent: di.userAgent, cpuCores, deviceMemoryGb: memGb },
        pointIds: [pt.id],
      });
      break; // one emulator finding is enough
    }
  }
  return findings;
}

function detectSourceFlapping(pts: RawPoint[]): SpoofFinding[] {
  if (pts.length < 10) return [];
  let flaps = 0;
  for (let i = 2; i < pts.length; i++) {
    if (pts[i].source !== pts[i - 1].source && pts[i].source === pts[i - 2].source) flaps++;
  }
  const flapRate = flaps / pts.length;
  if (flapRate > 0.3 && flaps > 10) {
    return [{
      detector: "source_flapping",
      severity: "low",
      score: 10,
      title: "Rapid GPS/network source toggling",
      description: `Location source (gps ↔ network ↔ fused) toggled back and forth ${flaps} times (${Math.round(flapRate * 100)}% of updates). Real devices settle into a dominant source; rapid toggling suggests a software layer intercepting and re-tagging the source field.`,
      evidence: { flapCount: flaps, flapRatePct: Math.round(flapRate * 100) },
      pointIds: pts.slice(0, 3).map((p) => p.id),
    }];
  }
  return [];
}

function detectBatteryAnomaly(pts: RawPoint[]): SpoofFinding[] {
  const batt = pts.filter((p) => p.batteryLevel !== null).map((p) => p.batteryLevel!);
  if (batt.length < 5) return [];

  // Battery should monotonically decrease (or stay constant if charging).
  // Check for unexplained jumps upward > 5% without a charging transition.
  let suspiciousJumps = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.batteryLevel === null || b.batteryLevel === null) continue;
    const delta = b.batteryLevel - a.batteryLevel;
    if (delta > 5 && !b.batteryCharging && !a.batteryCharging) suspiciousJumps++;
  }

  if (suspiciousJumps > 2) {
    return [{
      detector: "battery_anomaly",
      severity: "low",
      score: 8,
      title: "Battery level inconsistency — device may have changed",
      description: `${suspiciousJumps} unexplained battery level increases (>5%) without a charging event. This pattern arises when location data from multiple devices (or device restarts with spoofed battery) is merged into a single stream, or when a battery value is being fabricated.`,
      evidence: { suspiciousJumps },
      pointIds: pts.filter((_, i) => {
        if (i === 0) return false;
        const a = pts[i - 1], b = pts[i];
        return (b.batteryLevel ?? 0) - (a.batteryLevel ?? 0) > 5 && !b.batteryCharging && !a.batteryCharging;
      }).slice(0, 5).map((p) => p.id),
    }];
  }
  return [];
}

function detectSignalJamming(pts: RawPoint[]): SpoofFinding[] {
  if (pts.length < 3) return [];
  const jamEvents: number[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.accuracy == null || b.accuracy == null || a.accuracy <= 0) continue;
    const ratio = b.accuracy / a.accuracy;
    // >10x accuracy spike into >500m territory = jammer signature
    if (b.accuracy > 500 && ratio > 10) jamEvents.push(b.id);
    // GPS→network source drop with massive accuracy fallback
    else if (a.source === "gps" && b.source === "network" && b.accuracy > 300) jamEvents.push(b.id);
  }

  if (jamEvents.length === 0) return [];

  return [{
    detector: "signal_jamming",
    severity: jamEvents.length >= 3 ? "high" : "medium",
    score: jamEvents.length >= 3 ? 26 : 16,
    title: "GPS signal disruption — possible jamming",
    description: `${jamEvents.length} sudden accuracy collapse${jamEvents.length > 1 ? "s" : ""} detected: GPS accuracy degraded by >10× in a single step or the device fell back from GPS to cell-tower positioning with >300m accuracy. Intentional GPS jamming forces consumer receivers to fall back to network/AGPS, producing this abrupt degradation pattern.`,
    evidence: { jamEventCount: jamEvents.length },
    pointIds: jamEvents.slice(0, 10),
  }];
}

function detectIPDatacenter(pts: RawPoint[]): SpoofFinding[] {
  for (const pt of pts) {
    const di = pt.deviceInfo as Record<string, unknown> | null;
    if (!di) continue;

    // The network blob is enriched server-side with the real public IP and
    // optionally with an IP-intelligence lookup (proxy / hosting flags, ISP).
    const net = (di.network ?? di.ipInfo) as Record<string, unknown> | undefined;
    if (!net) continue;

    const isProxy = net.proxy === true;
    const isHosting = net.hosting === true;
    const orgStr = String(net.isp ?? net.org ?? "").toLowerCase();
    const orgHit = orgStr && DATACENTER_HINTS.some((d) => orgStr.includes(d)) ? orgStr : null;

    if (isProxy || isHosting || orgHit) {
      const reasons: string[] = [];
      if (isProxy) reasons.push("IP flagged as VPN/proxy by IP intelligence");
      if (isHosting) reasons.push("IP belongs to a hosting/datacenter range");
      if (orgHit && !isHosting) reasons.push(`ISP/org "${orgStr.slice(0, 60)}" matches known datacenter operator`);

      return [{
        detector: "ip_datacenter",
        severity: isProxy ? "high" : "medium",
        score: isProxy ? 28 : 18,
        title: isProxy ? "VPN / proxy detected" : "Datacenter IP — not a real mobile device",
        description: `${reasons.join("; ")}. Genuine mobile GPS sharing originates from ISP consumer networks. Traffic routed through a datacenter or VPN strongly suggests the location is being proxied or fabricated on a remote server.`,
        evidence: { proxy: isProxy, hosting: isHosting, org: orgStr.slice(0, 80), ip: net.publicIp ?? null },
        pointIds: [pt.id],
      }];
    }
  }
  return [];
}

function detectZeroSpeedWithMotion(pts: RawPoint[]): SpoofFinding[] {
  // If deviceInfo.speed is 0 but coordinate delta implies motion > 5 km/h → spoofed speed field
  const hits: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const di = b.deviceInfo as Record<string, unknown> | null;
    if (typeof di?.speed !== "number") continue;
    const reportedSpeed = di.speed as number; // m/s
    if (reportedSpeed > 0.5) continue; // not claiming zero
    const dt = (b.createdAt.getTime() - a.createdAt.getTime()) / 3600000;
    if (dt <= 0 || dt > 0.1) continue;
    const km  = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const kmh = km / dt;
    if (kmh > 5) hits.push(b.id);
  }
  if (hits.length > 3) {
    return [{
      detector: "zero_speed_with_motion",
      severity: "medium",
      score: 17,
      title: "Reported speed zero but device is moving",
      description: `${hits.length} points where the device reported 0 m/s speed while coordinate deltas imply >${5} km/h movement. A genuine GPS provider integrates speed from the Doppler shift of satellite signals and matches displacement; a mocked provider forgets to update the speed field.`,
      evidence: { hitCount: hits.length },
      pointIds: hits.slice(0, 10),
    }];
  }
  return [];
}

// ── scoring ───────────────────────────────────────────────────────────────────

const SEVERITY_SCORE: Record<FindingSeverity, number> = {
  critical: 40,
  high:     25,
  medium:   15,
  low:       5,
  info:      0,
};

function riskLabel(score: number): { label: string; color: string } {
  if (score <= 10) return { label: "Clean",           color: "#10b981" };
  if (score <= 25) return { label: "Low risk",        color: "#84cc16" };
  if (score <= 45) return { label: "Suspicious",      color: "#f59e0b" };
  if (score <= 65) return { label: "Likely spoofed",  color: "#f97316" };
  return               { label: "Confirmed spoof",   color: "#ef4444" };
}

// ── route ────────────────────────────────────────────────────────────────────

router.get("/signals/spoof-analysis/:token", async (req: Request, res: Response): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid from/to" });
    return;
  }

  const raw = await db
    .select({
      id:           locationUpdatesTable.id,
      latitude:     locationUpdatesTable.latitude,
      longitude:    locationUpdatesTable.longitude,
      accuracy:     locationUpdatesTable.accuracy,
      source:       locationUpdatesTable.source,
      status:       locationUpdatesTable.status,
      activityType: locationUpdatesTable.activityType,
      batteryLevel: locationUpdatesTable.batteryLevel,
      batteryCharging: locationUpdatesTable.batteryCharging,
      deviceInfo:   locationUpdatesTable.deviceInfo,
      createdAt:    locationUpdatesTable.createdAt,
    })
    .from(locationUpdatesTable)
    .where(and(
      eq(locationUpdatesTable.token, token),
      gte(locationUpdatesTable.createdAt, from),
      lte(locationUpdatesTable.createdAt, to),
    ))
    .orderBy(asc(locationUpdatesTable.createdAt))
    .limit(8000);

  if (raw.length === 0) {
    res.json({
      riskScore: 0, riskLabel: "Clean", riskColor: "#10b981",
      findings: [], totalPoints: 0,
      dateFrom: from.toISOString(), dateTo: to.toISOString(),
    });
    return;
  }

  const pts = raw as RawPoint[];

  // ── Multi-device coordination: same exact coords from multiple tokens in a short window ──
  // Query independently — only possible here where we have DB access.
  const multiDeviceFindings: SpoofFinding[] = await (async () => {
    if (pts.length < 5) return [];
    // Sample up to 50 points and look for other tokens that reported the exact
    // same (lat, lon) pair within ±30 seconds.  One coincidence is noise;
    // three or more is a coordinated replay.
    const { ne } = await import("drizzle-orm");
    const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 50)) === 0).slice(0, 50);
    let matchCount = 0;
    const matchingTokens = new Set<string>();
    for (const pt of sample) {
      const windowStart = new Date(pt.createdAt.getTime() - 30_000);
      const windowEnd   = new Date(pt.createdAt.getTime() + 30_000);
      const dups = await db
        .select({ token: locationUpdatesTable.token })
        .from(locationUpdatesTable)
        .where(and(
          ne(locationUpdatesTable.token, token),
          eq(locationUpdatesTable.latitude,  pt.latitude),
          eq(locationUpdatesTable.longitude, pt.longitude),
          gte(locationUpdatesTable.createdAt, windowStart),
          lte(locationUpdatesTable.createdAt, windowEnd),
        ))
        .limit(5);
      if (dups.length > 0) {
        matchCount++;
        for (const d of dups) matchingTokens.add(d.token);
      }
    }
    if (matchCount >= 3) {
      return [{
        detector: "multi_device_coordination",
        severity: "critical" as const,
        score: 40,
        title: "Coordinated multi-device spoofing detected",
        description: `${matchCount} location points from this token were also reported by ${matchingTokens.size} other share link(s) within ±30 seconds with identical coordinates. Identical coordinates across independent devices is physically impossible and indicates a shared spoofed location source (e.g. a GPS spoofer broadcasting to multiple devices simultaneously).`,
        evidence: { matchingPointCount: matchCount, matchingTokenCount: matchingTokens.size },
        pointIds: pts.slice(0, 5).map((p) => p.id),
      }];
    }
    return [];
  })();

  // Run all detectors
  const allFindings: SpoofFinding[] = [
    ...detectImpossibleSpeed(pts),
    ...detectAccuracyLock(pts),
    ...detectActivityMismatch(pts),
    ...detectTimestampRegularity(pts),
    ...detectPathCollinearity(pts),
    ...detectAltitudeFreeze(pts),
    ...detectHeadingMismatch(pts),
    ...detectEmulatorFingerprint(pts),
    ...detectSourceFlapping(pts),
    ...detectBatteryAnomaly(pts),
    ...detectZeroSpeedWithMotion(pts),
    ...detectSignalJamming(pts),
    ...detectIPDatacenter(pts),
    ...multiDeviceFindings,
  ];

  // De-duplicate by detector (keep highest-score finding per detector type)
  const byDetector = new Map<string, SpoofFinding>();
  for (const f of allFindings) {
    const ex = byDetector.get(f.detector);
    if (!ex || f.score > ex.score) byDetector.set(f.detector, f);
  }
  const deduplicated = [...byDetector.values()].sort((a, b) => b.score - a.score);

  // Score: sum of finding scores, capped at 100.
  // Use a diminishing-returns formula so piling on low-severity findings
  // doesn't saturate the gauge if there's no critical evidence.
  let rawScore = 0;
  for (const f of deduplicated) rawScore += f.score;
  const riskScore = Math.min(100, rawScore);

  const { label, color } = riskLabel(riskScore);

  // Daily breakdown for sparkline
  const dailyCounts: Record<string, number> = {};
  for (const pt of pts) {
    const day = pt.createdAt.toISOString().slice(0, 10);
    dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
  }

  // Source distribution
  const sourceDist: Record<string, number> = {};
  for (const pt of pts) {
    const s = pt.source ?? "unknown";
    sourceDist[s] = (sourceDist[s] ?? 0) + 1;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    riskScore,
    riskLabel: label,
    riskColor: color,
    findings: deduplicated,
    totalPoints: pts.length,
    dailyCounts,
    sourceDist,
    dateFrom: from.toISOString(),
    dateTo:   to.toISOString(),
  });
});

export default router;
