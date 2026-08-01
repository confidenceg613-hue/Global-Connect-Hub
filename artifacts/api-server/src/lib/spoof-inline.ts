/**
 * Inline spoof detection — runs at every location push, synchronously against
 * the new point + last 50 stored points.  Designed to be fast (<5ms typical)
 * so it never delays the 200 OK response.
 *
 * Returns a 0-100 risk score and an array of fired flag names.
 */

export interface InlineResult {
  score: number;
  flags: string[];
}

interface RecentPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: string | null;
  activityType: string | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  deviceInfo: Record<string, unknown> | null;
  createdAt: Date;
}

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371;
  const dL = ((la2 - la1) * Math.PI) / 180;
  const dO = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dL / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) *
      Math.cos((la2 * Math.PI) / 180) *
      Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const EMULATOR_GPU_STRINGS = [
  "llvmpipe", "mesa", "softpipe", "virgl", "swiftshader", "angle (swiftshader",
];

const DATACENTER_ORG_HINTS = [
  "amazon", "aws", "digitalocean", "linode", "vultr", "ovh", "hetzner",
  "azure", "googlecloud", "google cloud", "cloudflare", "fastly", "akamai",
  "choopa", "psychz", "colocationamerica", "quadranet", "serverius",
  "nexeon", "wholesale internet", "performive",
];

/**
 * Score a single incoming location point against its recent history.
 *
 * @param newPt   The incoming push payload (not yet inserted).
 * @param recent  Last ≤50 stored points for this token, newest-last.
 */
export function scoreInline(
  newPt: RecentPoint,
  recent: RecentPoint[],
): InlineResult {
  const flags: string[] = [];
  let score = 0;

  const prev = recent.length > 0 ? recent[recent.length - 1] : null;

  // ── 1. Impossible / implausible speed ────────────────────────────────────
  if (prev) {
    const dtHours = (newPt.createdAt.getTime() - prev.createdAt.getTime()) / 3_600_000;
    if (dtHours > 0) {
      const km = haversineKm(prev.latitude, prev.longitude, newPt.latitude, newPt.longitude);
      const kmh = km / dtHours;
      if (kmh > 900) {
        flags.push("impossible_speed");
        score += 40;
      } else if (kmh > 400) {
        flags.push("implausible_speed");
        score += 25;
      }
    }
  }

  // ── 2. Emulator GPU fingerprint ──────────────────────────────────────────
  const di = newPt.deviceInfo;
  if (di) {
    const gpu = String(di.gpuRenderer ?? "").toLowerCase();
    if (EMULATOR_GPU_STRINGS.some((e) => gpu.includes(e))) {
      flags.push("emulator_gpu");
      score += 38;
    }

    // Datacenter / VPN IP hints from the enriched network blob
    const net = (di.network ?? di.ipInfo) as Record<string, unknown> | undefined;
    if (net) {
      // Explicit proxy / hosting flags from an IP-intelligence lookup
      if (net.proxy === true) { flags.push("vpn_proxy"); score += 22; }
      if (net.hosting === true) { flags.push("datacenter_hosting"); score += 20; }

      // ISP / org name matching known datacenters
      const orgStr = String(net.isp ?? net.org ?? "").toLowerCase();
      if (orgStr && DATACENTER_ORG_HINTS.some((d) => orgStr.includes(d))) {
        if (!flags.includes("datacenter_hosting")) {
          flags.push("datacenter_org");
          score += 18;
        }
      }
    }

    // ── 3. Zero reported speed but device is moving ──────────────────────
    if (typeof di.speed === "number" && di.speed < 0.5 && prev) {
      const dtHours = (newPt.createdAt.getTime() - prev.createdAt.getTime()) / 3_600_000;
      if (dtHours > 0 && dtHours < 0.1) {
        const km = haversineKm(prev.latitude, prev.longitude, newPt.latitude, newPt.longitude);
        if (km / dtHours > 5) {
          flags.push("zero_speed_with_motion");
          score += 17;
        }
      }
    }
  }

  // ── 4. Activity type contradicts movement speed ───────────────────────
  if (prev && newPt.activityType) {
    const dtHours = (newPt.createdAt.getTime() - prev.createdAt.getTime()) / 3_600_000;
    if (dtHours > 0 && dtHours < 0.5) {
      const km = haversineKm(prev.latitude, prev.longitude, newPt.latitude, newPt.longitude);
      const kmh = km / dtHours;
      const at = newPt.activityType;
      if (
        (at === "stationary" && kmh > 10) ||
        (at === "walking" && kmh > 15) ||
        (at === "running" && kmh > 40)
      ) {
        flags.push("activity_mismatch");
        score += 12;
      }
    }
  }

  // ── 5. Signal jamming: sudden large accuracy spike ────────────────────
  //    Real GPS degrades gradually; a >10× jump in a single step and an
  //    absolute accuracy >500 m is characteristic of jamming or spoofed
  //    signal injection forcing a fallback to cell-tower positioning.
  if (
    prev &&
    newPt.accuracy != null &&
    prev.accuracy != null &&
    prev.accuracy > 0
  ) {
    const ratio = newPt.accuracy / prev.accuracy;
    if (newPt.accuracy > 500 && ratio > 10) {
      flags.push("jamming_accuracy_spike");
      score += 16;
    } else if (newPt.accuracy > 1000 && ratio > 5) {
      flags.push("jamming_accuracy_spike");
      score += 16;
    }
  }
  // Also: GPS→network source drop with huge accuracy fallback
  if (
    prev &&
    prev.source === "gps" &&
    newPt.source === "network" &&
    newPt.accuracy != null &&
    newPt.accuracy > 300
  ) {
    if (!flags.includes("jamming_accuracy_spike")) {
      flags.push("gps_to_network_fallback");
      score += 10;
    }
  }

  // ── 6. Source flapping (recent window) ───────────────────────────────
  if (recent.length >= 5) {
    const window = recent.slice(-5).map((p) => p.source).concat(newPt.source);
    let flaps = 0;
    for (let i = 2; i < window.length; i++) {
      if (window[i] !== window[i - 1] && window[i] === window[i - 2]) flaps++;
    }
    if (flaps >= 2) {
      flags.push("source_flapping");
      score += 8;
    }
  }

  // ── 7. Battery jump without charging ────────────────────────────────
  if (
    prev &&
    newPt.batteryLevel != null &&
    prev.batteryLevel != null &&
    !newPt.batteryCharging &&
    !prev.batteryCharging
  ) {
    if (newPt.batteryLevel - prev.batteryLevel > 5) {
      flags.push("battery_jump");
      score += 6;
    }
  }

  // ── 8. Machine-regular intervals (scripted playback) ─────────────────
  if (recent.length >= 12) {
    const times = recent.slice(-12).map((p) => p.createdAt.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const gapMean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const gapStd = Math.sqrt(gaps.reduce((s, v) => s + (v - gapMean) ** 2, 0) / gaps.length);
    const cv = gapStd / (gapMean || 1);
    if (cv < 0.02 && gapMean < 15_000) {
      flags.push("scripted_interval");
      score += 18;
    }
  }

  // ── 9. Suspiciously perfect accuracy ────────────────────────────────
  //    Sub-1m accuracy on a single point is a strong mock-GPS indicator.
  if (newPt.accuracy != null && newPt.accuracy < 1 && newPt.accuracy > 0) {
    flags.push("perfect_accuracy");
    score += 14;
  }

  return { score: Math.min(100, score), flags: [...new Set(flags)] };
}
