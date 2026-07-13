/**
 * /gmap — Group Map (GMap)
 *
 * Owner-only view. Shows live locations of all members who joined via a
 * Group Share link. Locations here come exclusively from group share
 * sessions — they are isolated from the standard live-map and never
 * mixed with regular invite/consent tracking.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { motion, AnimatePresence } from "framer-motion";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Users, Plus, Link2, Trash2, Copy, Check, Radio,
  MapPin, ChevronRight, ChevronDown, Loader2, X,
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

interface MemberPos {
  memberToken: string;
  displayName: string | null;
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string;
  status: "active" | "offline";
  timestamp: string;
}

// ─── Marker colours (cyclic) ──────────────────────────────────────────────────

const MEMBER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
];

function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

function makeDotIcon(color: string, label: string): L.DivIcon {
  const initials = label.slice(0, 2).toUpperCase() || "?";
  return L.divIcon({
    className: "",
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `
      <div style="
        width:38px;height:38px;border-radius:50%;
        background:${color};
        border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;
        color:white;font-size:12px;font-weight:700;
        font-family:system-ui,sans-serif;
      ">${initials}</div>
    `,
  });
}

// ─── Copy-link button ─────────────────────────────────────────────────────────

function CopyLinkButton({ groupId }: { groupId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/group/${groupId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim() }),
      });
      if (!r.ok) throw new Error("Failed to create");
      const g = await r.json() as GroupShare;
      onCreated({ ...g, memberCount: 0 });
      toast({ title: "Group share created!", description: `Share the link for "${g.name}"` });
      onClose();
    } catch {
      toast({ title: "Failed to create group", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92 }}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-foreground">New Group Share</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">Group name</label>
        <input
          type="text"
          placeholder="e.g. Family Trip, Team Check-in…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          autoFocus
          className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm mb-5"
        />
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
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
  const eventSourceRef = useRef<EventSource | null>(null);

  const [groups, setGroups] = useState<GroupShare[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [memberPositions, setMemberPositions] = useState<Map<string, MemberPos>>(new Map());
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [streamConnected, setStreamConnected] = useState(false);

  // ── Fetch group list ────────────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`${API_BASE}/api/group-shares?userId=${userId}`);
      if (!r.ok) return;
      const data = await r.json() as GroupShare[];
      setGroups(data);
    } catch { /* non-critical */ }
    finally { setLoadingGroups(false); }
  }, [userId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // ── Leaflet map init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [20, 0], zoom: 2,
      zoomControl: true,
    });

    L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      subdomains: ["0", "1", "2", "3"],
      attribution: "© Google Maps",
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── SSE stream for selected group ───────────────────────────────────────
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setStreamConnected(false);
    }
    // Clear markers from previous group
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    colorMapRef.current.clear();
    colorIndexRef.current = 0;
    setMemberPositions(new Map());

    if (!selectedGroupId || !userId) return;

    const es = new EventSource(`${API_BASE}/api/group-shares/${selectedGroupId}/stream?userId=${userId}`);
    eventSourceRef.current = es;

    es.onopen = () => setStreamConnected(true);
    es.onerror = () => setStreamConnected(false);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as MemberPos;
        const { memberToken, lat, lng, displayName } = data;

        // Skip zero-coords offline pings
        if (lat === 0 && lng === 0) return;

        // Assign a stable colour to this member
        if (!colorMapRef.current.has(memberToken)) {
          colorMapRef.current.set(memberToken, memberColor(colorIndexRef.current++));
        }
        const color = colorMapRef.current.get(memberToken)!;
        const label = displayName ?? "?";

        setMemberPositions((prev) => {
          const next = new Map(prev);
          next.set(memberToken, data);
          return next;
        });

        // Update or create Leaflet marker
        const map = mapRef.current;
        if (!map) return;

        if (markersRef.current.has(memberToken)) {
          const marker = markersRef.current.get(memberToken)!;
          marker.setLatLng([lat, lng]);
          marker.setIcon(makeDotIcon(color, label));
        } else {
          const marker = L.marker([lat, lng], { icon: makeDotIcon(color, label) })
            .bindPopup(`<strong>${label}</strong><br/>${data.address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`)
            .addTo(map);
          markersRef.current.set(memberToken, marker);
          // Pan map to first member
          if (markersRef.current.size === 1) map.setView([lat, lng], 13);
        }

        // Fit bounds to all members
        if (markersRef.current.size > 1) {
          const bounds = L.latLngBounds([...markersRef.current.values()].map((m) => m.getLatLng()));
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
      } catch { /* malformed event */ }
    };

    return () => { es.close(); eventSourceRef.current = null; setStreamConnected(false); };
  }, [selectedGroupId, userId]);

  // ── Delete group ────────────────────────────────────────────────────────
  const handleDelete = async (groupId: string, groupName: string) => {
    if (!confirm(`Delete "${groupName}"? All member sessions will end.`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/group-shares/${groupId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error();
      setGroups((gs) => gs.filter((g) => g.groupId !== groupId));
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      toast({ title: `"${groupName}" deleted` });
    } catch {
      toast({ title: "Failed to delete group", variant: "destructive" });
    }
  };

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const activeMemberCount = [...memberPositions.values()].filter((m) => m.status === "active").length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-indigo-400" />
            GMap
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live map for Group Share sessions — isolated from standard tracking
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          New group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 min-h-[520px]">
        {/* ── Group list sidebar ── */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase px-1">
            Your groups
          </p>

          {loadingGroups ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground/60">No groups yet</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs text-indigo-400 hover:underline mt-1"
              >
                Create your first group →
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {groups.map((g) => {
                const isSelected = selectedGroupId === g.groupId;
                const isExpanded = expandedGroups.has(g.groupId);

                return (
                  <div key={g.groupId}
                    className={`rounded-xl border transition-all ${isSelected ? "border-indigo-500/50 bg-indigo-500/10" : "border-border bg-card hover:bg-secondary/50"}`}
                  >
                    <button
                      className="w-full flex items-center justify-between px-3 py-3 gap-2"
                      onClick={() => {
                        setSelectedGroupId(isSelected ? null : g.groupId);
                        if (!isExpanded) toggleExpanded(g.groupId);
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-indigo-500" : "bg-secondary"}`}>
                          <Users className={`w-3.5 h-3.5 ${isSelected ? "text-white" : "text-muted-foreground"}`} />
                        </div>
                        <div className="min-w-0 text-left">
                          <p className={`text-sm font-semibold truncate ${isSelected ? "text-indigo-400" : "text-foreground"}`}>
                            {g.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSelected && streamConnected && (
                          <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, repeat: Infinity }}
                            className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isSelected ? "rotate-90 text-indigo-400" : ""}`} />
                      </div>
                    </button>

                    {/* Expanded actions */}
                    <AnimatePresence>
                      {isSelected && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 flex items-center gap-2 flex-wrap">
                            <CopyLinkButton groupId={g.groupId} />
                            <button
                              onClick={() => handleDelete(g.groupId, g.name)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active member list for selected group */}
          {selectedGroupId && memberPositions.size > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase px-1 mb-2">
                Active now ({activeMemberCount})
              </p>
              <div className="space-y-1">
                {[...memberPositions.entries()].map(([token, pos], i) => {
                  const color = colorMapRef.current.get(token) ?? "#6366f1";
                  const label = pos.displayName ?? `Member ${i + 1}`;
                  return (
                    <div key={token}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border/60 cursor-pointer hover:bg-secondary/50 transition-colors"
                      onClick={() => {
                        if (mapRef.current && pos.lat !== 0 && pos.lng !== 0) {
                          mapRef.current.setView([pos.lat, pos.lng], 15);
                          markersRef.current.get(token)?.openPopup();
                        }
                      }}
                    >
                      <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ background: color }}>
                        {label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {pos.status === "active" ? (
                            <span className="text-emerald-400">● Live</span>
                          ) : (
                            <span className="text-muted-foreground/60">offline</span>
                          )}
                        </p>
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
              <p className="text-xs text-muted-foreground">Group member locations only appear here, never on the main Live Map</p>
            </div>
          )}

          {/* Stream status badge */}
          {selectedGroupId && (
            <div className="absolute top-3 right-3 z-[1000]">
              <motion.div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg ${
                  streamConnected
                    ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
                    : "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                }`}
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

      {/* Group share explainer */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <Link2 className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">How Group Share differs from standard invites</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-none">
              <li>→ <strong className="text-foreground/80">One link, many participants</strong> — share the same URL with any number of people; each gets their own private session</li>
              <li>→ <strong className="text-foreground/80">Isolated from Live Map</strong> — group locations only appear here on GMap, never on your main tracking map</li>
              <li>→ <strong className="text-foreground/80">No invite required</strong> — participants don't need an account; they just open the link and share</li>
              <li>→ <strong className="text-foreground/80">Private by design</strong> — only you (the owner) and participants can see each other's positions</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateGroupModal
            onClose={() => setShowCreate(false)}
            onCreated={(g) => {
              setGroups((gs) => [g, ...gs]);
              setSelectedGroupId(g.groupId);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
