/**
 * Movement Patterns — reconstructs historical movement over weeks/months
 * from sparse GPS signals, including gap classification and interpolation.
 */
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  User, CalendarDays, Route, TrendingUp, WifiOff, Clock,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Info,
  Zap, MapPin, Navigation,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { MapCloudReveal } from "@/components/map-cloud-reveal";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ────────────────────────────────────────────────────────────────────

interface RealPoint {
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
  points: RealPoint[];
  distanceKm: number;
  durationMinutes: number;
  startTime: string;
  endTime: string;
}

interface GapSegment {
  type: "gap";
  fromPoint: { latitude: number; longitude: number; createdAt: string };
  toPoint: { latitude: number; longitude: number; createdAt: string };
  interpolated: Array<{ latitude: number; longitude: number }>;
  gapMinutes: number;
  distanceKm: number;
  reason: string;
  severity: "minor" | "moderate" | "significant" | "major";
  startTime: string;
  endTime: string;
}

type Segment = RealSegment | GapSegment;

interface AnalysisSummary {
  totalPoints: number;
  totalRealKm: number;
  totalGapKm: number;
  totalGaps: number;
  gapTotalMinutes: number;
  longestGapMinutes: number;
  activeDays: number;
  dateFrom: string;
  dateTo: string;
}

