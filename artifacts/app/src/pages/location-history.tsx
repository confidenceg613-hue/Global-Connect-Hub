import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Clock, MapPin, User, Navigation, ChevronDown, BarChart3,
  ExternalLink, Copy, Wifi, WifiOff, Route, CalendarDays,
  Gauge, Timer, TrendingUp, RefreshCw, Download,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, differenceInMinutes, differenceInSeconds } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LocationUpdate {
  id: number;
  token: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: "active" | "offline";
  createdAt: string;
}

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

function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(2)}km`;
}

function computeStats(updates: LocationUpdate[]) {
  if (updates.length === 0) return { totalKm: 0, durationMin: 0, avgSpeedKmh: 0, updateCount: 0 };
  let totalKm = 0;
  for (let i = 1; i < updates.length; i++) {
    totalKm += haversineKm(
      updates[i - 1].latitude, updates[i - 1].longitude,
      updates[i].latitude, updates[i].longitude,
    );
  }
  const first = new Date(updates[0].createdAt);
  const last = new Date(updates[updates.length - 1].createdAt);
  const durationSec = differenceInSeconds(last, first);
  const durationMin = Math.round(durationSec / 60);
  const avgSpeedKmh = durationSec > 0 ? totalKm / (durationSec / 3600) : 0;
  return { totalKm, durationMin, avgSpeedKmh, updateCount: updates.length };
}

// ── Trail map component ──────────────────────────────────────────────────────
function TrailMap({ updates, contactName, isLive }: { updates: LocationUpdate[]; contactName: string; isLive: boolean }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, {
      center: [20, 0], zoom: 2, zoomControl: true, attributionControl: false,
    });
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 },
    ).addTo(map);
    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, opacity: 0.8 },
    ).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];
    if (updates.length === 0) return;

    const latlngs = updates.map((u) => [u.latitude, u.longitude] as [number, number]);

    // Trail polyline
    const line = L.polyline(latlngs, { color: "#6366f1", weight: 3, opacity: 0.85, dashArray: undefined }).addTo(map);
    layersRef.current.push(line);

    // Start marker (green)
    const startIcon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 3px rgba(16,185,129,0.35);"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const startM = L.marker(latlngs[0], { icon: startIcon })
      .bindTooltip(`<span style="font-size:11px;font-family:ui-monospace,monospace;">🟢 Start · ${format(new Date(updates[0].createdAt), "HH:mm:ss")}</span>`)
      .addTo(map);
    layersRef.current.push(startM);

    // End marker (red or pulse if the contact is currently live) — driven by
    // the independently-fetched live status, not the filtered updates list,
    // so it stays accurate even when the selected date range has stale data.
    const last = updates[updates.length - 1];
    const isActive = isLive;
    const endHtml = isActive
      ? `<div style="position:relative;width:16px;height:16px;">
           <div style="position:absolute;inset:0;border-radius:50%;background:#ef4444;opacity:0.4;animation:pl-pulse 1.4s ease-in-out infinite;"></div>
           <div style="position:absolute;inset:2px;border-radius:50%;background:#ef4444;border:2px solid #fff;"></div>
         </div>`
      : `<div style="width:14px;height:14px;border-radius:50%;background:#71717a;border:2px solid #fff;"></div>`;
    const endIcon = L.divIcon({ className: "", html: endHtml, iconSize: [16, 16], iconAnchor: [8, 8] });
    const endM = L.marker(latlngs[latlngs.length - 1], { icon: endIcon })
      .bindTooltip(`<span style="font-size:11px;font-family:ui-monospace,monospace;">${isActive ? "🔴 Live" : "⬜ Last"} · ${format(new Date(last.createdAt), "HH:mm:ss")}</span>`)
      .addTo(map);
    layersRef.current.push(endM);

    // Waypoints every ~20 points
    const step = Math.max(1, Math.floor(updates.length / 20));
    for (let i = step; i < updates.length - 1; i += step) {
      const u = updates[i];
      const dot = L.circleMarker([u.latitude, u.longitude], {
        radius: 3, color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.7, weight: 1,
      }).bindTooltip(
        `<span style="font-size:10px;font-family:ui-monospace,monospace;">${format(new Date(u.createdAt), "HH:mm:ss")}</span>`,
        { direction: "top" },
      ).addTo(map);
      layersRef.current.push(dot);
    }

    // Fit
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2), { maxZoom: 16 });
    }
  }, [updates]);

  // Add pulse keyframe once
  useEffect(() => {
    const id = "ph-trail-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `@keyframes pl-pulse{0%,100%{transform:scale(1);opacity:0.4;}50%{transform:scale(1.6);opacity:0.1;}}`;
    document.head.appendChild(s);
  }, []);

  if (updates.length === 0) {
    return (
      <div className="w-full rounded-xl bg-muted/40 border border-border flex items-center justify-center" style={{ height: 320 }}>
        <div className="text-center">
          <Route size={32} className="text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">No trail data for this period</p>
        </div>
      </div>
    );
  }

  return <div ref={mapRef} className="w-full rounded-xl overflow-hidden border border-border" style={{ height: 320, zIndex: 0 }} />;
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function LocationHistory() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const { data: invites, isLoading: invitesLoading } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) } },
  );

  const accepted = (invites ?? []).filter((inv: Invite) => inv.status === "accepted");

  // Latest accepted invite per phone (for the contact picker)
  const latestPerPhone = accepted.reduce<Record<string, Invite>>((acc: Record<string, Invite>, inv: Invite) => {
    const ex = acc[inv.toPhone];
    if (!ex || (inv.grantedAt ?? inv.sentAt) > (ex.grantedAt ?? ex.sentAt)) acc[inv.toPhone] = inv;
    return acc;
  }, {});
  const contacts: Invite[] = Object.values(latestPerPhone);

  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<"today" | "24h" | "7d" | "all">("today");
  const [updates, setUpdates] = useState<LocationUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(25);
  const TIMELINE_PAGE_SIZE = 25;
  // True current online/offline state, fetched independently of the date filter —
  // the last item in a filtered `updates` window (e.g. "Today") can be empty even
  // while the device is actively sharing right now, which previously made the
  // badge wrongly show "Offline".
  const [liveStatus, setLiveStatus] = useState<{ status: "active" | "offline"; createdAt: string } | null>(null);

  // Auto-select first contact
  useEffect(() => {
    if (!selectedToken && contacts.length > 0) {
      setSelectedToken(contacts[0].token);
    }
  }, [contacts.length]);

  const fetchHistory = useCallback(async () => {
    if (!selectedToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const now = new Date();
      if (dateFilter === "today") {
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        params.set("from", start.toISOString());
      } else if (dateFilter === "24h") {
        params.set("from", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      } else if (dateFilter === "7d") {
        params.set("from", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
      }
      const res = await fetch(`${API_BASE}/api/location/history/${selectedToken}?${params}`);
      if (res.ok) setUpdates(await res.json());
    } finally {
      setLoading(false);
    }
  }, [selectedToken, dateFilter]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Reset pagination whenever the contact or date range changes so we don't
  // carry over a stale "load more" position from a different data set.
  useEffect(() => {
    setVisibleCount(TIMELINE_PAGE_SIZE);
    setExpandedIdx(null);
  }, [selectedToken, dateFilter]);

  const fetchLiveStatus = useCallback(async () => {
    if (!selectedToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/location/latest/${selectedToken}`);
      if (res.ok) {
        const data = await res.json();
        setLiveStatus({ status: data.status, createdAt: data.createdAt });
      } else {
        setLiveStatus(null);
      }
    } catch {
      setLiveStatus(null);
    }
  }, [selectedToken]);

  useEffect(() => { fetchLiveStatus(); }, [fetchLiveStatus]);

  // Poll for the true live/offline state every 15s so the badge stays accurate
  // even when the selected date filter has no fresh points in it.
  useEffect(() => {
    if (!selectedToken) return;
    const id = setInterval(fetchLiveStatus, 15_000);
    return () => clearInterval(id);
  }, [selectedToken, fetchLiveStatus]);

  const isLive = liveStatus?.status === "active";

  const selectedContact = contacts.find((c) => c.token === selectedToken);
  const stats = computeStats(updates);

  // Segment updates into "active" runs separated by offline gaps
  const segments: LocationUpdate[][] = [];
  if (updates.length > 0) {
    let seg: LocationUpdate[] = [updates[0]];
    for (let i = 1; i < updates.length; i++) {
      const gapSec = differenceInSeconds(new Date(updates[i].createdAt), new Date(updates[i - 1].createdAt));
      if (gapSec > 120 || updates[i - 1].status === "offline") {
        segments.push(seg);
        seg = [updates[i]];
      } else {
        seg.push(updates[i]);
      }
    }
    segments.push(seg);
  }

  // Timeline is paginated (newest-first) rather than downsampled, so every
  // single GPS point is reachable via "Load more" instead of skipping points.
  const updatesDesc = [...updates].reverse();
  const timelinePoints: LocationUpdate[] = updatesDesc.slice(0, visibleCount);
  const hasMoreTimeline = visibleCount < updatesDesc.length;

  const copyCoords = (u: LocationUpdate) => {
    navigator.clipboard.writeText(`${u.latitude.toFixed(6)}, ${u.longitude.toFixed(6)}`)
      .then(() => toast({ title: "Coordinates copied" }));
  };

  const exportCsv = () => {
    if (updates.length === 0) {
      toast({ title: "Nothing to export", description: "No GPS points in the current range.", variant: "destructive" });
      return;
    }
    const header = ["timestamp", "latitude", "longitude", "accuracy_m", "status", "address"];
    const rows = updates.map((u) => [
      u.createdAt,
      u.latitude.toFixed(6),
      u.longitude.toFixed(6),
      u.accuracy != null ? Math.round(u.accuracy).toString() : "",
      u.status,
      u.address ? `"${u.address.replace(/"/g, '""')}"` : "",
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const contactSlug = (selectedContact?.toName ?? selectedContact?.toPhone ?? "contact").replace(/[^a-z0-9]+/gi, "-");
    a.href = url;
    a.download = `location-history-${contactSlug}-${dateFilter}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Export ready", description: `Downloaded ${updates.length} GPS points as CSV.` });
  };

  if (invitesLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md" />
        {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Route className="h-7 w-7 text-primary" />
            Location History
          </h1>
          <p className="text-muted-foreground mt-1">Full GPS trail — every position update from live tracking.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || updates.length === 0} className="gap-2">
            <Download size={13} />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchHistory} disabled={loading} className="gap-2">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="bg-muted p-5 rounded-full mb-5">
            <Clock size={36} className="text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No tracking history yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Once a contact accepts your invite and starts sharing their live location, every GPS update appears here as a full trail.
          </p>
        </div>
      ) : (
        <>
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Contact picker */}
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

            {/* Date filter pills */}
            <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-xl p-1">
              {(["today", "24h", "7d", "all"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setDateFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-all ${
                    dateFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "today" ? "Today" : f === "24h" ? "24h" : f === "7d" ? "7 days" : "All time"}
                </button>
              ))}
            </div>

            {selectedContact && (
              <Badge
                className={`gap-1.5 font-mono text-xs ${
                  isLive
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`} />
                {isLive ? "Live" : "Offline"}
              </Badge>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: <Navigation size={16} />, value: formatDist(stats.totalKm), label: "Distance", color: "text-primary" },
              { icon: <Timer size={16} />, value: stats.durationMin < 60 ? `${stats.durationMin}m` : `${(stats.durationMin / 60).toFixed(1)}h`, label: "Duration", color: "text-purple-400" },
              { icon: <Gauge size={16} />, value: `${stats.avgSpeedKmh.toFixed(1)} km/h`, label: "Avg speed", color: "text-amber-400" },
              { icon: <TrendingUp size={16} />, value: stats.updateCount.toLocaleString(), label: "GPS points", color: "text-emerald-400" },
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

          {/* Trail map */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <MapPin size={13} /> Route Trail — {selectedContact?.toName ?? selectedContact?.toPhone}
            </h2>
            {loading ? (
              <div className="w-full rounded-xl bg-muted/40 border border-border animate-pulse" style={{ height: 320 }} />
            ) : (
              <TrailMap updates={updates} contactName={selectedContact?.toName ?? selectedContact?.toPhone ?? ""} isLive={isLive} />
            )}
          </div>

          {/* Session segments */}
          {segments.length > 1 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <CalendarDays size={13} /> Sessions ({segments.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {segments.map((seg, i) => {
                  const isActive = seg[seg.length - 1].status === "active";
                  const dur = differenceInMinutes(
                    new Date(seg[seg.length - 1].createdAt),
                    new Date(seg[0].createdAt),
                  );
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border text-xs font-mono ${
                        isActive
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-muted/40 border-border text-muted-foreground"
                      }`}
                    >
                      {isActive ? <Wifi size={10} /> : <WifiOff size={10} />}
                      {format(new Date(seg[0].createdAt), "HH:mm")} – {format(new Date(seg[seg.length - 1].createdAt), "HH:mm")}
                      <span className="opacity-60">({dur}m · {seg.length} pts)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Waypoint timeline */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock size={13} /> Waypoint Timeline
              {timelinePoints.length < updates.length && (
                <span className="text-xs font-normal text-muted-foreground normal-case tracking-normal">
                  (showing {timelinePoints.length} of {updates.length} points, newest first)
                </span>
              )}
            </h2>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
              </div>
            ) : timelinePoints.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No waypoints for this period. Start live tracking to record a trail.
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-2">
                  {timelinePoints.map((u, idx) => {
                    // timelinePoints is newest-first, so idx 0 is always the latest point.
                    // "Start" only applies once every point has actually been loaded.
                    const isLast = idx === 0;
                    const isFirst = !hasMoreTimeline && idx === timelinePoints.length - 1;
                    const isOffline = u.status === "offline";
                    const distFromPrev = idx < timelinePoints.length - 1
                      ? haversineKm(timelinePoints[idx + 1].latitude, timelinePoints[idx + 1].longitude, u.latitude, u.longitude)
                      : null;
                    const expanded = expandedIdx === idx;

                    return (
                      <div key={u.id} className="relative pl-12">
                        {/* Timeline dot */}
                        <div className={`absolute left-[14px] top-3.5 w-3 h-3 rounded-full border-2 border-background ${
                          isOffline ? "bg-zinc-500" : isFirst || isLast ? "bg-primary" : "bg-muted-foreground/50"
                        } ${isLast && !isOffline ? "ring-2 ring-primary/30" : ""}`} />

                        <button
                          onClick={() => setExpandedIdx(expanded ? null : idx)}
                          className="w-full text-left"
                        >
                          <div className={`rounded-xl border px-4 py-2.5 transition-all hover:border-primary/30 ${
                            isOffline
                              ? "bg-zinc-900/40 border-zinc-800"
                              : isFirst || isLast
                              ? "bg-primary/5 border-primary/20"
                              : "bg-card border-border/60"
                          }`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                {isOffline
                                  ? <WifiOff size={12} className="text-zinc-500 flex-shrink-0" />
                                  : <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLast && !isOffline ? "bg-emerald-400 animate-pulse" : "bg-primary/60"}`} />
                                }
                                <span className="text-xs font-mono text-foreground font-semibold">
                                  {format(new Date(u.createdAt), "HH:mm:ss")}
                                </span>
                                {isOffline && <Badge variant="outline" className="text-[9px] py-0 h-4 border-zinc-700 text-zinc-500">GPS off</Badge>}
                                {isFirst && !isOffline && <Badge variant="outline" className="text-[9px] py-0 h-4 border-emerald-700 text-emerald-500">Start</Badge>}
                                {isLast && !isFirst && !isOffline && <Badge variant="outline" className="text-[9px] py-0 h-4 border-primary/50 text-primary">Latest</Badge>}
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {distFromPrev !== null && distFromPrev > 0.005 && (
                                  <span className="text-[10px] font-mono text-muted-foreground">+{formatDist(distFromPrev)}</span>
                                )}
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {u.latitude.toFixed(5)}, {u.longitude.toFixed(5)}
                                </span>
                                <ChevronDown size={12} className={`text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                              </div>
                            </div>

                            {expanded && (
                              <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                                {u.address && (
                                  <p className="text-xs text-muted-foreground leading-relaxed">{u.address}</p>
                                )}
                                <div className="flex items-center gap-2 flex-wrap">
                                  {u.accuracy && (
                                    <span className="text-[10px] text-muted-foreground font-mono bg-muted rounded px-2 py-0.5">
                                      ±{Math.round(u.accuracy)}m accuracy
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyCoords(u); }}
                                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground font-mono bg-muted rounded px-2 py-0.5"
                                  >
                                    <Copy size={9} /> Copy coords
                                  </button>
                                  <a
                                    href={`https://www.google.com/maps?q=${u.latitude},${u.longitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 text-[10px] text-primary hover:underline font-mono bg-primary/10 rounded px-2 py-0.5"
                                  >
                                    <ExternalLink size={9} /> Google Maps
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
                {hasMoreTimeline && (
                  <div className="flex justify-center mt-4 pl-12">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleCount((c) => c + TIMELINE_PAGE_SIZE)}
                      className="gap-2"
                    >
                      Load more
                      <span className="text-xs text-muted-foreground font-mono">
                        ({updatesDesc.length - timelinePoints.length} remaining)
                      </span>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
