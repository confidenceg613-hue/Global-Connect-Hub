/**
 * Behavioral Signatures
 *
 * Detects habitual routes, dwell zones, meeting patterns, speed/direction
 * anomalies, evasion indicators, and anticipates likely future locations
 * from existing location history data — all computed client-side.
 */
import { useAuth } from "@/hooks/use-auth";
import { useListInvites } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Brain, User, AlertTriangle, Clock, MapPin, TrendingUp,
  Shield, Zap, Eye, Navigation, ChevronDown, RefreshCw,
  Target, Activity, Radio, Info, BarChart3, Route, FileDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Raw types from movement-patterns API ────────────────────────────────────

interface RawPoint {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: "active" | "offline";
  activityType: string | null;
  createdAt: string;
}

interface RealSegment {
  type: "real";
  points: RawPoint[];
  distanceKm: number;
  durationMinutes: number;
  startTime: string;
  endTime: string;
}

interface GapSegment {
  type: "gap";
  gapMinutes: number;
  distanceKm: number;
  severity: "minor" | "moderate" | "significant" | "major";
  startTime: string;
  endTime: string;
}

type Segment = RealSegment | GapSegment;

interface MovementResult {
  segments: Segment[];
  dailyCounts: Record<string, number>;
  summary: {
    totalPoints: number;
    totalRealKm: number;
    activeDays: number;
    totalGaps: number;
    longestGapMinutes: number;
    dateFrom: string;
    dateTo: string;
  };
}

// ── Derived behavioral types ─────────────────────────────────────────────────

interface DwellZone {
  lat: number;
  lng: number;
  radiusM: number;
  totalMinutes: number;
  visitCount: number;
  label: string;
  lastSeen: string;
  hourHistogram: number[]; // 24 bins
}

interface HabitualCorridor {
  id: string;
  points: Array<[number, number]>;
  dayCount: number;       // how many different days this corridor was used
  avgSpeedKph: number;
  label: string;
  commonDays: string[];   // e.g. "Mon", "Wed"
}

interface SpeedAnomaly {
  lat: number;
  lng: number;
  speedKph: number;
  expectedKph: number;
  ts: string;
  kind: "spike" | "crawl" | "reversal";
  description: string;
}

interface TemporalPattern {
  hour: number;          // 0-23
  dayOfWeek: number;     // 0=Sun
  count: number;
  hotness: number;       // 0-1
}

interface PredictedLocation {
  lat: number;
  lng: number;
  confidence: number;   // 0-1
  likelyTime: string;   // e.g. "Tue ~08:00"
  reasoning: string;
  address?: string;
}

interface EvasionIndicator {
  score: number;       // 0-100
  level: "nominal" | "elevated" | "high" | "critical";
  signals: Array<{ label: string; weight: number; description: string }>;
}

// ── Haversine distance ────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function speedKph(p1: RawPoint, p2: RawPoint): number {
  const distM = haversineM(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
  const dtMs = Math.abs(new Date(p2.createdAt).getTime() - new Date(p1.createdAt).getTime());
  if (dtMs === 0) return 0;
  return (distM / (dtMs / 3_600_000)) / 1000;
}

// ── Analysis engine ───────────────────────────────────────────────────────────