interface AnalysisResult {
  segments: Segment[];
  dailyCounts: Record<string, number>;
  summary: AnalysisSummary;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

const SEVERITY_COLOR: Record<GapSegment["severity"], string> = {
  minor: "#6b7280",
  moderate: "#f59e0b",
  significant: "#f97316",
  major: "#ef4444",
};

const SEVERITY_LABEL: Record<GapSegment["severity"], string> = {
  minor: "Minor",
  moderate: "Moderate",
  significant: "Significant",
  major: "Major",
};

// ── Calendar Heatmap ─────────────────────────────────────────────────────────

function CalendarHeatmap({ dailyCounts, daysBack }: { dailyCounts: Record<string, number>; daysBack: number }) {
  const now = new Date();
  const maxCount = Math.max(1, ...Object.values(dailyCounts));

  // Build array of days oldest → newest
  const days: Array<{ date: Date; dateStr: string; count: number }> = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: d, dateStr, count: dailyCounts[dateStr] ?? 0 });
  }

  const getColor = (count: number) => {
    if (count === 0) return "bg-zinc-800 border-zinc-700";
    const intensity = count / maxCount;
    if (intensity < 0.2) return "bg-amber-900/70 border-amber-800/50";
    if (intensity < 0.5) return "bg-amber-700/80 border-amber-600/60";
    if (intensity < 0.8) return "bg-amber-500/90 border-amber-400/70";
    return "bg-amber-400 border-amber-300";
  };

  // Split into weeks
  const weeks: Array<typeof days> = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.dateStr}
                title={`${format(day.date, "MMM d, yyyy")} — ${day.count} GPS points`}
                className={`w-3 h-3 rounded-sm border cursor-default transition-all hover:scale-125 ${getColor(day.count)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground font-mono">
        <span>Less</span>
        {["bg-zinc-800 border-zinc-700", "bg-amber-900/70 border-amber-800/50", "bg-amber-700/80 border-amber-600/60", "bg-amber-500/90 border-amber-400/70", "bg-amber-400 border-amber-300"].map((cls, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm border ${cls}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ── Pattern Map ──────────────────────────────────────────────────────────────

function PatternMap({ segments }: { segments: Segment[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: true, attributionControl: false });
    L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20, subdomains: "0123", attribution: "© Google Maps",
    }).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    if (segments.length === 0) return;

    const allLatLngs: L.LatLng[] = [];

    for (const seg of segments) {
      if (seg.type === "real") {
        if (seg.points.length < 2) {
          // Single point — just a marker
          const p = seg.points[0];
          const dot = L.circleMarker([p.latitude, p.longitude], {
            radius: 4, color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.8, weight: 1,
          }).addTo(map);
          layersRef.current.push(dot);
          allLatLngs.push(L.latLng(p.latitude, p.longitude));
          continue;
        }

        const lls = seg.points.map((p) => L.latLng(p.latitude, p.longitude));
        allLatLngs.push(...lls);

        // Solid indigo polyline for real GPS track
        const line = L.polyline(lls, { color: "#6366f1", weight: 3, opacity: 0.9 }).addTo(map);
        line.bindTooltip(
          `<span style="font-size:11px;font-family:monospace;">📍 ${seg.points.length} pts · ${fmtKm(seg.distanceKm)} · ${fmtDuration(seg.durationMinutes)}</span>`,
          { sticky: true },
        );
        layersRef.current.push(line);

      } else {
        // Gap segment — dashed line
        const color = SEVERITY_COLOR[seg.severity];
        const dashArr = seg.severity === "major" ? "8,8" : seg.severity === "significant" ? "6,6" : "4,4";

        const lls = seg.interpolated.map((p) => L.latLng(p.latitude, p.longitude));
        allLatLngs.push(...lls);

        const gapLine = L.polyline(lls, {
          color, weight: 2, opacity: 0.7, dashArray: dashArr,
        }).addTo(map);
        gapLine.bindTooltip(
          `<span style="font-size:11px;font-family:monospace;">⚠ GAP ${fmtDuration(seg.gapMinutes)} · ${seg.reason}</span>`,
          { sticky: true },
        );
        layersRef.current.push(gapLine);

        // Gap midpoint annotation marker
        const mid = seg.interpolated[Math.floor(seg.interpolated.length / 2)];
        const gapIcon = L.divIcon({
          className: "",
          html: `<div style="background:${color};color:#fff;font-size:10px;font-family:monospace;padding:2px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.5);">${fmtDuration(seg.gapMinutes)}</div>`,
          iconAnchor: [20, 10],
        });
        const midMark = L.marker([mid.latitude, mid.longitude], { icon: gapIcon }).addTo(map);
        layersRef.current.push(midMark);
      }
    }

    // Start/end markers
    const first = segments[0];
    const last = segments[segments.length - 1];
    const startPt = first.type === "real" ? first.points[0] : first.fromPoint;
    const endPt = last.type === "real" ? last.points[last.points.length - 1] : last.toPoint;

    const startIcon = L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 3px rgba(16,185,129,0.35);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6],
    });
    const endIcon = L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 0 0 3px rgba(245,158,11,0.35);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6],
    });

    layersRef.current.push(
      L.marker([startPt.latitude, startPt.longitude], { icon: startIcon })
        .bindTooltip(`<span style="font-size:11px;">🟢 First point</span>`)
        .addTo(map),
      L.marker([endPt.latitude, endPt.longitude], { icon: endIcon })
        .bindTooltip(`<span style="font-size:11px;">🟡 Latest point</span>`)
        .addTo(map),
    );

    if (allLatLngs.length === 1) {
      map.setView(allLatLngs[0], 16);
    } else if (allLatLngs.length > 1) {
      map.fitBounds(L.latLngBounds(allLatLngs).pad(0.06), { maxZoom: 16 });
    }
  }, [segments]);

  if (segments.length === 0) {
    return (
      <div className="w-full rounded-xl bg-muted/40 border border-border flex items-center justify-center" style={{ height: 380 }}>
        <div className="text-center">
          <Route size={32} className="text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">No movement data for this period</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div ref={mapRef} className="w-full rounded-xl overflow-hidden border border-border" style={{ height: 380, zIndex: 0 }} />
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-indigo-500" />
          <span>Real GPS track</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-zinc-500 border-dashed border-t border-zinc-500" style={{ borderStyle: "dashed" }} />
          <span>Minor gap</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-amber-500" style={{ borderStyle: "dashed" }} />
          <span>Moderate gap</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-orange-500" />
          <span>Significant gap</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-red-500" />
          <span>Major gap</span>
        </div>
      </div>
    </div>
  );
}

// ── Gap list ─────────────────────────────────────────────────────────────────

function GapList({ gaps }: { gaps: GapSegment[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const significantGaps = gaps.filter((g) => g.severity !== "minor");
  const display = showAll ? gaps : significantGaps.slice(0, 10);

  if (gaps.length === 0) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No significant gaps detected in this period.</div>
  );

  return (
    <div className="space-y-2">
      {display.map((gap, i) => {
        const color = SEVERITY_COLOR[gap.severity];
        const isExpanded = expanded === i;
        return (
          <button
            key={i}
            onClick={() => setExpanded(isExpanded ? null : i)}
            className="w-full text-left"
          >
            <div className="rounded-xl border border-border/60 bg-card px-4 py-3 hover:border-primary/30 transition-all">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground font-mono">
                        {fmtDuration(gap.gapMinutes)}
                      </span>
                      <Badge
                        className="text-[9px] py-0 h-4 font-mono"
                        style={{ background: `${color}22`, color, borderColor: `${color}44`, borderWidth: 1 }}
                      >
                        {SEVERITY_LABEL[gap.severity]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{gap.reason}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                    {format(new Date(gap.startTime), "MMM d, HH:mm")}
                  </span>
                  {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Started</p>
                    <p className="text-xs font-mono text-foreground">{format(new Date(gap.startTime), "MMM d, HH:mm")}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Resumed</p>
                    <p className="text-xs font-mono text-foreground">{format(new Date(gap.endTime), "MMM d, HH:mm")}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Displacement</p>
                    <p className="text-xs font-mono text-foreground">{fmtKm(gap.distanceKm)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">From</p>
                    <p className="text-xs font-mono text-foreground">
                      {gap.fromPoint.latitude.toFixed(4)}, {gap.fromPoint.longitude.toFixed(4)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </button>
        );
      })}
      {!showAll && gaps.length > display.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 font-mono transition-colors"
        >
          Show all {gaps.length} gaps (including {gaps.length - significantGaps.length} minor) ↓
        </button>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type DateRange = "7d" | "30d" | "90d" | "custom";

export default function MovementPatterns() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const { data: invites, isLoading: invitesLoading } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) } },
  );

  const accepted = (invites ?? []).filter((inv: Invite) => inv.status === "accepted");
  const latestPerPhone = accepted.reduce<Record<string, Invite>>((acc, inv) => {
    const ex = acc[inv.toPhone];
    if (!ex || (inv.grantedAt ?? inv.sentAt) > (ex.grantedAt ?? ex.sentAt)) acc[inv.toPhone] = inv;
    return acc;
  }, {});
  const contacts: Invite[] = Object.values(latestPerPhone);

  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-select first contact
  useEffect(() => {
    if (!selectedToken && contacts.length > 0) setSelectedToken(contacts[0].token);
  }, [contacts.length]);

  const buildDateParams = useCallback(() => {
    const now = new Date();
    if (dateRange === "7d") return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: now.toISOString() };
    if (dateRange === "30d") return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: now.toISOString() };
    if (dateRange === "90d") return { from: new Date(now.getTime() - 90 * 86400000).toISOString(), to: now.toISOString() };
    return { from: customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString(), to: customTo ? new Date(customTo).toISOString() : now.toISOString() };
  }, [dateRange, customFrom, customTo]);

  const fetchAnalysis = useCallback(async () => {
    if (!selectedToken) return;
    setLoading(true);
    try {
      const { from, to } = buildDateParams();
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`${API_BASE}/api/location/movement-analysis/${selectedToken}?${params}`);
      if (res.ok) {
        setResult(await res.json());
      } else {
        toast({ title: "Analysis failed", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [selectedToken, buildDateParams]);

  useEffect(() => { fetchAnalysis(); }, [fetchAnalysis]);

  const daysBack = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90
    : customFrom ? Math.ceil((new Date().getTime() - new Date(customFrom).getTime()) / 86400000) : 30;

  const gaps = (result?.segments ?? []).filter((s): s is GapSegment => s.type === "gap");
  const realSegs = (result?.segments ?? []).filter((s): s is RealSegment => s.type === "real");

  if (invitesLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md" />
        {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <MapCloudReveal />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" />
            Movement Patterns
          </h1>
          <p className="text-muted-foreground mt-1">
            Reconstructed historical movement across weeks and months — including offline gaps, airplane mode, and signal loss.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAnalysis} disabled={loading} className="gap-2">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="bg-muted p-5 rounded-full mb-5">
            <Route size={36} className="text-muted-foreground opacity-40" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No contacts tracked yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Once a contact accepts your invite and starts sharing their location, their movement patterns appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-2 min-w-[200px]">
              <User size={14} className="text-muted-foreground flex-shrink-0" />
              <select
                value={selectedToken ?? ""}
                onChange={(e) => setSelectedToken(e.target.value)}
                className="bg-transparent text-sm text-foreground font-medium flex-1 outline-none cursor-pointer"
              >
                {contacts.map((c) => (
                  <option key={c.token} value={c.token} className="bg-background">
                    {c.toName ?? c.toPhone}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range pills */}
            <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-xl p-1">
              {(["7d", "30d", "90d", "custom"] as DateRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-all ${
                    dateRange === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r === "7d" ? "7 days" : r === "30d" ? "30 days" : r === "90d" ? "90 days" : "Custom"}
                </button>
              ))}
            </div>

            {dateRange === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none"
                />
              </div>
            )}
          </div>

          {/* Summary stats */}
          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: <Navigation size={16} />, value: fmtKm(result.summary.totalRealKm), label: "Tracked distance", color: "text-indigo-400" },
                { icon: <CalendarDays size={16} />, value: result.summary.activeDays.toString(), label: "Active days", color: "text-emerald-400" },
                { icon: <WifiOff size={16} />, value: result.summary.totalGaps.toString(), label: "Signal gaps", color: "text-amber-400" },
                { icon: <Clock size={16} />, value: fmtDuration(result.summary.longestGapMinutes), label: "Longest gap", color: "text-red-400" },
              ].map((s) => (
                <Card key={s.label} className="border-border/60">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`${s.color} opacity-80`}>{s.icon}</div>
                    <div>
                      <p className="text-base font-bold text-foreground leading-tight">{loading ? "—" : s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Offline time callout */}
          {result && result.summary.gapTotalMinutes > 60 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-300">
                <span className="font-semibold">{fmtDuration(result.summary.gapTotalMinutes)} of untracked time</span>
                {" "}detected across {result.summary.totalGaps} gap{result.summary.totalGaps !== 1 ? "s" : ""}.
                Dashed lines on the map show interpolated straight-line paths between the last known and first known positions on either side of each gap.
              </div>
            </div>
          )}

          {/* Pattern map */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <MapPin size={13} /> Reconstructed Trail
              {result && (
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
                  — {realSegs.length} real segment{realSegs.length !== 1 ? "s" : ""}, {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
                </span>
              )}
            </h2>
            {loading ? (
              <div className="w-full rounded-xl bg-muted/40 border border-border animate-pulse" style={{ height: 380 }} />
            ) : (
              <PatternMap segments={result?.segments ?? []} />
            )}
          </div>

          {/* Calendar heatmap */}
          {result && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <CalendarDays size={13} /> Daily Activity — Last {daysBack} Days
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
                  ({result.summary.activeDays} active days, {result.summary.totalPoints.toLocaleString()} total GPS points)
                </span>
              </h2>
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <CalendarHeatmap dailyCounts={result.dailyCounts} daysBack={daysBack} />
              </div>
            </div>
          )}

          {/* Real segments list */}
          {result && realSegs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Zap size={13} /> Tracking Sessions ({realSegs.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {realSegs.map((seg, i) => (
                  <div key={i} className="rounded-xl border border-border/60 bg-card px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        <span className="text-xs font-mono text-foreground font-semibold">
                          {format(new Date(seg.startTime), "MMM d, HH:mm")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                        <span>{seg.points.length} pts</span>
                        <span>·</span>
                        <span>{fmtKm(seg.distanceKm)}</span>
                        <span>·</span>
                        <span>{fmtDuration(seg.durationMinutes)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gap intelligence */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <WifiOff size={13} /> Signal Gap Analysis
              {gaps.length > 0 && (
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
                  ({gaps.filter(g => g.severity !== "minor").length} significant, {gaps.filter(g => g.severity === "minor").length} minor)
                </span>
              )}
            </h2>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
              </div>
            ) : (
              <GapList gaps={gaps} />
            )}
          </div>

          {/* Info footer */}
          <div className="rounded-xl border border-border/40 bg-muted/20 p-4 flex items-start gap-3 text-xs text-muted-foreground">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <p>
              Gap interpolation draws a straight line between the last known and first known positions on either side of each gap.
              Real movement during a gap may have followed any path — the interpolated line is an estimate only.
              Gaps under 5 minutes are treated as normal GPS sampling intervals and are not shown.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
