/**
 * Signal Fusion — correlates location data across multiple independent
 * sources (GPS, Wi-Fi, cellular, Bluetooth, payment timestamps, vehicle
 * telematics) to produce a continuous timeline even when any single
 * source is incomplete or deliberately obscured.
 */
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Layers, User, RefreshCw, ChevronDown, ChevronUp, Info,
  ShieldAlert, Wifi, Radio, Bluetooth, CreditCard, Car,
  Satellite, MapPin, AlertTriangle, CheckCircle2, HelpCircle,
  Upload, X, Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { MapCloudReveal } from "@/components/map-cloud-reveal";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = "gps" | "wifi" | "cellular" | "bluetooth" | "payment" | "telematics" | "manual";

interface FusedPoint {
  bucketTs: string;
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  fusedFrom: string[];
  signalCount: number;
  multiSourceAgreement: boolean;
  tag: "confirmed" | "inferred" | "temporal-only";
  label: string | null;
}

interface GapRecord {
  startTime: string;
  endTime: string;
  gapMinutes: number;
  availableSources: string[];
  obscured: boolean;
  obscuredReason: string | null;
}

interface SourceStat {
  count: number;
  withCoords: number;
  avgConfidence: number;
}

interface FusedResult {
  fusedTimeline: FusedPoint[];
  sourceSummary: Record<string, SourceStat>;
  gaps: GapRecord[];
  obscuredPeriods: GapRecord[];
  totalSignals: number;
  dateFrom: string;
  dateTo: string;
}

// ── Source metadata ───────────────────────────────────────────────────────────

const SOURCE_META: Record<SourceType, { label: string; color: string; icon: React.ReactNode; confidence: number; description: string }> = {
  gps:        { label: "GPS",          color: "#6366f1", icon: <Satellite  size={13} />, confidence: 0.95, description: "Device GPS fix — highest accuracy" },
  telematics: { label: "Telematics",   color: "#10b981", icon: <Car        size={13} />, confidence: 0.85, description: "Vehicle OBD / telematics feed" },
  wifi:       { label: "Wi-Fi",        color: "#3b82f6", icon: <Wifi       size={13} />, confidence: 0.65, description: "Wi-Fi BSSID / SSID geolocation" },
  cellular:   { label: "Cellular",     color: "#f59e0b", icon: <Radio      size={13} />, confidence: 0.50, description: "Cell-tower triangulation" },
  bluetooth:  { label: "Bluetooth",    color: "#8b5cf6", icon: <Bluetooth  size={13} />, confidence: 0.40, description: "BLE beacon proximity" },
  payment:    { label: "Payment",      color: "#ec4899", icon: <CreditCard size={13} />, confidence: 0.30, description: "Transaction timestamp + merchant address" },
  manual:     { label: "Manual",       color: "#6b7280", icon: <MapPin     size={13} />, confidence: 0.70, description: "Operator-entered observation" },
};

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (minutes < 1440) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(minutes / 1440), rh = Math.floor((minutes % 1440) / 60);
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "#10b981" : value >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Multi-track timeline strip ────────────────────────────────────────────────

