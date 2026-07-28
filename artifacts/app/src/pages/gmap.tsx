/**
 * /gmap — Group Map (GMap)
 *
 * Owner-only view. Shows live locations of all members who joined via a
 * Group Share link. Each member now has a real invite token and pushes
 * location to /api/location/push — so they appear on the main Live Map too,
 * trigger geofence alerts, push notifications, and send full telemetry.
 *
 * The GMap subscribes to /api/location/stream/:inviteToken per member,
 * exactly like the main Live Map does for individual invite tokens.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { motion, AnimatePresence } from "framer-motion";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { makeEagleMarker } from "@/lib/eagle-map-marker";
import { MapCloudReveal } from "@/components/map-cloud-reveal";
import {
  Users, Plus, Trash2, Copy, Check, Radio,
  MapPin, ChevronRight, Loader2, X, Battery, BatteryCharging,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupShare {
  id: number;
  groupId: string;
  ownerUserId: number;
  name: string;
  createdAt: string;
  memberCount: number;
}

interface GroupMember {
  id: number;
  memberToken: string;
  inviteToken: string | null;
  displayName: string | null;
  joinedAt: string;
  latest: {
    lat: number;
    lng: number;
    accuracy?: number | null;
    address?: string | null;
    status: "active" | "offline";
    timestamp: string | Date;
    batteryLevel?: number | null;
    batteryCharging?: boolean | null;
    activityType?: string | null;
  } | null;
}

interface MemberPos {
  memberToken: string;
  inviteToken: string | null;
  displayName: string | null;
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string;
  status: "active" | "offline";
  timestamp: string;
  batteryLevel?: number | null;
  batteryCharging?: boolean | null;
  activityType?: string | null;
}

// ─── Marker colours (cyclic) ──────────────────────────────────────────────────

const MEMBER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
];

function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

// ─── Copy-link button ─────────────────────────────────────────────────────────

function CopyLinkButton({ groupId }: { groupId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/group/${groupId}`;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea"); ta.value = url;
      ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 text-xs font-medium transition-all"
      title={url}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

// ─── Create-group modal ───────────────────────────────────────────────────────

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (g: GroupShare) => void }) {
  const { userId } = useAuth();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim() || !userId) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/group-shares`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim() }),
      });
      if (!r.ok) throw new Error("Failed to create");
      const g = await r.json() as GroupShare;
      onCreated({ ...g, memberCount: 0 });
      toast({ title: "Group share created!", description: `Share the link for "${g.name}"` });
      onClose();
    } catch { toast({ title: "Failed to create group", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92 }}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-foreground">New Group Share</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">Group name</label>
        <input type="text" placeholder="e.g. Family Trip, Team Check-in…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === "Enter" && handleCreate()} autoFocus
          className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm mb-5" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || loading}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GMapPage() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const colorMapRef = useRef<Map<string, string>>(new Map());
  const colorIndexRef = useRef(0);

  // Per-member SSE streams: memberToken → EventSource
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  // inviteToken → memberToken reverse lookup for SSE handlers
  const inviteToMemberRef = useRef<Map<string, string>>(new Map());

  const [groups, setGroups] = useState<GroupShare[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [memberPositions, setMemberPositions] = useState<Map<string, MemberPos>>(new Map());
  const [showCreate, setShowCreate] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);

  // ── Fetch group list ────────────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`${API_BASE}/api/group-shares?userId=${userId}`);
      if (!r.ok) return;
      setGroups(await r.json() as GroupShare[]);
    } catch { /* non-critical */ }
    finally { setLoadingGroups(false); }
  }, [userId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // ── Leaflet map init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, { center: [20, 0], zoom: 2, zoomControl: true });
    L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      subdomains: ["0", "1", "2", "3"], attribution: "© Google Maps", maxZoom: 20,
    }).addTo(map);
    mapRef.current = map;

    if (!document.getElementById("pl-gmap-styles")) {
      const s = document.createElement("style"); s.id = "pl-gmap-styles";
      s.textContent = `.pl-gmap-popup .leaflet-popup-content-wrapper{background:#111113!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:12px!important;box-shadow:0 16px 48px rgba(0,0,0,.7)!important;}.pl-gmap-popup .leaflet-popup-content{margin:12px!important;color:#f4f4f5!important;}.pl-gmap-popup .leaflet-popup-tip{background:#111113!important;}`;
      document.head.appendChild(s);
    }

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Helper: close all member SSE streams ────────────────────────────────
  const closeAllStreams = useCallback(() => {
    eventSourcesRef.current.forEach((es) => es.close());
    eventSourcesRef.current.clear();
    inviteToMemberRef.current.clear();
    setStreamConnected(false);
  }, []);

  // ── Helper: update/create a Leaflet marker for a member ─────────────────
  const upsertMarker = useCallback((pos: MemberPos) => {
    const map = mapRef.current;
    if (!map) return;
    if (pos.lat === 0 && pos.lng === 0) return;

    const { memberToken, displayName, lat, lng, address, batteryLevel, batteryCharging } = pos;

    if (!colorMapRef.current.has(memberToken)) {
      colorMapRef.current.set(memberToken, memberColor(colorIndexRef.current++));
    }
    const color = colorMapRef.current.get(memberToken)!;
    const label = displayName ?? "?";
    const lowBattery = batteryLevel != null && batteryLevel < 15 && !batteryCharging;

    const icon = makeEagleMarker(label, { accent: color, lowBattery });
    const popupHtml = `
      <div style="min-width:140px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${label}</div>
        ${address ? `<div style="font-size:11px;color:#a1a1aa;margin-bottom:4px">${address}</div>` : `<div style="font-size:11px;color:#a1a1aa;margin-bottom:4px">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`}
        ${batteryLevel != null ? `<div style="font-size:11px;color:${batteryLevel < 15 ? '#f87171' : '#a1a1aa'}">🔋 ${batteryLevel}%${batteryCharging ? " ⚡" : ""}</div>` : ""}
        ${pos.activityType ? `<div style="font-size:11px;color:#a1a1aa;margin-top:2px">${pos.activityType}</div>` : ""}
      </div>`;

    if (markersRef.current.has(memberToken)) {
      const marker = markersRef.current.get(memberToken)!;
      marker.setLatLng([lat, lng]);
      marker.setIcon(icon);
      marker.getPopup()?.setContent(popupHtml);
    } else {
      const marker = L.marker([lat, lng], { icon })
        .bindPopup(popupHtml, { className: "pl-gmap-popup" })
        .addTo(map);
      markersRef.current.set(memberToken, marker);
      if (markersRef.current.size === 1) map.setView([lat, lng], 13);
    }

    if (markersRef.current.size > 1) {
      const bounds = L.latLngBounds([...markersRef.current.values()].map((m) => m.getLatLng()));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, []);

  // ── Subscribe to SSE streams for a group's members ──────────────────────
  const subscribeToGroup = useCallback(async (groupId: string) => {
    if (!userId) return;
    setMembersLoading(true);

    try {
      const r = await fetch(`${API_BASE}/api/group-shares/${groupId}/members?userId=${userId}`);
      if (!r.ok) return;
      const members = await r.json() as GroupMember[];

      // Seed memberPositions from latest snapshot
      const initial = new Map<string, MemberPos>();
      for (const m of members) {
        if (!m.latest || m.latest.lat === 0 && m.latest.lng === 0) continue;
        const pos: MemberPos = {
          memberToken: m.memberToken,
          inviteToken: m.inviteToken,
          displayName: m.displayName,
          lat: m.latest.lat,
          lng: m.latest.lng,
          accuracy: m.latest.accuracy ?? undefined,
          address: m.latest.address ?? undefined,
          status: m.latest.status,
          timestamp: typeof m.latest.timestamp === "string" ? m.latest.timestamp : new Date(m.latest.timestamp).toISOString(),
          batteryLevel: m.latest.batteryLevel,
          batteryCharging: m.latest.batteryCharging,
          activityType: m.latest.activityType,
        };
        initial.set(m.memberToken, pos);
        upsertMarker(pos);
      }
      setMemberPositions(initial);

      // Open one SSE per member that has an inviteToken
      let connectedCount = 0;
      for (const m of members) {
        if (!m.inviteToken) continue;

        inviteToMemberRef.current.set(m.inviteToken, m.memberToken);

        const es = new EventSource(`${API_BASE}/api/location/stream/${m.inviteToken}`);
        eventSourcesRef.current.set(m.memberToken, es);

        es.onopen = () => {
          connectedCount++;
          if (connectedCount >= 1) setStreamConnected(true);
        };
        es.onerror = () => {};

        const memberToken = m.memberToken;
        const displayName = m.displayName;
        const inviteToken = m.inviteToken;

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data) as {
              lat: number; lng: number; accuracy?: number; address?: string;
              status: "active" | "offline"; timestamp: string;
            };

            const pos: MemberPos = {
              memberToken,
              inviteToken,
              displayName,
              lat: data.lat,
              lng: data.lng,
              accuracy: data.accuracy,
              address: data.address,
              status: data.status,
              timestamp: data.timestamp,
              // Telemetry comes through the sessions polling (not SSE broadcast),
              // so we preserve existing telemetry values on position updates.
              batteryLevel: undefined,
              batteryCharging: undefined,
              activityType: undefined,
            };

            setMemberPositions((prev) => {
              const existing = prev.get(memberToken);
              const merged: MemberPos = {
                ...pos,
                batteryLevel: existing?.batteryLevel ?? undefined,
                batteryCharging: existing?.batteryCharging ?? undefined,
                activityType: existing?.activityType ?? undefined,
              };
              const next = new Map(prev);
              next.set(memberToken, merged);
              return next;
            });

            upsertMarker({ ...pos, batteryLevel: initial.get(memberToken)?.batteryLevel });
          } catch { /* malformed event */ }
        };
      }
    } finally {
      setMembersLoading(false);
    }
  }, [userId, upsertMarker]);

  // ── Telemetry polling: enrich member positions with battery/activity ────
  // Sessions endpoint returns telemetry for all accepted invites owned by
  // this user — group member synthetic invites are included automatically.
  useEffect(() => {
    if (!userId || !selectedGroupId) return;
    let cancelled = false;

    const pollTelemetry = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/sessions?userId=${userId}`);
        if (!r.ok || cancelled) return;
        const rows: Array<{ token: string; batteryLevel: number | null; batteryCharging: boolean | null; activityType: string | null }> = await r.json();
        if (cancelled) return;

        // Build inviteToken → telemetry map
        const byToken = new Map(rows.map((row) => [row.token, row]));

        setMemberPositions((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [memberToken, pos] of next) {
            if (!pos.inviteToken) continue;
            const telemetry = byToken.get(pos.inviteToken);
            if (!telemetry) continue;
            const updated = { ...pos, batteryLevel: telemetry.batteryLevel, batteryCharging: telemetry.batteryCharging, activityType: telemetry.activityType };
            next.set(memberToken, updated);
            changed = true;
          }
          return changed ? next : prev;
        });
      } catch { /* non-critical */ }
    };

    pollTelemetry();
    const id = setInterval(pollTelemetry, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, selectedGroupId]);

  // ── When selected group changes: tear down old streams, load new ─────────
  useEffect(() => {
    closeAllStreams();
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    colorMapRef.current.clear();
    colorIndexRef.current = 0;
    setMemberPositions(new Map());

    if (!selectedGroupId || !userId) return;
    subscribeToGroup(selectedGroupId);

    return () => { closeAllStreams(); };
  }, [selectedGroupId, userId, closeAllStreams, subscribeToGroup]);

  // ── Delete group ────────────────────────────────────────────────────────
  const handleDelete = async (groupId: string, groupName: string) => {
    if (!confirm(`Delete "${groupName}"? All member sessions will end.`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/group-shares/${groupId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error();
      setGroups((gs) => gs.filter((g) => g.groupId !== groupId));
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      toast({ title: `"${groupName}" deleted` });
    } catch { toast({ title: "Failed to delete group", variant: "destructive" }); }
  };

  const activeMemberCount = [...memberPositions.values()].filter((m) => m.status === "active").length;

  const ACTIVITY_COLORS: Record<string, string> = { stationary: "#94a3b8", walking: "#60a5fa", running: "#fb923c", driving: "#34d399" };
  const ACTIVITY_ICONS: Record<string, string> = { stationary: "⏸️", walking: "🚶", running: "🏃", driving: "🚗" };

  return (
    <div className="flex flex-col gap-5">
      <MapCloudReveal />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-indigo-400" />
            GMap
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Group share sessions — participants appear on your Live Map too
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20">
          <Plus className="w-4 h-4" />
          New group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 min-h-[520px]">
        {/* ── Group list sidebar ── */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase px-1">Your groups</p>

          {loadingGroups ? (
            <div className="flex items-center justify-center h-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground/60">No groups yet</p>
              <button onClick={() => setShowCreate(true)} className="text-xs text-indigo-400 hover:underline mt-1">Create your first group →</button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {groups.map((g) => {
                const isSelected = selectedGroupId === g.groupId;
                return (
                  <div key={g.groupId} className={`rounded-xl border transition-all ${isSelected ? "border-indigo-500/50 bg-indigo-500/10" : "border-border bg-card hover:bg-secondary/50"}`}>
                    <button className="w-full flex items-center justify-between px-3 py-3 gap-2"
                      onClick={() => setSelectedGroupId(isSelected ? null : g.groupId)}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-indigo-500" : "bg-secondary"}`}>
                          <Users className={`w-3.5 h-3.5 ${isSelected ? "text-white" : "text-muted-foreground"}`} />
                        </div>
                        <div className="min-w-0 text-left">
                          <p className={`text-sm font-semibold truncate ${isSelected ? "text-indigo-400" : "text-foreground"}`}>{g.name}</p>
                          <p className="text-xs text-muted-foreground">{g.memberCount} member{g.memberCount !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSelected && streamConnected && (
                          <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isSelected ? "rotate-90 text-indigo-400" : ""}`} />
                      </div>
                    </button>

                    {isSelected && (
                      <div className="px-3 pb-3 flex items-center gap-2 flex-wrap">
                        <CopyLinkButton groupId={g.groupId} />
                        <button onClick={() => handleDelete(g.groupId, g.name)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Active member list */}
          {selectedGroupId && (
            <div className="mt-3">
              <p className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase px-1 mb-2">
                {membersLoading ? "Loading…" : `Active now (${activeMemberCount})`}
              </p>
              {membersLoading && <div className="flex items-center justify-center h-10"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
              <div className="space-y-1">
                {[...memberPositions.entries()].map(([token, pos], i) => {
                  const color = colorMapRef.current.get(token) ?? "#6366f1";
                  const label = pos.displayName ?? `Member ${i + 1}`;
                  return (
                    <div key={token}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border/60 cursor-pointer hover:bg-secondary/50 transition-colors"
                      onClick={() => { if (mapRef.current && pos.lat !== 0 && pos.lng !== 0) { mapRef.current.setView([pos.lat, pos.lng], 15); markersRef.current.get(token)?.openPopup(); } }}>
                      <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold" style={{ background: color }}>
                        {label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{label}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`text-[10px] ${pos.status === "active" ? "text-emerald-400" : "text-muted-foreground/60"}`}>
                            {pos.status === "active" ? "● Live" : "offline"}
                          </span>
                          {pos.batteryLevel != null && (
                            <span className={`flex items-center gap-0.5 text-[10px] font-mono ${pos.batteryLevel < 15 ? "text-red-400" : "text-muted-foreground"}`}>
                              {pos.batteryCharging ? <BatteryCharging className="w-2.5 h-2.5" /> : <Battery className="w-2.5 h-2.5" />}
                              {pos.batteryLevel}%
                            </span>
                          )}
                          {pos.activityType && (
                            <span className="text-[10px]" style={{ color: ACTIVITY_COLORS[pos.activityType] ?? "#94a3b8" }}>
                              {ACTIVITY_ICONS[pos.activityType] ?? ""} {pos.activityType}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Map panel ── */}
        <div className="relative rounded-2xl overflow-hidden border border-border bg-secondary/30 min-h-[400px]">
          {!selectedGroupId && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-background/80 backdrop-blur-sm">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
                <MapPin className="w-7 h-7 text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-foreground">Select a group to view live locations</p>
              <p className="text-xs text-muted-foreground">Group members also appear on your main Live Map</p>
            </div>
          )}

          {selectedGroupId && (
            <div className="absolute top-3 right-3 z-[1000]">
              <motion.div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg ${streamConnected ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400" : "bg-amber-500/20 border border-amber-500/30 text-amber-400"}`}
                animate={streamConnected ? { opacity: [0.8, 1, 0.8] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Radio className="w-3 h-3" />
                {streamConnected ? `${activeMemberCount} live` : "Connecting…"}
              </motion.div>
            </div>
          )}

          <div ref={mapContainerRef} className="w-full h-full min-h-[400px]" style={{ willChange: "transform" }} />
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">Group Share — everything an invite can do, for many people</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>→ <strong className="text-foreground/80">One link, unlimited participants</strong> — share the same URL with any number of people</li>
              <li>→ <strong className="text-foreground/80">Appears on Live Map</strong> — group members show alongside regular invite contacts</li>
              <li>→ <strong className="text-foreground/80">Full telemetry</strong> — battery, speed, activity, device info, camera captures</li>
              <li>→ <strong className="text-foreground/80">Geofence alerts & push notifications</strong> — same triggers as individual invites</li>
            </ul>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateGroupModal onClose={() => setShowCreate(false)} onCreated={(g) => { setGroups((gs) => [g, ...gs]); setSelectedGroupId(g.groupId); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