function analyzePoints(allPoints: RawPoint[], gaps: GapSegment[]): {
  dwellZones: DwellZone[];
  corridors: HabitualCorridor[];
  anomalies: SpeedAnomaly[];
  temporalGrid: TemporalPattern[];
  predictions: PredictedLocation[];
  evasion: EvasionIndicator;
} {
  if (allPoints.length < 3) {
    return {
      dwellZones: [],
      corridors: [],
      anomalies: [],
      temporalGrid: [],
      predictions: [],
      evasion: { score: 0, level: "nominal", signals: [] },
    };
  }

  // ── 1. Dwell zone detection ─────────────────────────────────────────────
  // Cluster points that stay within 120m for >4 minutes
  const DWELL_RADIUS_M = 120;
  const DWELL_MIN_MIN = 4;

  const clusters: Array<{
    points: RawPoint[];
    centLat: number;
    centLng: number;
    visits: number;
    hourBins: number[];
  }> = [];

  for (const pt of allPoints) {
    let absorbed = false;
    for (const cl of clusters) {
      if (haversineM(pt.latitude, pt.longitude, cl.centLat, cl.centLng) < DWELL_RADIUS_M) {
        cl.points.push(pt);
        cl.centLat = cl.points.reduce((s, p) => s + p.latitude, 0) / cl.points.length;
        cl.centLng = cl.points.reduce((s, p) => s + p.longitude, 0) / cl.points.length;
        const h = new Date(pt.createdAt).getHours();
        cl.hourBins[h] = (cl.hourBins[h] || 0) + 1;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) {
      const hourBins = new Array(24).fill(0);
      hourBins[new Date(pt.createdAt).getHours()]++;
      clusters.push({ points: [pt], centLat: pt.latitude, centLng: pt.longitude, visits: 1, hourBins });
    }
  }

  const dwellZones: DwellZone[] = clusters
    .filter((cl) => {
      if (cl.points.length < 3) return false;
      const sorted = [...cl.points].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const spanMin = (new Date(sorted.at(-1)!.createdAt).getTime() - new Date(sorted[0].createdAt).getTime()) / 60_000;
      return spanMin >= DWELL_MIN_MIN;
    })
    .map((cl) => {
      const sorted = [...cl.points].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const totalMin = (new Date(sorted.at(-1)!.createdAt).getTime() - new Date(sorted[0].createdAt).getTime()) / 60_000;
      // Count unique day visits
      const days = new Set(sorted.map((p) => p.createdAt.slice(0, 10)));
      // Radius = 80th-percentile distance from centroid
      const dists = cl.points.map((p) => haversineM(p.latitude, p.longitude, cl.centLat, cl.centLng)).sort((a, b) => a - b);
      const radius = dists[Math.floor(dists.length * 0.8)] ?? 50;
      const addrPts = cl.points.filter((p) => p.address);
      const label = addrPts[0]?.address?.split(",").slice(0, 2).join(",").trim() ?? `${cl.centLat.toFixed(4)}°, ${cl.centLng.toFixed(4)}°`;
      return {
        lat: cl.centLat,
        lng: cl.centLng,
        radiusM: Math.max(20, Math.min(radius, DWELL_RADIUS_M)),
        totalMinutes: Math.round(totalMin),
        visitCount: days.size,
        label,
        lastSeen: sorted.at(-1)!.createdAt,
        hourHistogram: cl.hourBins,
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, 8);

  // ── 2. Habitual corridor detection ──────────────────────────────────────
  // Group segments by day, find corridors that repeat on 2+ days
  const GRID_DEG = 0.008; // ~900m cell size for corridor fingerprinting
  const corridorsByDay: Map<string, Set<string>> = new Map();

  for (const seg of []) {
    // placeholder — populated below from allPoints segmentation
    void seg;
  }

  // Segment allPoints into per-day tracks, extract corridor "cells"
  const byDay: Map<string, RawPoint[]> = new Map();
  for (const pt of allPoints) {
    const day = pt.createdAt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(pt);
  }

  for (const [day, pts] of byDay) {
    const sorted = [...pts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const cells = new Set<string>();
    for (let i = 0; i < sorted.length - 1; i++) {
      const midLat = (sorted[i].latitude + sorted[i + 1].latitude) / 2;
      const midLng = (sorted[i].longitude + sorted[i + 1].longitude) / 2;
      cells.add(`${Math.round(midLat / GRID_DEG)},${Math.round(midLng / GRID_DEG)}`);
    }
    corridorsByDay.set(day, cells);
  }

  // Count cell frequency across days
  const cellFreq: Map<string, { days: string[]; points: RawPoint[] }> = new Map();
  for (const [day, cells] of corridorsByDay) {
    for (const cell of cells) {
      if (!cellFreq.has(cell)) cellFreq.set(cell, { days: [], points: [] });
      cellFreq.get(cell)!.days.push(day);
    }
  }

  // Cluster adjacent high-frequency cells into corridors
  const freqCells = [...cellFreq.entries()]
    .filter(([, v]) => v.days.length >= 2)
    .sort((a, b) => b[1].days.length - a[1].days.length)
    .slice(0, 30);

  // Build corridors: greedily merge adjacent cells
  const corridors: HabitualCorridor[] = [];
  const usedCells = new Set<string>();
  for (const [cellKey, { days }] of freqCells) {
    if (usedCells.has(cellKey)) continue;
    const [rowStr, colStr] = cellKey.split(",");
    const row = Number(rowStr);
    const col = Number(colStr);
    const clusterCells: string[] = [cellKey];
    // Expand to adjacent
    for (const candidate of freqCells) {
      const [r2, c2] = candidate[0].split(",").map(Number);
      if (Math.abs(r2 - row) <= 2 && Math.abs(c2 - col) <= 2 && !usedCells.has(candidate[0])) {
        clusterCells.push(candidate[0]);
        usedCells.add(candidate[0]);
      }
    }
    usedCells.add(cellKey);

    // Build polyline points from the actual GPS points near these cells
    const corrPts: Array<[number, number]> = clusterCells.flatMap((ck) => {
      const [r, c] = ck.split(",").map(Number);
      return allPoints
        .filter((p) => {
          const pr = Math.round(p.latitude / GRID_DEG);
          const pc = Math.round(p.longitude / GRID_DEG);
          return pr === r && pc === c;
        })
        .map((p): [number, number] => [p.latitude, p.longitude]);
    });

    if (corrPts.length < 2) continue;

    const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const commonDays = [...new Set(days.map((d) => DOW_LABELS[new Date(d).getDay()]))]
      .slice(0, 3);

    // Average speed
    let totalDist = 0; let totalTime = 0;
    const sortedPts = corrPts.map((p) => ({
      latitude: p[0], longitude: p[1],
      createdAt: allPoints.find((ap) => Math.abs(ap.latitude - p[0]) < 1e-6 && Math.abs(ap.longitude - p[1]) < 1e-6)?.createdAt ?? "",
    })).filter((p) => p.createdAt).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let i = 1; i < sortedPts.length; i++) {
      const d = haversineM(sortedPts[i - 1].latitude, sortedPts[i - 1].longitude, sortedPts[i].latitude, sortedPts[i].longitude);
      const t = (new Date(sortedPts[i].createdAt).getTime() - new Date(sortedPts[i - 1].createdAt).getTime()) / 3_600_000;
      if (t > 0 && t < 1) { totalDist += d / 1000; totalTime += t; }
    }
    const avgSpeed = totalTime > 0 ? totalDist / totalTime : 0;

    corridors.push({
      id: cellKey,
      points: corrPts.slice(0, 60),
      dayCount: days.length,
      avgSpeedKph: avgSpeed,
      label: `Corridor ${corridors.length + 1}`,
      commonDays,
    });

    if (corridors.length >= 5) break;
  }

  // ── 3. Speed anomaly detection ───────────────────────────────────────────
  const anomalies: SpeedAnomaly[] = [];
  const sortedAll = [...allPoints].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const speeds: number[] = [];
  for (let i = 1; i < sortedAll.length; i++) {
    const dt = (new Date(sortedAll[i].createdAt).getTime() - new Date(sortedAll[i - 1].createdAt).getTime()) / 60_000;
    if (dt > 30) continue; // ignore large gaps
    speeds.push(speedKph(sortedAll[i - 1], sortedAll[i]));
  }
  const medianSpeed = speeds.sort((a, b) => a - b)[Math.floor(speeds.length / 2)] ?? 10;

  for (let i = 1; i < sortedAll.length - 1; i++) {
    const dt = (new Date(sortedAll[i].createdAt).getTime() - new Date(sortedAll[i - 1].createdAt).getTime()) / 60_000;
    if (dt > 30 || dt === 0) continue;
    const v = speedKph(sortedAll[i - 1], sortedAll[i]);
    const vNext = i + 1 < sortedAll.length ? speedKph(sortedAll[i], sortedAll[i + 1]) : v;

    if (v > 150 && medianSpeed < 80) {
      anomalies.push({
        lat: sortedAll[i].latitude,
        lng: sortedAll[i].longitude,
        speedKph: v,
        expectedKph: medianSpeed,
        ts: sortedAll[i].createdAt,
        kind: "spike",
        description: `Speed ${Math.round(v)} km/h — ${(v / Math.max(medianSpeed, 1)).toFixed(1)}× above baseline`,
      });
    } else if (v > 5 && vNext > 5) {
      // Check for bearing reversal
      const bear1 = Math.atan2(sortedAll[i].longitude - sortedAll[i - 1].longitude, sortedAll[i].latitude - sortedAll[i - 1].latitude);
      const bear2 = Math.atan2(sortedAll[i + 1].longitude - sortedAll[i].longitude, sortedAll[i + 1].latitude - sortedAll[i].latitude);
      const angleDiff = Math.abs(((bear2 - bear1) * 180) / Math.PI);
      const normalised = angleDiff > 180 ? 360 - angleDiff : angleDiff;
      if (normalised > 140) {
        anomalies.push({
          lat: sortedAll[i].latitude,
          lng: sortedAll[i].longitude,
          speedKph: v,
          expectedKph: medianSpeed,
          ts: sortedAll[i].createdAt,
          kind: "reversal",
          description: `Direction reversal (${Math.round(normalised)}° turn) at ${Math.round(v)} km/h`,
        });
      }
    }
  }
  const dedupedAnomalies = anomalies.filter((a, i, arr) =>
    i === arr.findIndex((b) => haversineM(a.lat, a.lng, b.lat, b.lng) < 300)
  ).slice(0, 12);

  // ── 4. Temporal patterns ─────────────────────────────────────────────────
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const pt of allPoints) {
    const d = new Date(pt.createdAt);
    grid[d.getDay()][d.getHours()]++;
  }
  const maxCell = Math.max(1, ...grid.flat());
  const temporalGrid: TemporalPattern[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      if (grid[dow][hour] > 0) {
        temporalGrid.push({ dayOfWeek: dow, hour, count: grid[dow][hour], hotness: grid[dow][hour] / maxCell });
      }
    }
  }

  // ── 5. Predictive intelligence ───────────────────────────────────────────
  // Based on top dwell zones + peak temporal slots, predict next likely location
  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const predictions: PredictedLocation[] = dwellZones.slice(0, 3).map((zone) => {
    // Find which day+hour has most activity near this zone
    const nearPts = allPoints.filter(
      (p) => haversineM(p.latitude, p.longitude, zone.lat, zone.lng) < zone.radiusM * 2,
    );
    const peakHour = zone.hourHistogram.indexOf(Math.max(...zone.hourHistogram));
    const peakDow = nearPts.length > 0
      ? [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          d,
          n: nearPts.filter((p) => new Date(p.createdAt).getDay() === d).length,
        })).sort((a, b) => b.n - a.n)[0].d
      : 1;
    const conf = Math.min(0.95, 0.4 + zone.visitCount * 0.08 + (zone.totalMinutes / 120) * 0.1);
    return {
      lat: zone.lat,
      lng: zone.lng,
      confidence: conf,
      likelyTime: `${DOW_LABELS[peakDow]} ~${String(peakHour).padStart(2, "0")}:00`,
      reasoning: `${zone.visitCount} prior visits · avg ${zone.totalMinutes < 60 ? zone.totalMinutes + "m" : (zone.totalMinutes / 60).toFixed(1) + "h"} dwell`,
      address: zone.label,
    };
  });

  // ── 6. Evasion score ─────────────────────────────────────────────────────
  const severeGaps = gaps.filter((g) => g.severity === "major" || g.severity === "significant").length;
  const reversalCount = dedupedAnomalies.filter((a) => a.kind === "reversal").length;
  const spikeCount = dedupedAnomalies.filter((a) => a.kind === "spike").length;
  const gapRate = gaps.length / Math.max(1, allPoints.length / 10);

  const evasionSignals: EvasionIndicator["signals"] = [];
  let evasionScore = 0;

  if (severeGaps >= 2) {
    const w = Math.min(30, severeGaps * 8);
    evasionScore += w;
    evasionSignals.push({ label: "Signal Blackouts", weight: w, description: `${severeGaps} major/significant signal gaps detected — device may have been deliberately disabled` });
  }
  if (reversalCount >= 2) {
    const w = Math.min(25, reversalCount * 7);
    evasionScore += w;
    evasionSignals.push({ label: "Direction Reversals", weight: w, description: `${reversalCount} abrupt course reversals — consistent with counter-surveillance manoeuvres` });
  }
  if (spikeCount >= 1) {
    const w = Math.min(15, spikeCount * 5);
    evasionScore += w;
    evasionSignals.push({ label: "Velocity Spikes", weight: w, description: `${spikeCount} unexplained speed anomalies — possible vehicle switches or data manipulation` });
  }
  if (gapRate > 0.3) {
    const w = Math.min(20, Math.round(gapRate * 25));
    evasionScore += w;
    evasionSignals.push({ label: "Elevated Gap Rate", weight: w, description: `High ratio of signal gaps to active points — irregular reporting cadence` });
  }
  const irregularHours = temporalGrid.filter((t) => (t.hour >= 0 && t.hour <= 5) && t.hotness > 0.4).length;
  if (irregularHours >= 2) {
    const w = 10;
    evasionScore += w;
    evasionSignals.push({ label: "Off-hours Movement", weight: w, description: `${irregularHours} late-night/early-morning activity spikes — anomalous for typical civilian patterns` });
  }

  evasionScore = Math.min(100, evasionScore);
  const evasionLevel: EvasionIndicator["level"] =
    evasionScore >= 65 ? "critical" : evasionScore >= 40 ? "high" : evasionScore >= 20 ? "elevated" : "nominal";

  return {
    dwellZones,
    corridors,
    anomalies: dedupedAnomalies,
    temporalGrid,
    predictions,
    evasion: { score: evasionScore, level: evasionLevel, signals: evasionSignals },
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TemporalHeatmap({ grid }: { grid: TemporalPattern[] }) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const gridMap = new Map(grid.map((t) => [`${t.dayOfWeek}-${t.hour}`, t.hotness]));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Hour axis */}
        <div className="flex gap-px mb-1 ml-10">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-5 text-center text-[8px] text-muted-foreground font-mono">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {DOW.map((day, dow) => (
          <div key={dow} className="flex items-center gap-px mb-px">
            <div className="w-9 text-[9px] text-muted-foreground font-mono text-right pr-1.5 shrink-0">{day}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const hot = gridMap.get(`${dow}-${h}`) ?? 0;
              const bg = hot === 0
                ? "bg-zinc-800/60"
                : hot < 0.2 ? "bg-amber-900/50"
                : hot < 0.45 ? "bg-amber-700/70"
                : hot < 0.7 ? "bg-amber-500/80"
                : hot < 0.9 ? "bg-amber-400"
                : "bg-amber-300";
              return (
                <div
                  key={h}
                  title={hot > 0 ? `${day} ${h}:00 — ${Math.round(hot * 100)}% activity` : undefined}
                  className={`w-5 h-4 rounded-[2px] transition-all cursor-default ${bg}`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 text-[9px] text-muted-foreground font-mono ml-10">
          <span>Less</span>
          {["bg-zinc-800/60", "bg-amber-900/50", "bg-amber-700/70", "bg-amber-500/80", "bg-amber-300"].map((cls, i) => (
            <div key={i} className={`w-4 h-3 rounded-[2px] ${cls}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function BehaviorMap({ dwellZones, corridors, anomalies, predictions }: {
  dwellZones: DwellZone[];
  corridors: HabitualCorridor[];
  anomalies: SpeedAnomaly[];
  predictions: PredictedLocation[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, {
      center: [20, 0], zoom: 2, zoomControl: true, attributionControl: false,
    });
    L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20, subdomains: "0123",
    }).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    const bounds: L.LatLng[] = [];

    // Dwell zones — amber circles
    for (const z of dwellZones) {
      const circle = L.circle([z.lat, z.lng], {
        radius: Math.max(z.radiusM, 40),
        color: "#F59E0B",
        fillColor: "#F59E0B",
        fillOpacity: 0.18,
        weight: 1.5,
        opacity: 0.7,
      }).addTo(map).bindPopup(
        `<div style="font-family:monospace;font-size:11px;line-height:1.5">
          <b style="color:#F59E0B">DWELL ZONE</b><br/>
          ${z.label}<br/>
          ${z.visitCount} visits · ${z.totalMinutes < 60 ? z.totalMinutes + "m" : (z.totalMinutes / 60).toFixed(1) + "h"} total
        </div>`
      );
      layersRef.current.push(circle);
      bounds.push(L.latLng(z.lat, z.lng));
    }

    // Habitual corridors — blue polylines
    for (const c of corridors) {
      if (c.points.length < 2) continue;
      const poly = L.polyline(c.points, {
        color: "#60A5FA",
        weight: 3,
        opacity: 0.65,
        dashArray: undefined,
      }).addTo(map).bindPopup(
        `<div style="font-family:monospace;font-size:11px;line-height:1.5">
          <b style="color:#60A5FA">HABITUAL CORRIDOR</b><br/>
          Used ${c.dayCount} day(s)<br/>
          Common: ${c.commonDays.join(", ")}
        </div>`
      );
      layersRef.current.push(poly);
      c.points.forEach(([lat, lng]) => bounds.push(L.latLng(lat, lng)));
    }

    // Anomalies — red markers
    for (const a of anomalies) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${a.kind === "reversal" ? "#F97316" : "#EF4444"};border:2px solid rgba(255,255,255,0.5);box-shadow:0 0 8px ${a.kind === "reversal" ? "#F97316" : "#EF4444"}"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const m = L.marker([a.lat, a.lng], { icon }).addTo(map).bindPopup(
        `<div style="font-family:monospace;font-size:11px;line-height:1.5">
          <b style="color:#EF4444">${a.kind.toUpperCase()}</b><br/>
          ${a.description}
        </div>`
      );
      layersRef.current.push(m);
      bounds.push(L.latLng(a.lat, a.lng));
    }

    // Predictions — green pulsing markers
    for (const p of predictions) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:rgba(52,211,153,0.25);border:2px solid #34D399;box-shadow:0 0 10px #34D399"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(map).bindPopup(
        `<div style="font-family:monospace;font-size:11px;line-height:1.5">
          <b style="color:#34D399">PREDICTED LOCATION</b><br/>
          ${p.likelyTime}<br/>
          Confidence: ${Math.round(p.confidence * 100)}%<br/>
          ${p.reasoning}
        </div>`
      );
      layersRef.current.push(m);
      bounds.push(L.latLng(p.lat, p.lng));
    }

    if (bounds.length > 0) {
      try { map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 14 }); } catch { /* ignore */ }
    }
  }, [dwellZones, corridors, anomalies, predictions]);

  return <div ref={mapRef} className="w-full rounded-xl overflow-hidden border border-border/60" style={{ height: 380 }} />;
}

function EvasionGauge({ evasion }: { evasion: EvasionIndicator }) {
  const levelColor = {
    nominal: "#34D399",
    elevated: "#F59E0B",
    high: "#F97316",
    critical: "#EF4444",
  }[evasion.level];

  const levelBg = {
    nominal: "bg-emerald-500/10 border-emerald-500/30",
    elevated: "bg-amber-500/10 border-amber-500/30",
    high: "bg-orange-500/10 border-orange-500/30",
    critical: "bg-red-500/10 border-red-500/30",
  }[evasion.level];

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${levelBg}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Evasion Risk Score</span>
          <span className="text-2xl font-bold font-mono" style={{ color: levelColor }}>{evasion.score}</span>
        </div>
        <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden mb-2">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${evasion.score}%`, background: `linear-gradient(90deg, ${levelColor}99, ${levelColor})` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: levelColor }}/>
          <span className="text-xs font-mono font-semibold uppercase tracking-widest" style={{ color: levelColor }}>
            {evasion.level}
          </span>
        </div>
      </div>
      {evasion.signals.length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono">No evasion signals detected in this dataset.</p>
      ) : (
        <div className="space-y-2">
          {evasion.signals.map((sig, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/50 p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={11} className="text-orange-400 shrink-0" />
                  <span className="text-xs font-semibold font-mono">{sig.label}</span>
                </div>
                <Badge variant="outline" className="font-mono text-[9px] h-4 px-1.5">+{sig.weight}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{sig.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DwellCard({ zone, rank }: { zone: DwellZone; rank: number }) {
  const peakHour = zone.hourHistogram.indexOf(Math.max(...zone.hourHistogram));
  const durationLabel = zone.totalMinutes < 60
    ? `${zone.totalMinutes}m`
    : zone.totalMinutes < 1440
    ? `${(zone.totalMinutes / 60).toFixed(1)}h`
    : `${(zone.totalMinutes / 1440).toFixed(1)}d`;

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 space-y-2">
      <div className="flex items-start gap-2">
        <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[9px] font-bold text-amber-400 font-mono">{rank}</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{zone.label}</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {zone.lat.toFixed(4)}°, {zone.lng.toFixed(4)}°
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          { label: "Total time", value: durationLabel },
          { label: "Visits", value: String(zone.visitCount) },
          { label: "Peak hour", value: `${peakHour}:00` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg bg-muted/40 border border-border/40 py-1.5">
            <div className="text-xs font-bold font-mono text-amber-400">{stat.value}</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
      {/* Mini hour histogram */}
      <div className="flex items-end gap-px h-5">
        {zone.hourHistogram.map((v, h) => {
          const maxV = Math.max(1, ...zone.hourHistogram);
          const pct = v / maxV;
          return (
            <div
              key={h}
              title={`${h}:00 — ${v} pts`}
              className="flex-1 rounded-t-[1px] transition-all"
              style={{
                height: `${Math.max(pct * 100, v > 0 ? 15 : 0)}%`,
                background: pct > 0.7 ? "#F59E0B" : pct > 0.3 ? "#B45309" : pct > 0 ? "#78350F" : "transparent",
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[8px] text-muted-foreground font-mono">
        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Last seen: {format(new Date(zone.lastSeen), "MMM d, HH:mm")}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BehavioralSignatures() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const { data: invites } = useListInvites(userId ?? 0);
  const [selectedInviteId, setSelectedInviteId] = useState<number | null>(null);
  const [daysBack, setDaysBack] = useState(30);
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<MovementResult | null>(null);

  const grantedInvites = useMemo(
    () => (invites ?? []).filter((inv: Invite) => inv.status === "accepted"),
    [invites],
  );

  // Auto-select first contact
  useEffect(() => {
    if (!selectedInviteId && grantedInvites.length > 0) {
      setSelectedInviteId(grantedInvites[0].id);
    }
  }, [grantedInvites, selectedInviteId]);

  const fetchData = async () => {
    if (!selectedInviteId) return;
    setLoading(true);
    setRawData(null);
    try {
      const r = await fetch(`${API_BASE}/api/movement-patterns?inviteId=${selectedInviteId}&userId=${userId}&daysBack=${daysBack}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRawData(await r.json());
    } catch (e: any) {
      toast({ title: "Failed to load data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedInviteId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInviteId, daysBack]);

  const generateReport = () => {
    if (!rawData || !analytics) return;
    const contactName = selectedInvite?.toName || selectedInvite?.toPhone || "Unknown";
    const generatedAt = new Date().toLocaleString();
    const dateFrom = new Date(rawData.summary.dateFrom).toLocaleDateString();
    const dateTo   = new Date(rawData.summary.dateTo).toLocaleDateString();

    const evasionColour = analytics.evasion.level === "critical" ? "#ef4444"
      : analytics.evasion.level === "high"     ? "#f97316"
      : analytics.evasion.level === "elevated" ? "#eab308"
      : "#22c55e";

    const rows = {
      dwell: analytics.dwellZones.map((z, i) => `
        <tr>
          <td>#${i + 1}</td>
          <td>${z.label}</td>
          <td>${z.visitCount}</td>
          <td>${z.totalMinutes >= 60 ? `${Math.round(z.totalMinutes / 60)}h ${z.totalMinutes % 60}m` : `${z.totalMinutes}m`}</td>
          <td>${format(new Date(z.lastSeen), "MMM d, HH:mm")}</td>
        </tr>`).join(""),

      anomalies: analytics.anomalies.map((a) => `
        <tr>
          <td><span class="tag tag-${a.kind === "reversal" ? "warn" : "danger"}">${a.kind.toUpperCase()}</span></td>
          <td>${format(new Date(a.ts), "MMM d, HH:mm")}</td>
          <td>${a.description}</td>
          <td class="mono">${a.lat.toFixed(4)}°, ${a.lng.toFixed(4)}°</td>
        </tr>`).join(""),

      corridors: analytics.corridors.map((c) => `
        <tr>
          <td>${c.label}</td>
          <td>${c.dayCount}</td>
          <td>${c.avgSpeedKph < 1 ? "Walk" : `${Math.round(c.avgSpeedKph)} km/h`}</td>
          <td>${c.commonDays.join(", ") || "—"}</td>
        </tr>`).join(""),

      predictions: analytics.predictions.map((p) => `
        <tr>
          <td class="mono">${p.likelyTime}</td>
          <td>${p.address || `${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°`}</td>
          <td>${Math.round(p.confidence * 100)}%</td>
          <td>${p.reasoning}</td>
        </tr>`).join(""),

      signals: analytics.evasion.signals.map((s) => `
        <tr>
          <td>${s.label}</td>
          <td>${s.weight > 15 ? "HIGH" : s.weight > 7 ? "MED" : "LOW"}</td>
          <td>${s.description}</td>
        </tr>`).join(""),
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Behavioral Signatures Report — ${contactName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Segoe UI",system-ui,sans-serif;font-size:11px;color:#0f172a;background:#fff;padding:28px 32px}
    h1{font-size:20px;font-weight:700;letter-spacing:-.3px;color:#0f172a}
    h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#475569;margin:22px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:5px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid #0f172a}
    .header-meta{font-size:10px;color:#64748b;line-height:1.8;text-align:right}
    .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:4px}
    .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc}
    .kpi-val{font-size:18px;font-weight:700;color:#0f172a}
    .kpi-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-top:2px}
    .evasion-row{display:flex;align-items:center;gap:16px;margin:10px 0}
    .evasion-score{font-size:36px;font-weight:800;color:${evasionColour}}
    .evasion-level{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${evasionColour}}
    table{width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:4px}
    th{text-align:left;padding:5px 8px;background:#f1f5f9;font-weight:600;color:#475569;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em}
    td{padding:5px 8px;border-bottom:1px solid #f1f5f9;color:#1e293b;vertical-align:top}
    tr:last-child td{border-bottom:none}
    .tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:.06em}
    .tag-danger{background:#fee2e2;color:#b91c1c}
    .tag-warn{background:#ffedd5;color:#c2410c}
    .mono{font-family:monospace;font-size:10px}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9.5px;color:#94a3b8;line-height:1.6}
    .no-data{color:#94a3b8;font-style:italic;font-size:10px;padding:6px 0}
    @media print{body{padding:16px 20px}h2{margin-top:16px}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:4px">DeepFalcon · Intelligence Platform</div>
      <h1>Behavioral Signatures Report</h1>
      <div style="font-size:12px;color:#475569;margin-top:4px">Subject: <strong>${contactName}</strong></div>
    </div>
    <div class="header-meta">
      Generated: ${generatedAt}<br/>
      Period: ${dateFrom} — ${dateTo}<br/>
      Analysis window: ${daysBack} days
    </div>
  </div>

  <h2>Summary</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-val">${rawData.summary.totalPoints.toLocaleString()}</div><div class="kpi-lbl">Location points</div></div>
    <div class="kpi"><div class="kpi-val">${rawData.summary.activeDays}</div><div class="kpi-lbl">Active days</div></div>
    <div class="kpi"><div class="kpi-val">${rawData.summary.totalRealKm.toFixed(1)} km</div><div class="kpi-lbl">Distance tracked</div></div>
    <div class="kpi"><div class="kpi-val">${rawData.summary.totalGaps}</div><div class="kpi-lbl">Signal gaps</div></div>
    <div class="kpi" style="border-color:${evasionColour};background:${evasionColour}11">
      <div class="kpi-val" style="color:${evasionColour}">${analytics.evasion.score}</div>
      <div class="kpi-lbl">Evasion score</div>
    </div>
  </div>

  <h2>Evasion Assessment</h2>
  <div class="evasion-row">
    <div class="evasion-score">${analytics.evasion.score}<span style="font-size:18px;color:#94a3b8">/100</span></div>
    <div>
      <div class="evasion-level">${analytics.evasion.level}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px">${analytics.evasion.signals.length} contributing signal${analytics.evasion.signals.length !== 1 ? "s" : ""}</div>
    </div>
  </div>
  ${analytics.evasion.signals.length > 0 ? `
  <table>
    <thead><tr><th>Signal</th><th>Weight</th><th>Detail</th></tr></thead>
    <tbody>${rows.signals}</tbody>
  </table>` : `<p class="no-data">No evasion signals detected.</p>`}

  <h2>Dwell Zones (${analytics.dwellZones.length})</h2>
  ${analytics.dwellZones.length > 0 ? `
  <table>
    <thead><tr><th>#</th><th>Location</th><th>Visits</th><th>Total time</th><th>Last seen</th></tr></thead>
    <tbody>${rows.dwell}</tbody>
  </table>` : `<p class="no-data">No significant dwell zones detected.</p>`}

  <h2>Habitual Corridors (${analytics.corridors.length})</h2>
  ${analytics.corridors.length > 0 ? `
  <table>
    <thead><tr><th>Route</th><th>Days used</th><th>Avg speed</th><th>Common days</th></tr></thead>
    <tbody>${rows.corridors}</tbody>
  </table>` : `<p class="no-data">No habitual corridors detected.</p>`}

  <h2>Speed &amp; Direction Anomalies (${analytics.anomalies.length})</h2>
  ${analytics.anomalies.length > 0 ? `
  <table>
    <thead><tr><th>Type</th><th>Time</th><th>Description</th><th>Coordinates</th></tr></thead>
    <tbody>${rows.anomalies}</tbody>
  </table>` : `<p class="no-data">No anomalies detected in this period.</p>`}

  <h2>Predictive Intel (${analytics.predictions.length})</h2>
  ${analytics.predictions.length > 0 ? `
  <table>
    <thead><tr><th>Expected time</th><th>Location</th><th>Confidence</th><th>Reasoning</th></tr></thead>
    <tbody>${rows.predictions}</tbody>
  </table>` : `<p class="no-data">Insufficient pattern data for predictions.</p>`}

  <div class="footer">
    <strong>Methodology:</strong> All analysis is computed from GPS location history. Dwell zones cluster points within 120 m for &gt;4 min. Habitual corridors require 2+ distinct days on the same route. Evasion scoring is indicative — individual signals must be assessed in context. Predictions are probabilistic estimates based on observed patterns only and should not be used as sole evidence.
  </div>

  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  // Derive behavioral analytics
  const allPoints = useMemo<RawPoint[]>(() => {
    if (!rawData) return [];
    return rawData.segments
      .filter((s): s is RealSegment => s.type === "real")
      .flatMap((s) => s.points);
  }, [rawData]);

  const gaps = useMemo<GapSegment[]>(() => {
    if (!rawData) return [];
    return rawData.segments.filter((s): s is GapSegment => s.type === "gap");
  }, [rawData]);

  const analytics = useMemo(
    () => analyzePoints(allPoints, gaps),
    [allPoints, gaps],
  );

  const selectedInvite = grantedInvites.find((inv: Invite) => inv.id === selectedInviteId);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Brain size={15} className="text-amber-400" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Behavioral Signatures</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Detects habitual routes, dwell zones, meeting patterns, speed anomalies, evasion indicators, and predicts likely future locations.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Contact selector */}
            <div className="flex items-center gap-2 min-w-0">
              <User size={13} className="text-muted-foreground shrink-0" />
              <div className="relative">
                <select
                  value={selectedInviteId ?? ""}
                  onChange={(e) => setSelectedInviteId(Number(e.target.value))}
                  className="appearance-none text-xs font-mono bg-muted/60 border border-border rounded-lg pl-3 pr-7 py-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  {grantedInvites.length === 0 && <option value="">No contacts</option>}
                  {grantedInvites.map((inv: Invite) => (
                    <option key={inv.id} value={inv.id}>{inv.toName || inv.toPhone}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              </div>
            </div>
            {/* Time range */}
            <div className="flex items-center gap-1.5">
              {[7, 14, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDaysBack(d)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    daysBack === d
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                      : "bg-muted/40 text-muted-foreground border border-border/50 hover:border-amber-500/30"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchData}
              disabled={loading || !selectedInviteId}
              className="h-7 text-xs gap-1.5"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
              {loading ? "Analyzing…" : "Refresh"}
            </Button>
            {rawData && allPoints.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={generateReport}
                className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50"
              >
                <FileDown size={11} />
                Export Report
              </Button>
            )}
            {rawData && (
              <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                {allPoints.length.toLocaleString()} pts · {rawData.summary.activeDays}d active
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Empty state */}
      {grantedInvites.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-10 text-center">
          <Brain size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">No active contacts</p>
          <p className="text-xs text-muted-foreground mt-1">Grant location access from the Invites page to start behavioral analysis.</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/40 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && rawData && allPoints.length > 0 && (
        <>
          {/* Behavioral map — everything overlaid */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Target size={13} />
              Behavioral Intelligence Map
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                — dwell zones <span className="text-amber-400">●</span>, habitual corridors <span className="text-blue-400">─</span>, anomalies <span className="text-red-400">●</span>, predictions <span className="text-emerald-400">◎</span>
              </span>
            </h2>
            <BehaviorMap
              dwellZones={analytics.dwellZones}
              corridors={analytics.corridors}
              anomalies={analytics.anomalies}
              predictions={analytics.predictions}
            />
          </div>

          {/* Main analytics grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Evasion assessment */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Shield size={13} /> Evasion Assessment
              </h2>
              <EvasionGauge evasion={analytics.evasion} />
            </div>

            {/* Predictive Intel */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Eye size={13} /> Predictive Intel
              </h2>
              {analytics.predictions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 p-6 text-center">
                  <p className="text-xs text-muted-foreground">Insufficient pattern data for predictions. Try a longer time range.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {analytics.predictions.map((p, i) => (
                    <div key={i} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-xs font-semibold font-mono text-emerald-400">{p.likelyTime}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${p.confidence * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-emerald-400">{Math.round(p.confidence * 100)}%</span>
                        </div>
                      </div>
                      <p className="text-xs truncate font-medium mb-0.5">{p.address}</p>
                      <p className="text-[10px] text-muted-foreground">{p.reasoning}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Activity timing heatmap */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock size={13} /> Activity Timing — Day × Hour Matrix
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                when is this person active each day of the week?
              </span>
            </h2>
            <div className="rounded-xl border border-border/60 bg-card p-4">
              <TemporalHeatmap grid={analytics.temporalGrid} />
            </div>
          </div>

          {/* Dwell zones */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <MapPin size={13} /> Dwell Zones
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                ({analytics.dwellZones.length} cluster{analytics.dwellZones.length !== 1 ? "s" : ""} — locations with sustained presence)
              </span>
            </h2>
            {analytics.dwellZones.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/50 p-6 text-center">
                <p className="text-xs text-muted-foreground">No significant dwell zones detected — try a longer time range.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {analytics.dwellZones.map((zone, i) => (
                  <DwellCard key={i} zone={zone} rank={i + 1} />
                ))}
              </div>
            )}
          </div>

          {/* Habitual corridors */}
          {analytics.corridors.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Route size={13} /> Habitual Corridors
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                  ({analytics.corridors.length} repeated route{analytics.corridors.length !== 1 ? "s" : ""})
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analytics.corridors.map((c, i) => (
                  <div key={i} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-xs font-semibold text-blue-300">{c.label}</span>
                      </div>
                      <Badge variant="outline" className="font-mono text-[9px] h-4 border-blue-500/30 text-blue-400">
                        ×{c.dayCount} days
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <TrendingUp size={9} />
                        {c.avgSpeedKph < 1 ? "Walk" : c.avgSpeedKph < 25 ? `${Math.round(c.avgSpeedKph)} km/h` : `${Math.round(c.avgSpeedKph)} km/h`}
                      </span>
                      {c.commonDays.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock size={9} />
                          {c.commonDays.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Speed & direction anomalies */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Zap size={13} /> Speed & Direction Anomalies
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                ({analytics.anomalies.length} event{analytics.anomalies.length !== 1 ? "s" : ""})
              </span>
            </h2>
            {analytics.anomalies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 p-6 text-center">
                <p className="text-xs text-muted-foreground">No anomalies detected within this time window.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {analytics.anomalies.map((a, i) => {
                  const isReversal = a.kind === "reversal";
                  return (
                    <div
                      key={i}
                      className={`rounded-xl border p-3.5 flex items-start gap-3 ${
                        isReversal
                          ? "border-orange-500/25 bg-orange-500/5"
                          : "border-red-500/25 bg-red-500/5"
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${isReversal ? "bg-orange-400" : "bg-red-400"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] font-bold uppercase tracking-wider font-mono ${isReversal ? "text-orange-400" : "text-red-400"}`}>
                            {a.kind}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {format(new Date(a.ts), "MMM d, HH:mm")}
                          </span>
                        </div>
                        <p className="text-xs text-foreground/80">{a.description}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {a.lat.toFixed(4)}°, {a.lng.toFixed(4)}°
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Methodology note */}
          <div className="rounded-xl border border-border/40 bg-muted/20 p-4 flex items-start gap-3 text-xs text-muted-foreground">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              All analysis is computed client-side from existing location data. Dwell zones cluster GPS points within 120 m. Habitual corridors require the same geographic cell to appear on 2+ distinct days.
              Evasion scoring is indicative — individual signals should be assessed in context before drawing conclusions.
              Predictions are probabilistic estimates based on historical patterns only.
            </p>
          </div>
        </>
      )}

      {!loading && rawData && allPoints.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-10 text-center">
          <Activity size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">No location data in this period</p>
          <p className="text-xs text-muted-foreground mt-1">Try extending the time range or selecting a different contact.</p>
        </div>
      )}
    </div>
  );
}