function TimelineStrip({
  fusedTimeline,
  sourceSummary,
  gaps,
}: {
  fusedTimeline: FusedPoint[];
  sourceSummary: Record<string, SourceStat>;
  gaps: GapRecord[];
}) {
  if (fusedTimeline.length === 0) return null;

  const sources = Object.keys(SOURCE_META).filter((s) => sourceSummary[s]);
  const tMin = new Date(fusedTimeline[0].bucketTs).getTime();
  const tMax = new Date(fusedTimeline[fusedTimeline.length - 1].bucketTs).getTime();
  const span = tMax - tMin || 1;

  const pct = (ts: string) => ((new Date(ts).getTime() - tMin) / span) * 100;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3 overflow-x-auto">
      {/* Fused confidence track */}
      <div>
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Fused confidence</p>
        <div className="relative h-6 bg-zinc-800 rounded-md overflow-hidden">
          {fusedTimeline.map((pt, i) => {
            const x = pct(pt.bucketTs);
            const color = pt.tag === "confirmed" ? "#6366f1" : pt.tag === "inferred" ? "#f59e0b" : "#6b7280";
            const opacity = 0.3 + pt.confidence * 0.7;
            return (
              <div
                key={i}
                title={`${format(new Date(pt.bucketTs), "MMM d HH:mm")} · ${pt.fusedFrom.join("+")} · ${Math.round(pt.confidence * 100)}%`}
                className="absolute top-0 bottom-0 w-1"
                style={{ left: `${x}%`, background: color, opacity }}
              />
            );
          })}
          {/* Gap markers */}
          {gaps.filter((g) => g.obscured).map((g, i) => {
            const x1 = pct(g.startTime);
            const x2 = pct(g.endTime);
            return (
              <div
                key={i}
                title={`⚠ Obscured gap ${fmtDuration(g.gapMinutes)}`}
                className="absolute top-0 bottom-0 bg-red-500/30 border-x border-red-500/60"
                style={{ left: `${x1}%`, width: `${Math.max(0.3, x2 - x1)}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* Per-source tracks */}
      {sources.map((src) => {
        const meta = SOURCE_META[src as SourceType];
        const srcPoints = fusedTimeline.filter((pt) => pt.fusedFrom.includes(src));
        return (
          <div key={src}>
            <div className="flex items-center gap-1.5 mb-1">
              <span style={{ color: meta.color }}>{meta.icon}</span>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{meta.label}</p>
              <span className="text-[9px] font-mono text-muted-foreground ml-auto">{sourceSummary[src]?.count ?? 0} signals</span>
            </div>
            <div className="relative h-3 bg-zinc-800 rounded-md overflow-hidden">
              {srcPoints.map((pt, i) => (
                <div
                  key={i}
                  title={format(new Date(pt.bucketTs), "MMM d HH:mm")}
                  className="absolute top-0 bottom-0 w-1 rounded-sm"
                  style={{ left: `${pct(pt.bucketTs)}%`, background: meta.color, opacity: 0.85 }}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Time axis labels */}
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground pt-1">
        <span>{format(new Date(fusedTimeline[0].bucketTs), "MMM d")}</span>
        <span>{format(new Date(fusedTimeline[Math.floor(fusedTimeline.length / 2)].bucketTs), "MMM d")}</span>
        <span>{format(new Date(fusedTimeline[fusedTimeline.length - 1].bucketTs), "MMM d")}</span>
      </div>
    </div>
  );
}

// ── Fusion Map ────────────────────────────────────────────────────────────────

function FusionMap({ fusedTimeline, gaps }: { fusedTimeline: FusedPoint[]; gaps: GapRecord[] }) {
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

    const positioned = fusedTimeline.filter((pt) => pt.latitude != null && pt.longitude != null);
    if (positioned.length === 0) return;

    const allLL: L.LatLng[] = [];

    // Draw polyline segments broken at gaps
    let currentRun: FusedPoint[] = [];
    const flushRun = () => {
      if (currentRun.length < 2) {
        if (currentRun.length === 1) {
          const pt = currentRun[0];
          const dot = L.circleMarker([pt.latitude!, pt.longitude!], {
            radius: 3, color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.8, weight: 1,
          }).addTo(map);
          layersRef.current.push(dot);
          allLL.push(L.latLng(pt.latitude!, pt.longitude!));
        }
        currentRun = [];
        return;
      }
      const lls = currentRun.map((p) => L.latLng(p.latitude!, p.longitude!));
      allLL.push(...lls);
      // Color by average confidence
      const avgConf = currentRun.reduce((s, p) => s + p.confidence, 0) / currentRun.length;
      const color = avgConf >= 0.8 ? "#6366f1" : avgConf >= 0.5 ? "#f59e0b" : "#6b7280";
      const line = L.polyline(lls, { color, weight: 3, opacity: 0.9 }).addTo(map);
      line.bindTooltip(
        `<span style="font-size:11px;font-family:monospace;">${currentRun[0].fusedFrom.join("+")} · ${Math.round(avgConf * 100)}% confidence</span>`,
        { sticky: true },
      );
      layersRef.current.push(line);
      currentRun = [];
    };

    // Build gap set for fast lookup
    const gapSet = new Set(gaps.map((g) => g.startTime));

    for (let i = 0; i < positioned.length; i++) {
      const pt = positioned[i];
      currentRun.push(pt);
      const nextPt = positioned[i + 1];
      if (!nextPt) { flushRun(); break; }

      const gapMs = new Date(nextPt.bucketTs).getTime() - new Date(pt.bucketTs).getTime();
      if (gapMs > 10 * 60 * 1000) {
        flushRun();
        // Draw gap bridge
        const isObscured = gaps.some(
          (g) => new Date(g.startTime).getTime() <= new Date(pt.bucketTs).getTime() + 60000 &&
                 new Date(g.endTime).getTime()   >= new Date(nextPt.bucketTs).getTime() - 60000 &&
                 g.obscured,
        );
        const bridgeColor = isObscured ? "#ef4444" : "#6b7280";
        const bridge = L.polyline(
          [[pt.latitude!, pt.longitude!], [nextPt.latitude!, nextPt.longitude!]],
          { color: bridgeColor, weight: 1.5, opacity: 0.5, dashArray: "6,6" },
        ).addTo(map);
        bridge.bindTooltip(
          `<span style="font-size:11px;font-family:monospace;">${isObscured ? "⚠ OBSCURED " : ""}gap ${fmtDuration(Math.round(gapMs / 60000))}</span>`,
          { sticky: true },
        );
        layersRef.current.push(bridge);
      }
    }

    // Start / end markers
    const first = positioned[0];
    const last  = positioned[positioned.length - 1];
    const mkIcon = (bg: string) => L.divIcon({
      className: "",
      html: `<div style="width:10px;height:10px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 0 0 3px ${bg}44;"></div>`,
      iconSize: [10, 10], iconAnchor: [5, 5],
    });
    layersRef.current.push(
      L.marker([first.latitude!, first.longitude!], { icon: mkIcon("#10b981") }).bindTooltip("🟢 Earliest").addTo(map),
      L.marker([last.latitude!,  last.longitude!],  { icon: mkIcon("#f59e0b") }).bindTooltip("🟡 Latest").addTo(map),
    );

    if (allLL.length === 1) map.setView(allLL[0], 15);
    else if (allLL.length > 1) map.fitBounds(L.latLngBounds(allLL).pad(0.06), { maxZoom: 16 });
  }, [fusedTimeline, gaps]);

  if (fusedTimeline.filter((p) => p.latitude != null).length === 0) {
    return (
      <div className="w-full rounded-xl bg-muted/40 border border-border flex items-center justify-center" style={{ height: 360 }}>
        <div className="text-center">
          <Layers size={32} className="text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">No positioned signals for this period</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div ref={mapRef} className="w-full rounded-xl overflow-hidden border border-border" style={{ height: 360, zIndex: 0 }} />
      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-indigo-500" /><span>High confidence (≥80%)</span></div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-amber-500" /><span>Medium (50–80%)</span></div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-zinc-500" /><span>Low (&lt;50%)</span></div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-red-500" style={{ borderStyle: "dashed" }} /><span>Obscured gap</span></div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-zinc-500" style={{ borderStyle: "dashed" }} /><span>Normal gap</span></div>
      </div>
    </div>
  );
}

// ── Ingest panel ──────────────────────────────────────────────────────────────

interface PendingSignal {
  sourceType: SourceType;
  latitude: string;
  longitude: string;
  label: string;
  observedAt: string;
  metadata: string;
}

function IngestPanel({ token, onIngested }: { token: string; onIngested: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signals, setSignals] = useState<PendingSignal[]>([{
    sourceType: "wifi", latitude: "", longitude: "", label: "", observedAt: new Date().toISOString().slice(0, 16), metadata: "",
  }]);

  const addRow = () => setSignals((s) => [...s, {
    sourceType: "wifi", latitude: "", longitude: "", label: "", observedAt: new Date().toISOString().slice(0, 16), metadata: "",
  }]);

  const removeRow = (i: number) => setSignals((s) => s.filter((_, idx) => idx !== i));

  const updateRow = (i: number, key: keyof PendingSignal, val: string) =>
    setSignals((s) => s.map((r, idx) => idx === i ? { ...r, [key]: val } : r));

  const submit = async () => {
    const valid = signals.filter((s) => s.observedAt);
    if (!valid.length) { toast({ title: "No valid signals", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const payload = valid.map((s) => ({
        sourceType: s.sourceType,
        latitude:   s.latitude ? parseFloat(s.latitude) : undefined,
        longitude:  s.longitude ? parseFloat(s.longitude) : undefined,
        label:      s.label || undefined,
        observedAt: new Date(s.observedAt).toISOString(),
        metadata:   s.metadata ? (() => { try { return JSON.parse(s.metadata); } catch { return { raw: s.metadata }; } })() : undefined,
      }));
      const res = await fetch(`${API_BASE}/api/signals/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signals: payload }),
      });
      if (res.ok) {
        const r = await res.json();
        toast({ title: `${r.inserted} signal${r.inserted !== 1 ? "s" : ""} ingested` });
        setOpen(false);
        onIngested();
      } else {
        const e = await res.json().catch(() => ({}));
        toast({ title: "Ingest failed", description: e.error ?? "Unknown error", variant: "destructive" });
      }
    } finally { setLoading(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Upload size={13} /> Ingest Signals
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Ingest Signals</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>
      <p className="text-xs text-muted-foreground">Add non-GPS signals (Wi-Fi, cellular, Bluetooth, payment, telematics) to enrich the fused timeline.</p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {signals.map((sig, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <select
              value={sig.sourceType}
              onChange={(e) => updateRow(i, "sourceType", e.target.value)}
              className="col-span-2 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none"
            >
              {Object.entries(SOURCE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input
              placeholder="Lat"
              value={sig.latitude}
              onChange={(e) => updateRow(i, "latitude", e.target.value)}
              className="col-span-2 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <input
              placeholder="Lng"
              value={sig.longitude}
              onChange={(e) => updateRow(i, "longitude", e.target.value)}
              className="col-span-2 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <input
              placeholder="Label / merchant"
              value={sig.label}
              onChange={(e) => updateRow(i, "label", e.target.value)}
              className="col-span-3 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <input
              type="datetime-local"
              value={sig.observedAt}
              onChange={(e) => updateRow(i, "observedAt", e.target.value)}
              className="col-span-2 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none"
            />
            <button onClick={() => removeRow(i)} className="col-span-1 text-muted-foreground hover:text-destructive flex items-center justify-center"><X size={12} /></button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="flex items-center gap-1 text-xs text-primary hover:underline font-mono">
          <Plus size={11} /> Add row
        </button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={loading} className="gap-2">
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
          Ingest {signals.length} signal{signals.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type DateRange = "7d" | "30d" | "90d" | "custom";

export default function SignalFusion() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const { data: invites, isLoading: invitesLoading } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) } },
  );

  const accepted = (invites ?? []).filter((inv: Invite) => inv.status === "accepted");
  const contacts: Invite[] = Object.values(
    accepted.reduce<Record<string, Invite>>((acc, inv) => {
      const ex = acc[inv.toPhone];
      if (!ex || (inv.grantedAt ?? inv.sentAt) > (ex.grantedAt ?? ex.sentAt)) acc[inv.toPhone] = inv;
      return acc;
    }, {}),
  );

  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [result, setResult] = useState<FusedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGap, setExpandedGap] = useState<number | null>(null);
  const [showAllGaps, setShowAllGaps] = useState(false);

  useEffect(() => {
    if (!selectedToken && contacts.length > 0) setSelectedToken(contacts[0].token);
  }, [contacts.length]);

  const buildParams = useCallback(() => {
    const now = new Date();
    if (dateRange === "7d")  return { from: new Date(now.getTime() - 7  * 86400000).toISOString(), to: now.toISOString() };
    if (dateRange === "30d") return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: now.toISOString() };
    if (dateRange === "90d") return { from: new Date(now.getTime() - 90 * 86400000).toISOString(), to: now.toISOString() };
    return {
      from: customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString(),
      to:   customTo   ? new Date(customTo).toISOString()   : now.toISOString(),
    };
  }, [dateRange, customFrom, customTo]);

  const fetchFused = useCallback(async () => {
    if (!selectedToken) return;
    setLoading(true);
    try {
      const { from, to } = buildParams();
      const res = await fetch(`${API_BASE}/api/signals/fused/${selectedToken}?${new URLSearchParams({ from, to })}`);
      if (res.ok) setResult(await res.json());
      else toast({ title: "Fusion failed", variant: "destructive" });
    } finally { setLoading(false); }
  }, [selectedToken, buildParams]);

  useEffect(() => { fetchFused(); }, [fetchFused]);

  const sourceOrder: SourceType[] = ["gps", "telematics", "wifi", "cellular", "bluetooth", "payment", "manual"];
  const activeSources = sourceOrder.filter((s) => result?.sourceSummary[s]);
  const confirmedPts  = result?.fusedTimeline.filter((p) => p.tag === "confirmed").length ?? 0;
  const inferredPts   = result?.fusedTimeline.filter((p) => p.tag === "inferred").length ?? 0;
  const obscuredCount = result?.obscuredPeriods.length ?? 0;
  const displayGaps   = showAllGaps ? (result?.gaps ?? []) : (result?.gaps ?? []).filter((g) => g.gapMinutes > 30 || g.obscured).slice(0, 15);

  if (invitesLoading) return (
    <div className="space-y-6">
      <div className="h-8 w-64 bg-muted animate-pulse rounded-md" />
      {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <MapCloudReveal />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Layers className="h-7 w-7 text-primary" />
            Signal Fusion
          </h1>
          <p className="text-muted-foreground mt-1">
            Correlates GPS, Wi-Fi, cellular, Bluetooth, payment timestamps and telematics into one continuous timeline — including gaps where location was deliberately obscured.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchFused} disabled={loading} className="gap-2">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="bg-muted p-5 rounded-full mb-5"><Layers size={36} className="text-muted-foreground opacity-40" /></div>
          <h3 className="text-xl font-semibold mb-2">No contacts tracked yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">Accept an invite first to start correlating location signals.</p>
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
                  <option key={c.token} value={c.token} className="bg-background">{c.toName ?? c.toPhone}</option>
                ))}
              </select>
            </div>

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
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none" />
                <span className="text-xs text-muted-foreground">→</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground outline-none" />
              </div>
            )}

            {selectedToken && (
              <IngestPanel token={selectedToken} onIngested={fetchFused} />
            )}
          </div>

          {/* Summary stats */}
          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: <Layers size={16} />,       value: result.totalSignals.toLocaleString(), label: "Total signals",      color: "text-indigo-400" },
                { icon: <CheckCircle2 size={16} />,  value: confirmedPts.toLocaleString(),        label: "Confirmed points",   color: "text-emerald-400" },
                { icon: <HelpCircle size={16} />,    value: inferredPts.toLocaleString(),          label: "Inferred points",    color: "text-amber-400" },
                { icon: <ShieldAlert size={16} />,   value: obscuredCount.toString(),              label: "Obscured gaps",      color: obscuredCount > 0 ? "text-red-400" : "text-muted-foreground" },
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

          {/* Obscured alert */}
          {result && obscuredCount > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
              <ShieldAlert size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-300">
                <span className="font-semibold">{obscuredCount} deliberately obscured period{obscuredCount !== 1 ? "s" : ""} detected.</span>{" "}
                Non-GPS signals (cellular, Wi-Fi, Bluetooth, or payment activity) were present during these gaps, indicating the device was active
                but location services were intentionally disabled.
              </div>
            </div>
          )}

          {/* Source breakdown */}
          {result && activeSources.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Layers size={13} /> Signal Sources ({activeSources.length} active)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeSources.map((src) => {
                  const meta = SOURCE_META[src];
                  const stat = result.sourceSummary[src];
                  return (
                    <div key={src} className="rounded-xl border border-border/60 bg-card px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span style={{ color: meta.color }}>{meta.icon}</span>
                        <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                        <Badge className="ml-auto text-[9px] py-0 h-4 font-mono bg-muted text-muted-foreground border-0">
                          {stat.count} signals
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-2">{meta.description}</p>
                      <ConfBar value={stat.avgConfidence} />
                      <p className="text-[10px] font-mono text-muted-foreground mt-1">
                        {stat.withCoords} positioned · {stat.count - stat.withCoords} temporal-only
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Multi-track timeline strip */}
          {result && result.fusedTimeline.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Radio size={13} /> Multi-Source Timeline
              </h2>
              {loading ? (
                <div className="h-40 bg-muted animate-pulse rounded-xl" />
              ) : (
                <TimelineStrip fusedTimeline={result.fusedTimeline} sourceSummary={result.sourceSummary} gaps={result.gaps} />
              )}
            </div>
          )}

          {/* Fusion map */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <MapPin size={13} /> Fused Position Map
            </h2>
            {loading ? (
              <div className="w-full rounded-xl bg-muted/40 border border-border animate-pulse" style={{ height: 360 }} />
            ) : (
              <FusionMap fusedTimeline={result?.fusedTimeline ?? []} gaps={result?.gaps ?? []} />
            )}
          </div>

          {/* Ingest panel (for contacts with data) */}
          {selectedToken && result && result.totalSignals > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Upload size={13} /> Add Signals
              </h2>
              <IngestPanel token={selectedToken} onIngested={fetchFused} />
            </div>
          )}

          {/* Gap & obscured list */}
          {result && result.gaps.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle size={13} /> Gap Intelligence
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
                  ({result.gaps.length} gaps · {result.obscuredPeriods.length} obscured)
                </span>
              </h2>
              <div className="space-y-2">
                {displayGaps.map((gap, i) => {
                  const isExp = expandedGap === i;
                  return (
                    <button key={i} onClick={() => setExpandedGap(isExp ? null : i)} className="w-full text-left">
                      <div className={`rounded-xl border px-4 py-3 hover:border-primary/30 transition-all ${
                        gap.obscured ? "border-red-500/40 bg-red-500/5" : "border-border/60 bg-card"
                      }`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {gap.obscured
                              ? <ShieldAlert size={13} className="text-red-400 flex-shrink-0" />
                              : <AlertTriangle size={13} className="text-amber-500/60 flex-shrink-0" />
                            }
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold font-mono text-foreground">{fmtDuration(gap.gapMinutes)}</span>
                                {gap.obscured && (
                                  <Badge className="text-[9px] py-0 h-4 bg-red-500/15 text-red-400 border border-red-500/30">OBSCURED</Badge>
                                )}
                                {gap.availableSources.length > 0 && (
                                  <div className="flex gap-1">
                                    {gap.availableSources.map((s) => (
                                      <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {gap.obscuredReason && (
                                <p className="text-xs text-red-300/80 mt-0.5">{gap.obscuredReason}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                              {format(new Date(gap.startTime), "MMM d, HH:mm")}
                            </span>
                            {isExp ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                          </div>
                        </div>

                        {isExp && (
                          <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div><p className="text-[10px] text-muted-foreground">Gap started</p><p className="text-xs font-mono">{format(new Date(gap.startTime), "MMM d, HH:mm")}</p></div>
                            <div><p className="text-[10px] text-muted-foreground">Resumed</p><p className="text-xs font-mono">{format(new Date(gap.endTime), "MMM d, HH:mm")}</p></div>
                            <div><p className="text-[10px] text-muted-foreground">Duration</p><p className="text-xs font-mono">{fmtDuration(gap.gapMinutes)}</p></div>
                            <div><p className="text-[10px] text-muted-foreground">Signals in gap</p><p className="text-xs font-mono">{gap.availableSources.length > 0 ? gap.availableSources.join(", ") : "None"}</p></div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {!showAllGaps && result.gaps.length > displayGaps.length && (
                <button onClick={() => setShowAllGaps(true)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-3 font-mono transition-colors">
                  Show all {result.gaps.length} gaps ↓
                </button>
              )}
            </div>
          )}

          {/* Info */}
          <div className="rounded-xl border border-border/40 bg-muted/20 p-4 flex items-start gap-3 text-xs text-muted-foreground">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                <strong className="text-foreground/70">Confidence scoring:</strong>{" "}
                GPS signals carry 0.95 baseline confidence. When multiple independent sources agree within 500m, a bonus of up to +0.15 is applied.
                Positions below 0.60 are tagged <em>inferred</em>.
              </p>
              <p>
                <strong className="text-foreground/70">Obscured detection:</strong>{" "}
                A gap is flagged as deliberately obscured when non-GPS signals (Bluetooth, cellular, Wi-Fi, payment, or telematics) are active
                during a window where GPS was previously reporting — indicating location services were intentionally disabled rather than the device being off.
              </p>
              <p>
                <strong className="text-foreground/70">Adding signals:</strong>{" "}
                Use "Ingest Signals" to feed in Wi-Fi BSSID lookups, cell-tower data, BLE beacon hits, payment records, or vehicle telematics.
                Latitude/longitude are optional — temporal-only signals still anchor the timeline.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
