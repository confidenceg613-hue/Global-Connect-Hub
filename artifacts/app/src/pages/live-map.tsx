import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { makeEagleMarker } from "@/lib/eagle-map-marker";
import { MapCloudReveal } from "@/components/map-cloud-reveal";
import "leaflet.heat";
import { onMapCommand, registerMapContext } from "@/lib/map-command-bus";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Flame, X, Compass, Map as MapIcon, Eye, Settings2, Mountain, TrainFront, TrafficCone, Bike, Building2, Wind, ShieldCheck, Maximize2, Search, Navigation2, ArrowRightLeft, LocateFixed, Plus, Minus, ChevronUp, BookmarkPlus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, windDirLabel } from "@/hooks/use-weather";
import { fetchAreaInfo, aqiLabel } from "@/hooks/use-area-info";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";
import { fetchStreetView, streetViewUrl, mapillaryViewerUrl, type StreetViewResult } from "@/lib/maps-config";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Escape a value for safe insertion into an innerHTML HTML string. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isLiveStale(timestamp: string): boolean {
  return differenceInMinutes(new Date(), new Date(timestamp)) >= 5;
}

interface LivePos {
  lat: number;
  lng: number;
  accuracy?: number;
  status: "active" | "offline";
  timestamp: string;
  bearing?: number;
  spoofScore?: number;
  spoofFlags?: string[];
}

function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Google's own map tiles, loaded directly (no API key/billing needed — the
// same public tile endpoint the Google Maps website itself uses for guests).
// lyrs=y: hybrid (satellite + roads/labels) · lyrs=m: roadmap
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
const ROAD_URL      = "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
const TERRAIN_URL   = "https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}";
// Detail overlays — same public Google tile endpoint, transparent layers.
const TRANSIT_URL   = "https://mt{s}.google.com/vt/lyrs=m@221097413,transit&x={x}&y={y}&z={z}";
const TRAFFIC_URL   = "https://mt{s}.google.com/vt/lyrs=m@221097413,traffic&x={x}&y={y}&z={z}";
const BICYCLE_URL   = "https://mt{s}.google.com/vt/lyrs=m@221097413,bike&x={x}&y={y}&z={z}";
// NASA GIBS fire hotspots — free public WMTS, no API key required
const WILDFIRE_URL  = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_Thermal_Anomalies_375m_All/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

type MapMode = "road" | "hybrid" | "terrain";
const MAP_MODES: MapMode[] = ["road", "hybrid", "terrain"];
const MAP_MODE_LABELS: Record<MapMode, string> = {
  road: "Default",
  hybrid: "Satellite",
  terrain: "Terrain",
};

type MapDetail = "transit" | "traffic" | "bicycling" | "buildings" | "streetview" | "wildfires" | "airquality";
const MAP_DETAILS: { id: MapDetail; label: string; icon: React.ReactNode; live: boolean }[] = [
  { id: "transit",    label: "Public transit",  icon: <TrainFront className="w-5 h-5" />,  live: true },
  { id: "traffic",    label: "Traffic",         icon: <TrafficCone className="w-5 h-5" />, live: true },
  { id: "bicycling",  label: "Bicycling",       icon: <Bike className="w-5 h-5" />,        live: true },
  { id: "buildings",  label: "Raised buildings",icon: <Building2 className="w-5 h-5" />,   live: false },
  { id: "streetview", label: "Street View",     icon: <Eye className="w-5 h-5" />,         live: true },
  { id: "wildfires",  label: "Wildfires",       icon: <Flame className="w-5 h-5" />,       live: true },
  { id: "airquality", label: "Air Quality",     icon: <Wind className="w-5 h-5" />,        live: true },
];

/** Convert decimal degrees to DMS string, e.g. 8°56′59.8″N */
function toDMS(dd: number, isLat: boolean): string {
  const dir = isLat ? (dd >= 0 ? "N" : "S") : (dd >= 0 ? "E" : "W");
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(1);
  return `${deg}°${min}′${sec}″${dir}`;
}
function formatDMS(lat: number, lng: number): string {
  return `${toDMS(lat, true)} ${toDMS(lng, false)}`;
}

function initials(name: string | null | undefined, phone?: string | null) {
  if (name) return name.split(" ").map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
  // No name on file — fall back to the last 2 digits of the phone number
  // instead of a meaningless "?", so pins for unnamed contacts stay
  // distinguishable from each other on the map.
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-2) : "?";
}

/** Short label for a contact: their saved name, or a formatted phone number. */
function contactLabel(name: string | null | undefined, phone: string): string {
  return name || phone;
}

type ActivityType = "stationary" | "walking" | "running" | "driving";
const ACTIVITY_INFO: Record<ActivityType, { icon: string; label: string; color: string }> = {
  stationary: { icon: "⏸️", label: "Stationary", color: "#94a3b8" },
  walking:    { icon: "🚶", label: "Walking",    color: "#60a5fa" },
  running:    { icon: "🏃", label: "Running",    color: "#fb923c" },
  driving:    { icon: "🚗", label: "Driving",    color: "#34d399" },
};

// Device telemetry merged in from the owner-scoped /api/sessions endpoint —
// never fetched from any token/public route, so a contact (or anyone with
// just the share link) can never see their own battery/speed here.
interface SessionTelemetry {
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  activityType: ActivityType | null;
  speedMps: number | null;
  lastUpdate: string | null;
}

interface SessionInfo {
  openedIp: string | null;
  openedAt: string | null;
  openedUserAgent: string | null;
  grantedIp: string | null;
  ipInfo: Record<string, unknown> | null;
  timeToGrantMs: number | null;
  deviceInfo: Record<string, unknown> | null;
  source: string | null;
  accuracy: number | null;
}

function riskBadgeHtml(level: "low" | "medium" | "high") {
  const m = {
    low:    { bg: "rgba(16,185,129,.15)",  border: "rgba(16,185,129,.4)",  text: "#6ee7b7", label: "LOW RISK"  },
    medium: { bg: "rgba(245,158,11,.15)",  border: "rgba(245,158,11,.4)",  text: "#fcd34d", label: "MODERATE"  },
    high:   { bg: "rgba(239,68,68,.15)",   border: "rgba(239,68,68,.4)",   text: "#fca5a5", label: "HIGH RISK" },
  }[level];
  return `<span style="display:inline-flex;align-items:center;gap:3px;background:${m.bg};border:1px solid ${m.border};border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:0.06em;color:${m.text}">${m.label}</span>`;
}

function makePin(color: string, label: string, isMine = false, bearing?: number, lowBattery = false) {
  const size = isMine ? 46 : 38;
  const bg = isMine ? "#fff" : color;
  const fg = isMine ? color : "#fff";
  const arrow = bearing != null
    ? `<div style="position:absolute;top:50%;left:50%;width:0;height:0;transform-origin:0 0;transform:rotate(${bearing}deg) translateX(-50%);">
         <svg width="14" height="22" viewBox="0 0 14 22" style="position:absolute;left:-7px;top:-22px;" xmlns="http://www.w3.org/2000/svg">
           <polygon points="7,0 13,14 7,10 1,14" fill="${color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
         </svg>
       </div>`
    : "";
  // Low-battery warning badge — only shown for live contacts under 15% and
  // not charging, so an owner can spot a contact about to drop off tracking
  // without opening every popup.
  const batteryBadge = lowBattery
    ? `<div style="position:absolute;bottom:-3px;right:-3px;width:16px;height:16px;border-radius:50%;background:#ef4444;border:2px solid #0a0a0a;display:flex;align-items:center;justify-content:center;font-size:9px;line-height:1;">🪫</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size + 12}px;filter:drop-shadow(0 4px 12px ${color}66);">
      <div class="pl-pin-upright" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;">
        <div style="width:${size}px;height:${size}px;background:${bg};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.06);border-radius:10px;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${isMine ? 12 : 11}px;font-weight:800;color:${fg};">${label}</div>
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:4px;height:10px;background:${bg};clip-path:polygon(50% 100%,0% 0%,100% 0%);"></div>
      </div>
      ${arrow}
      ${batteryBadge}
    </div>`,
    iconSize: [size, size + 12],
    iconAnchor: [size / 2, size + 12],
    popupAnchor: [0, -(size + 16)],
  });
}

function cardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function csvExport(grants: Invite[]) {
  const cols = ["ID", "Contact", "Phone", "Latitude", "Longitude", "DMS", "Address", "Granted At"];
  const rows = grants.map((g) => [
    g.id,
    `"${(g.toName ?? "Unknown").replace(/"/g, '""')}"`,
    g.toPhone,
    g.grantedLatitude ?? "",
    g.grantedLongitude ?? "",
    g.grantedLatitude != null && g.grantedLongitude != null
      ? `"${formatDMS(g.grantedLatitude, g.grantedLongitude)}"` : "",
    `"${(g.grantedAddress ?? "").replace(/"/g, '""')}"`,
    g.grantedAt ? format(new Date(g.grantedAt), "yyyy-MM-dd HH:mm:ss") : "",
  ]);
  const csv = [cols, ...rows].map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `deepfalcon-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
}

interface StreetViewPos { lat: number; lng: number; name: string }

export default function LiveMap() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInst     = useRef<L.Map | null>(null);
  const layersRef   = useRef<L.Layer[]>([]);
  const sseRefs     = useRef<globalThis.Map<string, EventSource>>(new globalThis.Map());
  const livePos     = useRef<globalThis.Map<string, LivePos>>(new globalThis.Map());
  const tileBaseRef = useRef<L.TileLayer | null>(null);
  const tileLabelRef= useRef<L.TileLayer | null>(null);

  const pendingUpdateRef = useRef(false);

  const scheduleMarkerUpdate = useCallback(() => {
    if (pendingUpdateRef.current) return;
    pendingUpdateRef.current = true;
    requestAnimationFrame(() => {
      pendingUpdateRef.current = false;
      const count = Array.from(livePos.current.values()).filter((p) => p.status === "active" && !isLiveStale(p.timestamp)).length;
      setLiveCount(count);
      setTick((n) => n + 1);
    });
  }, []);

  const [showJourneys, setShowJourneys] = useState(false);
  const [showClusters, setShowClusters] = useState(false);
  const [showHeatmap,  setShowHeatmap ] = useState(false);
  const [showGeofences, setShowGeofences] = useState(false);
  const [geofences, setGeofences] = useState<Array<{ id: number; name: string; latitude: number; longitude: number; radiusMeters: number }>>([]);
  // token -> set of geofence ids currently containing that contact, so we can
  // toast only on enter/exit transitions rather than every marker refresh.
  const geofenceInsideRef = useRef<globalThis.Map<string, globalThis.Set<number>>>(new globalThis.Map());
  const [liveCount,    setLiveCount   ] = useState(0);
  const [myPos,        setMyPos       ] = useState<{ lat: number; lng: number } | null>(null);
  const [locating,     setLocating    ] = useState(false);
  const [refreshing,   setRefreshing  ] = useState(false);
  const [tick,         setTick        ] = useState(0);
  const [heatLoading,  setHeatLoading ] = useState(false);
  const [compassMode,  setCompassMode ] = useState(false);
  const [heading,      setHeading     ] = useState<number | null>(null);
  const [mapMode,         setMapMode        ] = useState<MapMode>("hybrid");
  const [streetView,      setStreetView     ] = useState<StreetViewPos | null>(null);
  const [svResult,        setSvResult       ] = useState<StreetViewResult | null>(null);
  const [svLoading,       setSvLoading      ] = useState(false);
  const [showTypePanel,   setShowTypePanel  ] = useState(false);
  const [activeDetails,   setActiveDetails  ] = useState<globalThis.Set<MapDetail>>(new globalThis.Set());
  const detailLayerRefs = useRef<Partial<Record<MapDetail, L.TileLayer>>>({});

  // ── Search ───────────────────────────────────────────────────────────────────
  const [showSearch,     setShowSearch    ] = useState(false);
  const [searchQuery,    setSearchQuery   ] = useState("");
  const [searchResults,  setSearchResults ] = useState<Array<{ display_name: string; lat: string; lon: string; place_id: number }>>([]);
  const [searchLoading,  setSearchLoading ] = useState(false);

  // ── Fullscreen ───────────────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Directions ───────────────────────────────────────────────────────────────
  const [dirMode,  setDirMode ] = useState(false);
  const [dirStart, setDirStart] = useState<{ lat: number; lng: number } | null>(null);
  const [dirEnd,   setDirEnd  ] = useState<{ lat: number; lng: number } | null>(null);
  const [dirInfo,  setDirInfo ] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const dirMarkersRef = useRef<L.Layer[]>([]);
  const dirRouteRef   = useRef<L.Polyline | null>(null);
  // Refs kept in sync so the map click handler (registered once) always reads fresh values
  const dirModeRef  = useRef(false);
  const dirStartRef = useRef<{ lat: number; lng: number } | null>(null);

  // ── Air Quality markers ───────────────────────────────────────────────────────
  const aqiLayerRefs = useRef<L.Layer[]>([]);

  // ── Manual Pins ──────────────────────────────────────────────────────────────
  interface ManualPin { id: number; name: string; latitude: number; longitude: number }
  const [manualPins, setManualPins] = useState<ManualPin[]>([]);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinName, setPinName] = useState("");
  const [pinLat, setPinLat] = useState("");
  const [pinLng, setPinLng] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const manualPinLayersRef = useRef<L.Layer[]>([]);

  const loadManualPins = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`${API_BASE}/api/manual-pins/${userId}`);
      if (r.ok) setManualPins(await r.json());
    } catch { /* non-critical */ }
  }, [userId]);

  useEffect(() => { loadManualPins(); }, [loadManualPins]);

  // Resolve the nearest street-level photo (async, via Mapillary proxy)
  useEffect(() => {
    if (!streetView) { setSvResult(null); return; }
    setSvLoading(true);
    fetchStreetView(streetView.lat, streetView.lng)
      .then(setSvResult)
      .finally(() => setSvLoading(false));
  }, [streetView]);

  const compassCleanupRef = useRef<(() => void) | null>(null);
  const myMarkerRef = useRef<L.Marker | null>(null);
  const heatLayerRef  = useRef<L.HeatLayer | null>(null);
  const heatPoints    = useRef<L.HeatLatLngTuple[]>([]);
  const prevPos       = useRef<globalThis.Map<string, { lat: number; lng: number }>>(new globalThis.Map());
  const aiViewLocked  = useRef(false);
  const viewHistory   = useRef<{ center: L.LatLng; zoom: number }[]>([]);
  // Once the user manually pans/zooms the map, live location updates (SSE,
  // telemetry polling, staleness ticks) must stop force-fitting the view back
  // to "show everyone" — otherwise a user who zooms in on one contact gets
  // yanked back out to the wide view on the next background update, which
  // looks like the map "auto zooms out" and never lets them stay zoomed in.
  // `programmaticMoveRef` distinguishes our own setView/fitBounds/flyTo calls
  // (which also fire Leaflet's move/zoom events) from genuine user gestures.
  const userViewLockRef      = useRef(false);
  const programmaticMoveRef  = useRef(false);

  // Wrap any code that calls map.setView/fitBounds/flyTo/zoomIn/etc so the
  // resulting Leaflet move/zoom events aren't mistaken for user interaction.
  const withProgrammaticMove = useCallback((fn: () => void) => {
    programmaticMoveRef.current = true;
    try { fn(); } finally {
      // Leaflet fires move/zoom events synchronously for setView/fitBounds,
      // but animated flyTo calls fire them across multiple frames — clear the
      // flag on the next tick rather than immediately.
      setTimeout(() => { programmaticMoveRef.current = false; }, 0);
    }
  }, []);

  const { data: invites, refetch } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }), refetchInterval: 20000 } },
  );

  // Use globalThis.Map to avoid shadowing by any local import
  const [overridesByToken, setOverridesByToken] = useState<globalThis.Map<string, globalThis.Map<string, string>>>(new globalThis.Map());

  useEffect(() => {
    const tokens: string[] = Array.from(new globalThis.Set((invites ?? []).map((inv: Invite) => inv.token as string)));
    if (tokens.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new globalThis.Map<string, globalThis.Map<string, string>>();
      await Promise.all(
        tokens.map(async (token) => {
          try {
            const r = await fetch(`${API_BASE}/api/location-overrides/by-token/${token}`);
            if (!r.ok) return;
            const rows: { latKey: number; lngKey: number; overrideType: string }[] = await r.json();
            const m = new globalThis.Map<string, string>();
            rows.forEach((o) => m.set(`${o.latKey},${o.lngKey}`, o.overrideType));
            next.set(token, m);
          } catch { /* non-critical */ }
        }),
      );
      if (!cancelled) setOverridesByToken(next);
    })();
    return () => { cancelled = true; };
  }, [(invites ?? []).map((inv: Invite) => inv.token).join(","), tick]);

  function roundCoordKey(v: number) {
    return Math.round(v * 10000) / 10000;
  }

  function applyOverride(token: string, lat: number, lng: number, intel: ReturnType<typeof analyzeLocation>) {
    const m = overridesByToken.get(token);
    const key = `${roundCoordKey(lat)},${roundCoordKey(lng)}`;
    const overrideType = m?.get(key);
    if (!overrideType || !(overrideType in TYPE_CONFIG)) return intel;
    const cfg = TYPE_CONFIG[overrideType as keyof typeof TYPE_CONFIG];
    return { ...intel, locationType: overrideType as typeof intel.locationType, typeLabel: cfg.label, typeIcon: cfg.icon, pinColor: cfg.color, riskLevel: cfg.risk };
  }

  const granted = (invites ?? []).filter(
    (inv: Invite) => inv.status === "accepted" && inv.grantedLatitude != null && inv.grantedLongitude != null,
  );

  const latestByPhone = granted.reduce<Record<string, Invite>>(
    (acc: Record<string, Invite>, inv: Invite) => {
      const ex = acc[inv.toPhone];
      if (!ex || (inv.grantedAt ?? inv.sentAt) > (ex.grantedAt ?? ex.sentAt)) acc[inv.toPhone] = inv;
      return acc;
    }, {});
  const latest = Object.values(latestByPhone) as Invite[];

  const allByPhone = granted.reduce<Record<string, Invite[]>>(
    (acc: Record<string, Invite[]>, inv: Invite) => {
      if (!acc[inv.toPhone]) acc[inv.toPhone] = [];
      acc[inv.toPhone].push(inv);
      return acc;
    }, {});

  // ── Device telemetry (battery/activity/speed) + session intel ───────────────
  // Polled separately from the owner-scoped /api/sessions endpoint since it's
  // never broadcast over the token-authenticated SSE stream (that channel is
  // reachable by whoever holds a contact's share link).
  const [telemetryByToken, setTelemetryByToken] = useState<globalThis.Map<string, SessionTelemetry>>(new globalThis.Map());
  const [sessionInfoByToken, setSessionInfoByToken] = useState<globalThis.Map<string, SessionInfo>>(new globalThis.Map());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/sessions?userId=${userId}`);
        if (!r.ok || cancelled) return;
        const rows: Array<{
          token: string; batteryLevel: number | null; batteryCharging: boolean | null;
          activityType: ActivityType | null; deviceInfo: Record<string, unknown> | null;
          lastUpdate: string | null; source: string | null; accuracy: number | null;
          openedIp: string | null; openedAt: string | null; openedUserAgent: string | null;
          grantedIp: string | null; ipInfo: Record<string, unknown> | null;
          timeToGrantMs: number | null;
        }> = await r.json();
        if (cancelled) return;
        const nextTelemetry = new globalThis.Map<string, SessionTelemetry>();
        const nextInfo = new globalThis.Map<string, SessionInfo>();
        for (const row of rows) {
          const speedMps = row.deviceInfo && typeof row.deviceInfo.speedMps === "number" ? row.deviceInfo.speedMps : null;
          nextTelemetry.set(row.token, {
            batteryLevel: row.batteryLevel,
            batteryCharging: row.batteryCharging,
            activityType: row.activityType,
            speedMps,
            lastUpdate: row.lastUpdate,
          });
          nextInfo.set(row.token, {
            openedIp: row.openedIp,
            openedAt: row.openedAt,
            openedUserAgent: row.openedUserAgent,
            grantedIp: row.grantedIp,
            ipInfo: row.ipInfo,
            timeToGrantMs: row.timeToGrantMs,
            deviceInfo: row.deviceInfo,
            source: row.source,
            accuracy: row.accuracy,
          });
        }
        setTelemetryByToken(nextTelemetry);
        setSessionInfoByToken(nextInfo);
        scheduleMarkerUpdate();
      } catch { /* non-critical */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, scheduleMarkerUpdate]);

  // ── Geofences ────────────────────────────────────────────────────────────────
  const loadGeofences = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`${API_BASE}/api/geofences/${userId}`);
      if (!r.ok) return;
      setGeofences(await r.json());
    } catch { /* non-critical */ }
  }, [userId]);

  useEffect(() => { loadGeofences(); }, [loadGeofences]);

  const geoClusteredPhones = findClusters(
    latest.filter((inv) => isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!))
      .map((inv) => ({ id: inv.id, lat: inv.grantedLatitude!, lng: inv.grantedLongitude!, phone: inv.toPhone })),
    2,
  );
  const clusterCount = geoClusteredPhones.size;

  // ── Map init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    try {
      const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false, maxZoom: 22 });
      L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
      mapInst.current = map;

      // Detect genuine user interaction (drag, scroll/pinch zoom, +/- zoom
      // control, double-click zoom) vs our own programmatic moves so live
      // background updates never force the view back to "fit everyone" once
      // someone has manually framed the map themselves.
      const lockFromUserGesture = () => {
        if (!programmaticMoveRef.current) userViewLockRef.current = true;
      };
      map.on("dragstart", lockFromUserGesture);
      map.on("zoomstart", lockFromUserGesture);
      map.on("boxzoomend", lockFromUserGesture);

      if (!document.getElementById("pl-map-styles")) {
        const s = document.createElement("style");
        s.id = "pl-map-styles";
        s.textContent = `
          .pl-popup .leaflet-popup-content-wrapper{background:#111113!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:14px!important;box-shadow:0 24px 64px rgba(0,0,0,.8)!important;}
          .pl-popup .leaflet-popup-content{margin:14px!important;}
          .pl-popup .leaflet-popup-tip{background:#111113!important;}
          .pl-popup .leaflet-popup-close-button{color:#52525b!important;font-size:18px!important;top:8px!important;right:8px!important;}
          .leaflet-tooltip{background:#111113!important;border:1px solid rgba(255,255,255,.12)!important;color:#f4f4f5!important;border-radius:6px!important;}
          .leaflet-tooltip-left:before,.leaflet-tooltip-right:before{border-right-color:#111113!important;border-left-color:#111113!important;}
          .leaflet-control-attribution{background:rgba(0,0,0,.55)!important;color:#52525b!important;font-size:8px!important;padding:2px 6px!important;border-radius:4px!important;}
          .leaflet-control-attribution a{color:#6366f1!important;}
          .leaflet-bottom{bottom:148px!important;}
          @keyframes pl-pulse{0%,100%{transform:scale(1);opacity:.25;}50%{transform:scale(1.35);opacity:.1;}}
        `;
        document.head.appendChild(s);
      }
    } catch (err) {
      console.error("Leaflet init error:", err);
    }

    return () => {
      try { mapInst.current?.remove(); } catch { /* ignore */ }
      mapInst.current = null;
    };
  }, []);

  // ── Tile layer mode switching ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    try {
      tileBaseRef.current?.remove();
      tileLabelRef.current?.remove();
    } catch { /* ignore */ }

    try {
      const url = mapMode === "road" ? ROAD_URL : mapMode === "terrain" ? TERRAIN_URL : LABELS_URL;
      tileBaseRef.current = L.tileLayer(url, {
        maxZoom: 22,
        maxNativeZoom: 20,
        subdomains: "0123",
        attribution: '© Google Maps',
      }).addTo(map);
      tileLabelRef.current = null;
    } catch (err) {
      console.error("Tile layer error:", err);
    }
  }, [mapMode]);

  // ── Map detail overlays (transit / traffic / bicycling) ──────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    const overlayUrls: Partial<Record<MapDetail, string>> = {
      transit:   TRANSIT_URL,
      traffic:   TRAFFIC_URL,
      bicycling: BICYCLE_URL,
      wildfires: WILDFIRE_URL,
    };

    (Object.keys(overlayUrls) as MapDetail[]).forEach((id) => {
      const shouldShow = activeDetails.has(id);
      const existing = detailLayerRefs.current[id];
      if (shouldShow && !existing) {
        try {
          const isWildfire = id === "wildfires";
          const layer = L.tileLayer(overlayUrls[id]!, {
            maxZoom: 22,
            maxNativeZoom: isWildfire ? 8 : 20,
            ...(isWildfire ? {} : { subdomains: "0123" }),
            opacity: id === "traffic" ? 0.85 : id === "wildfires" ? 0.75 : 0.9,
            zIndex: 500,
          }).addTo(map);
          // If Google's overlay tile pattern breaks (rotated/removed), most
          // tiles will 404/error — auto-disable the layer instead of leaving
          // a silently broken overlay toggled "on".
          let errorCount = 0;
          layer.on("tileerror", () => {
            errorCount += 1;
            if (errorCount > 8) {
              toast({ title: `${MAP_DETAILS.find((d) => d.id === id)?.label} overlay unavailable`, description: "Google's tile format may have changed.", variant: "destructive" });
              setActiveDetails((prev) => { const next = new globalThis.Set(prev); next.delete(id); return next; });
            }
          });
          detailLayerRefs.current[id] = layer;
        } catch { /* ignore */ }
      } else if (!shouldShow && existing) {
        try { existing.remove(); } catch { /* ignore */ }
        delete detailLayerRefs.current[id];
      }
    });
  }, [activeDetails]);

  function toggleDetail(id: MapDetail) {
    const meta = MAP_DETAILS.find((d) => d.id === id);
    if (!meta?.live) {
      toast({ title: `${meta?.label ?? id} isn't available yet`, description: "This layer needs a paid Google Maps Platform API key we don't have configured.", variant: "destructive" });
      return;
    }
    if (id === "streetview") {
      const first = latest[0];
      if (!first) { toast({ title: "No contacts to show Street View for", variant: "destructive" }); return; }
      const rawLive = livePos.current.get(first.token);
      const lat = rawLive ? rawLive.lat : first.grantedLatitude!;
      const lng = rawLive ? rawLive.lng : first.grantedLongitude!;
      setStreetView(streetView ? null : { lat, lng, name: first.toName ?? "Contact" });
      return;
    }
    setActiveDetails((prev) => {
      const next = new globalThis.Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Refs kept fresh every render so command-bus callbacks never go stale ──────
  const latestRef       = useRef(latest);
  const liveCountRef    = useRef(liveCount);
  const myPosRef        = useRef(myPos);
  const showHeatmapRef  = useRef(showHeatmap);
  const showJourneysRef = useRef(showJourneys);
  const showClustersRef = useRef(showClusters);
  // Sync every render (no dep array — intentionally runs every render)
  useEffect(() => {
    latestRef.current       = latest;
    liveCountRef.current    = liveCount;
    myPosRef.current        = myPos;
    showHeatmapRef.current  = showHeatmap;
    showJourneysRef.current = showJourneys;
    showClustersRef.current = showClusters;
    dirModeRef.current      = dirMode;
    dirStartRef.current     = dirStart;
  });

  // ── AI command bus ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInst.current) return;
    const unregister = registerMapContext(() => ({
      onMapPage: true,
      contacts: latestRef.current.map((inv) => ({
        name: inv.toName ?? null,
        lat: inv.grantedLatitude!,
        lng: inv.grantedLongitude!,
        address: inv.grantedAddress ?? null,
        isLive: livePos.current.get(inv.token)?.status === "active",
      })),
      liveCount: liveCountRef.current,
      myLat: myPosRef.current?.lat,
      myLng: myPosRef.current?.lng,
      layers: {
        heatmap:     showHeatmapRef.current,
        journeys:    showJourneysRef.current,
        clusters:    showClustersRef.current,
        surveillance: false,
      },
    }));
    const cleanup = onMapCommand((cmd) => {
      const map = mapInst.current;
      if (!map) return;

      // Track the view before non-navigational commands so "go back" can undo it.
      const pushHistory = () => {
        viewHistory.current.push({ center: map.getCenter(), zoom: map.getZoom() });
        if (viewHistory.current.length > 20) viewHistory.current.shift();
      };

      if (cmd.type === "flyTo") {
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.flyTo([cmd.lat, cmd.lng], cmd.zoom ?? 14, { duration: 1.2 }));
      } else if (cmd.type === "fitAll") {
        pushHistory();
        aiViewLocked.current = true;
        userViewLockRef.current = false; // explicit "fit all" clears any manual zoom lock
        const pts = latestRef.current.map(
          (i) => [i.grantedLatitude!, i.grantedLongitude!] as [number, number],
        );
        if (pts.length) withProgrammaticMove(() => map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 19 }));
      } else if (cmd.type === "zoomIn") {
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.zoomIn(1, { animate: true }));
      } else if (cmd.type === "zoomOut") {
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.zoomOut(1, { animate: true }));
      } else if (cmd.type === "setZoom") {
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.setZoom(Math.max(map.getMinZoom(), Math.min(22, cmd.zoom)), { animate: true }));
      } else if (cmd.type === "pan") {
        // Pan by a fraction of the current viewport in the requested compass
        // direction — smooth and proportional to zoom, never re-zooms.
        pushHistory();
        aiViewLocked.current = true;
        const size = map.getSize();
        const fraction = cmd.amount ?? 0.5;
        const dx = cmd.direction === "east" ? size.x * fraction : cmd.direction === "west" ? -size.x * fraction : 0;
        const dy = cmd.direction === "south" ? size.y * fraction : cmd.direction === "north" ? -size.y * fraction : 0;
        withProgrammaticMove(() => map.panBy([dx, dy], { animate: true, duration: 0.8 }));
      } else if (cmd.type === "findContact") {
        const match = latestRef.current.find(
          (i) => i.toName?.toLowerCase().includes(cmd.name.toLowerCase()),
        );
        if (!match) { toast({ title: `No contact matching "${cmd.name}"`, variant: "destructive" }); return; }
        const live = livePos.current.get(match.token);
        const lat = live ? live.lat : match.grantedLatitude!;
        const lng = live ? live.lng : match.grantedLongitude!;
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.flyTo([lat, lng], 15, { duration: 1.2 }));
      } else if (cmd.type === "goBack") {
        const prev = viewHistory.current.pop();
        if (prev) {
          aiViewLocked.current = true;
          withProgrammaticMove(() => map.flyTo(prev.center, prev.zoom, { duration: 1 }));
        } else {
          aiViewLocked.current = false; // resume auto-fit to live contacts
          userViewLockRef.current = false;
          toast({ title: "Already at the earliest view" });
        }
      } else if (cmd.type === "setLayer") {
        if (cmd.layer === "heatmap") setShowHeatmap(cmd.enabled);
        else if (cmd.layer === "journeys") setShowJourneys(cmd.enabled);
        else if (cmd.layer === "clusters") setShowClusters(cmd.enabled);
      } else if (cmd.type === "showStreetView") {
        if (cmd.lat == null || cmd.lng == null) {
          toast({ title: "Missing coordinates for Street View", variant: "destructive" });
          return;
        }
        pushHistory();
        aiViewLocked.current = true;
        withProgrammaticMove(() => map.flyTo([cmd.lat, cmd.lng], 17, { duration: 1.2 }));
        setStreetView({ lat: cmd.lat, lng: cmd.lng, name: cmd.name ?? "Location" });
      } else if (cmd.type === "showImages") {
        const first = latestRef.current[0];
        if (!first) { toast({ title: "No contacts to show imagery for", variant: "destructive" }); return; }
        const live = livePos.current.get(first.token);
        const lat = live ? live.lat : first.grantedLatitude!;
        const lng = live ? live.lng : first.grantedLongitude!;
        setStreetView({ lat, lng, name: first.toName ?? "Contact" });
      }
    });
    return () => { unregister(); cleanup(); };
  // Only re-run when the map instance first becomes available — state is read
  // through refs above so they never go stale without re-registering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInst.current != null]);

  // ── Directions click handler ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const handler = (e: L.LeafletMouseEvent) => {
      if (!dirModeRef.current) return;
      const { lat, lng } = e.latlng;
      if (!dirStartRef.current) {
        // First click — set start point
        const start = { lat, lng };
        dirStartRef.current = start;
        setDirStart(start);
        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#22c55e;color:white;font-weight:800;font-size:11px;padding:4px 10px;border-radius:8px;border:2px solid white;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6);font-family:system-ui,sans-serif;">A</div>`,
            iconSize: [28, 26], iconAnchor: [14, 13],
          }),
        }).addTo(map);
        dirMarkersRef.current.push(m);
        toast({ title: "Start set — click your destination" });
      } else {
        // Second click — set end point, fetch route
        const startLatLng = dirStartRef.current;
        dirModeRef.current = false;
        setDirMode(false);
        setDirEnd({ lat, lng });
        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#ef4444;color:white;font-weight:800;font-size:11px;padding:4px 10px;border-radius:8px;border:2px solid white;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6);font-family:system-ui,sans-serif;">B</div>`,
            iconSize: [28, 26], iconAnchor: [14, 13],
          }),
        }).addTo(map);
        dirMarkersRef.current.push(m);
        // Fetch route from OSRM public router
        fetch(`https://router.project-osrm.org/route/v1/driving/${startLatLng.lng},${startLatLng.lat};${lng},${lat}?overview=full&geometries=geojson`)
          .then((r) => r.json())
          .then((json) => {
            const route = json?.routes?.[0];
            if (!route) { toast({ title: "No route found between those points", variant: "destructive" }); return; }
            const coords: [number, number][] = route.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
            if (dirRouteRef.current) { try { dirRouteRef.current.remove(); } catch { /* */ } }
            dirRouteRef.current = L.polyline(coords, { color: "#6366f1", weight: 5, opacity: 0.9 }).addTo(map);
            withProgrammaticMove(() => { if (dirRouteRef.current) map.fitBounds(dirRouteRef.current.getBounds().pad(0.1)); });
            const distKm = (route.distance / 1000).toFixed(1);
            const durMin = Math.round(route.duration / 60);
            setDirInfo({ distanceKm: parseFloat(distKm), durationMin: durMin });
            toast({ title: `Route: ${distKm} km · ${durMin} min driving` });
          })
          .catch(() => toast({ title: "Could not calculate route", variant: "destructive" }));
      }
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInst.current != null]);

  // ── Fullscreen listener ───────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Heatmap fetch & render ────────────────────────────────────────────────────
  const buildHeatmap = useCallback(async (tokens: string[], basePoints: L.HeatLatLngTuple[]) => {
    setHeatLoading(true);
    const now = Date.now();
    const allPoints: L.HeatLatLngTuple[] = [...basePoints];

    await Promise.all(
      tokens.map(async (token) => {
        try {
          const r = await fetch(`${API_BASE}/api/location/history/${token}`);
          if (!r.ok) return;
          const rows: { latitude: number; longitude: number; timestamp?: string }[] = await r.json();
          rows.forEach((row) => {
            if (!isFinite(row.latitude) || !isFinite(row.longitude)) return;
            const ageSec = row.timestamp ? (now - new Date(row.timestamp).getTime()) / 1000 : 86400;
            const intensity = Math.max(0.2, Math.min(1.0, 1 - ageSec / (7 * 86400)));
            allPoints.push([row.latitude, row.longitude, intensity]);
          });
        } catch { /* non-critical */ }
      }),
    );

    heatPoints.current = allPoints;
    setHeatLoading(false);

    const map = mapInst.current;
    if (!map) return;

    if (heatLayerRef.current) {
      heatLayerRef.current.setLatLngs(allPoints).redraw();
    } else {
      const layer = L.heatLayer(allPoints, {
        radius: 28, blur: 22, maxZoom: 17, max: 1.0, minOpacity: 0.35,
        gradient: { 0.0: "#0ea5e9", 0.25: "#22c55e", 0.5: "#f59e0b", 0.75: "#f97316", 1.0: "#ef4444" },
      });
      layer.addTo(map);
      heatLayerRef.current = layer;
    }
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    if (!showHeatmap) {
      if (heatLayerRef.current) { try { heatLayerRef.current.remove(); } catch { /* */ } heatLayerRef.current = null; }
      return;
    }

    const acceptedTokens = (invites ?? [])
      .filter((inv: Invite) => inv.status === "accepted")
      .map((inv: Invite) => inv.token as string)
      .filter(Boolean);

    const basePoints: L.HeatLatLngTuple[] = granted
      .filter((inv: Invite) => isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!))
      .map((inv: Invite) => [inv.grantedLatitude!, inv.grantedLongitude!, 0.6] as L.HeatLatLngTuple);

    buildHeatmap(acceptedTokens, basePoints);

    return () => {
      if (heatLayerRef.current) { try { heatLayerRef.current.remove(); } catch { /* */ } heatLayerRef.current = null; }
    };
  }, [showHeatmap, (invites ?? []).map((inv: Invite) => inv.token).join(","), buildHeatmap]);

  // ── Air Quality markers ───────────────────────────────────────────────────────
  const airQualityActive = activeDetails.has("airquality");
  useEffect(() => {
    const map = mapInst.current;
    // Always clean up existing AQI markers first
    for (const layer of aqiLayerRefs.current) { try { layer.remove(); } catch { /* */ } }
    aqiLayerRefs.current = [];
    if (!airQualityActive || !map) return;

    const positions = latest
      .map((inv) => {
        const live = livePos.current.get(inv.token);
        return { lat: live ? live.lat : inv.grantedLatitude!, lng: live ? live.lng : inv.grantedLongitude!, name: inv.toName ?? inv.toPhone };
      })
      .filter((p) => isFinite(p.lat) && isFinite(p.lng));

    if (positions.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const pos of positions) {
        try {
          const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${pos.lat.toFixed(4)}&longitude=${pos.lng.toFixed(4)}&current=us_aqi`);
          if (!r.ok || cancelled) continue;
          const json = await r.json();
          const aqi: number = json?.current?.us_aqi ?? 0;
          if (cancelled) return;
          const color = aqi <= 50 ? "#22c55e" : aqi <= 100 ? "#eab308" : aqi <= 150 ? "#f97316" : aqi <= 200 ? "#ef4444" : aqi <= 300 ? "#a855f7" : "#7f1d1d";
          const aqiLabel = aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy (Sensitive)" : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very Unhealthy" : "Hazardous";
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:${color}20;border:1.5px solid ${color}88;border-radius:10px;padding:3px 8px;font-size:10px;font-weight:700;color:${color};white-space:nowrap;font-family:system-ui,sans-serif;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.4);">💨 AQI ${aqi}<br/><span style="font-size:9px;opacity:.75;">${aqiLabel}</span></div>`,
            iconSize: [100, 36], iconAnchor: [50, 50],
          });
          const marker = L.marker([pos.lat + 0.0025, pos.lng], { icon, interactive: false, zIndexOffset: -200 }).addTo(map);
          aqiLayerRefs.current.push(marker);
        } catch { /* non-critical */ }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airQualityActive, latest.map((i) => i.toPhone).join(","), tick]);

  // ── SSE subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    const tokens = new Set((invites ?? [])
      .filter((inv: Invite) => inv.status === "accepted")
      .map((inv: Invite) => inv.token)
      .filter(Boolean) as string[]);

    for (const [t, es] of sseRefs.current) {
      if (!tokens.has(t)) { try { es.close(); } catch { /* */ } sseRefs.current.delete(t); }
    }

    for (const token of tokens) {
      if (sseRefs.current.has(token)) continue;
      try {
        const es = new EventSource(`${API_BASE}/api/location/stream/${token}`);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data) as LivePos;
            if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
            if (!isFinite(data.lat) || !isFinite(data.lng)) return;
            const prev = prevPos.current.get(token);
            if (prev) {
              const dist = haversineKm(prev.lat, prev.lng, data.lat, data.lng) * 1000;
              if (dist > 1) data.bearing = computeBearing(prev.lat, prev.lng, data.lat, data.lng);
              else data.bearing = livePos.current.get(token)?.bearing;
            }
            prevPos.current.set(token, { lat: data.lat, lng: data.lng });
            livePos.current.set(token, data);
            scheduleMarkerUpdate();
          } catch { /* ignore */ }
        };
        es.onerror = () => { /* auto-reconnects */ };
        sseRefs.current.set(token, es);
      } catch { /* ignore */ }
    }

    return () => {
      for (const es of sseRefs.current.values()) { try { es.close(); } catch { /* */ } }
      sseRefs.current.clear();
    };
  }, [(invites ?? []).map((inv: Invite) => inv.token).join(",")]);

  // ── Staleness recompute timer ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => { scheduleMarkerUpdate(); }, 30_000);
    return () => clearInterval(id);
  }, [scheduleMarkerUpdate]);

  // ── Render markers ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    for (const layer of layersRef.current) { try { layer.remove(); } catch { /* */ } }
    layersRef.current = [];

    if (showJourneys) {
      const colors = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6"];
      Object.values(allByPhone).forEach((grants, i) => {
        if ((grants as Invite[]).length < 2) return;
        try {
          const sorted = [...(grants as Invite[])].sort(
            (a, b) => new Date(a.grantedAt ?? a.sentAt).getTime() - new Date(b.grantedAt ?? b.sentAt).getTime(),
          );
          const line = L.polyline(
            sorted.map((g) => [g.grantedLatitude!, g.grantedLongitude!] as [number, number]),
            { color: colors[i % colors.length], weight: 2, opacity: 0.75, dashArray: "6 4" },
          ).addTo(map);
          layersRef.current.push(line);
        } catch { /* ignore */ }
      });
    }

    if (showGeofences) {
      geofences.forEach((f) => {
        try {
          const ring = L.circle([f.latitude, f.longitude], {
            radius: f.radiusMeters, color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.07, weight: 2, dashArray: "5 4",
          }).addTo(map);
          layersRef.current.push(ring);
          const label = L.marker([f.latitude, f.longitude], {
            icon: L.divIcon({
              className: "",
              html: `<div style="transform:translate(-50%,-130%);white-space:nowrap;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.4);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;color:#c4b5fd;font-family:system-ui,sans-serif;">🛡️ ${esc(f.name)}</div>`,
              iconSize: [0, 0],
            }),
            interactive: false,
          }).addTo(map);
          layersRef.current.push(label);
        } catch { /* ignore */ }
      });
    }

    const latlngs: [number, number][] = [];

    latest.forEach((inv) => {
      const rawLive = livePos.current.get(inv.token);
      const lat = rawLive ? rawLive.lat : inv.grantedLatitude!;
      const lng = rawLive ? rawLive.lng : inv.grantedLongitude!;
      const isLive = rawLive?.status === "active" && !isLiveStale(rawLive.timestamp);

      if (!isFinite(lat) || !isFinite(lng)) return;

      // Geofence entry/exit detection — runs regardless of whether the
      // boundaries are currently drawn, so alerts fire even with the layer
      // toggled off. Only toasts on a transition (never on the first read
      // for a contact), so reopening the map doesn't flood toasts for
      // contacts already inside a fence.
      if (geofences.length > 0) {
        const prevInside = geofenceInsideRef.current.get(inv.token);
        const curInside = new globalThis.Set<number>();
        geofences.forEach((f) => {
          const distM = haversineKm(lat, lng, f.latitude, f.longitude) * 1000;
          if (distM <= f.radiusMeters) curInside.add(f.id);
        });
        if (prevInside) {
          const who = contactLabel(inv.toName, inv.toPhone);
          for (const fid of curInside) {
            if (!prevInside.has(fid)) {
              const f = geofences.find((g) => g.id === fid);
              toast({ title: `📍 ${who} entered ${f?.name ?? "a saved place"}` });
            }
          }
          for (const fid of prevInside) {
            if (!curInside.has(fid)) {
              const f = geofences.find((g) => g.id === fid);
              toast({ title: `🚪 ${who} left ${f?.name ?? "a saved place"}` });
            }
          }
        }
        geofenceInsideRef.current.set(inv.token, curInside);
      }

      try {
        const intel = applyOverride(inv.token, lat, lng, analyzeLocation(inv.grantedAddress, lat, lng));
        const pinColor = isLive ? "#10b981" : intel.pinColor;
        const grantCount = allByPhone[inv.toPhone]?.length ?? 1;

        if (isLive) {
          // Use the device's actual reported GPS accuracy for the ring radius
          // (clamped so a bad/missing fix doesn't render an invisible dot or
          // a ring that swallows the whole map) instead of a fixed guess.
          const radius = Math.min(Math.max(rawLive?.accuracy ?? 60, 15), 500);
          const ring = L.circle([lat, lng], { radius, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.12, weight: 2 }).addTo(map);
          layersRef.current.push(ring);
        }

        if (showClusters && geoClusteredPhones.has(inv.toPhone)) {
          const ring = L.circle([lat, lng], {
            radius: 2000,
            color: intel.riskLevel === "high" ? "#ef4444" : "#f59e0b",
            fillColor: intel.riskLevel === "high" ? "#ef4444" : "#f59e0b",
            fillOpacity: 0.06, weight: 1.5, dashArray: "5 4",
          }).addTo(map);
          layersRef.current.push(ring);
        }

        const telemetry = telemetryByToken.get(inv.token);
        const sessionInfo = sessionInfoByToken.get(inv.token);
        const lowBattery = isLive && telemetry?.batteryLevel != null && telemetry.batteryLevel <= 15 && !telemetry.batteryCharging;
        const marker = L.marker([lat, lng], {
          icon: makeEagleMarker(contactLabel(inv.toName, inv.toPhone), { accent: pinColor, lowBattery }),
        }).addTo(map);
        layersRef.current.push(marker);

        marker.bindPopup("", { className: "pl-popup", maxWidth: 320, minWidth: 280 });
        marker.on("popupopen", () => {
          const distRow = myPos
            ? `<div style="font-size:10px;color:#a1a1aa;margin-top:3px;">📐 ${formatDistance(haversineKm(myPos.lat, myPos.lng, lat, lng))} from you</div>`
            : "";
          const dmsStr = formatDMS(lat, lng);
          const svUrl = streetViewUrl(lat, lng); // opens Google Maps satellite view in a new tab
          const gmUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          // Prefer the freshest source we have for "when was this contact
          // last actually seen": a live SSE tick, then the polled session's
          // last DB location row, and only fall back to the original grant
          // time if we have neither — previously this always showed
          // grantedAt, which could read "5 minutes ago" for a contact who
          // hadn't moved in days.
          const lastSeenAt = rawLive?.timestamp ?? telemetry?.lastUpdate ?? null;
          const lastSeenLabel = lastSeenAt ? "Updated" : "Granted";
          const lastSeenValue = lastSeenAt ?? inv.grantedAt;

          // All untrusted values are run through esc() before HTML insertion
          marker.setPopupContent(`
            <div style="width:270px;font-family:system-ui,sans-serif;color:#f4f4f5;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:${esc(intel.pinColor)}22;border:1.5px solid ${esc(intel.pinColor)}55;display:flex;align-items:center;justify-content:center;font-weight:700;color:${esc(intel.pinColor)}">${esc(initials(inv.toName, inv.toPhone))}</div>
                <div>
                  <p style="margin:0;font-weight:700;font-size:14px;">${esc(contactLabel(inv.toName, inv.toPhone))}</p>
                  ${inv.toName ? `<p style="margin:0;font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">${esc(inv.toPhone)}</p>` : ""}
                </div>
              </div>
              <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 11px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Type</div>
                  <div style="font-size:12px;font-weight:600;color:${esc(intel.pinColor)};">${esc(intel.typeIcon)} ${esc(intel.typeLabel)}</div>
                </div>
                <div>
                  <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Risk</div>
                  ${riskBadgeHtml(intel.riskLevel)}
                </div>
              </div>
              <div style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:9px 11px;margin-bottom:10px;font-family:ui-monospace,monospace;">
                <div style="font-size:11px;font-weight:700;color:#f4f4f5;letter-spacing:0.02em;">${esc(dmsStr)}</div>
                <div style="font-size:10px;color:#71717a;margin-top:2px;">${esc(lat.toFixed(6))}, ${esc(lng.toFixed(6))}</div>
                ${inv.grantedAddress ? `<div style="font-size:10px;color:#71717a;margin-top:3px;">${esc(inv.grantedAddress.slice(0, 80))}</div>` : ""}
                <div style="font-size:10px;color:#a1a1aa;margin-top:4px;">🕒 ${lastSeenValue ? `${esc(lastSeenLabel)} ${esc(formatDistanceToNow(new Date(lastSeenValue), { addSuffix: true }))}` : "—"}</div>
                ${rawLive?.accuracy != null ? `<div style="font-size:10px;color:#a1a1aa;margin-top:2px;">🎯 ±${esc(Math.round(rawLive.accuracy))}m accuracy</div>` : ""}
                ${distRow}
              </div>
              ${(() => {
                // ── Anti-spoof trust shield ────────────────────────────────────
                const sc = rawLive?.spoofScore;
                if (sc == null) return "";
                const flags = rawLive?.spoofFlags ?? [];
                const { color, label, icon } =
                  sc <= 10 ? { color: "#10b981", label: "Trusted",          icon: "✅" } :
                  sc <= 25 ? { color: "#84cc16", label: "Low risk",         icon: "🟢" } :
                  sc <= 45 ? { color: "#f59e0b", label: "Suspicious",       icon: "⚠️" } :
                  sc <= 65 ? { color: "#f97316", label: "Likely spoofed",   icon: "🚨" } :
                             { color: "#ef4444", label: "Confirmed spoof",  icon: "🛑" };
                const flagMap: Record<string, string> = {
                  impossible_speed:        "Impossible speed",
                  implausible_speed:       "Implausible speed",
                  emulator_gpu:            "Emulator GPU",
                  vpn_proxy:               "VPN / proxy",
                  datacenter_hosting:      "Datacenter IP",
                  datacenter_org:          "Datacenter ISP",
                  zero_speed_with_motion:  "Speed field frozen",
                  activity_mismatch:       "Activity mismatch",
                  jamming_accuracy_spike:  "GPS jamming signal",
                  gps_to_network_fallback: "GPS→network drop",
                  source_flapping:         "Source flapping",
                  battery_jump:            "Battery anomaly",
                  scripted_interval:       "Scripted intervals",
                  perfect_accuracy:        "Mock accuracy",
                };
                const flagHtml = flags.length > 0
                  ? flags.slice(0, 5).map((f) =>
                      `<span style="display:inline-block;margin:2px 3px 0 0;padding:2px 6px;border-radius:4px;background:${color}18;border:1px solid ${color}50;color:${color};font-size:9px;font-weight:700;">${esc(flagMap[f] ?? f)}</span>`
                    ).join("")
                  : "";
                return `
                <div style="background:${color}0d;border:1px solid ${color}40;border-radius:8px;padding:9px 11px;margin-bottom:10px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${flags.length > 0 ? "6px" : "0"};">
                    <span style="font-size:9px;font-weight:700;letter-spacing:.1em;color:${color};text-transform:uppercase;">${icon} Trust / Anti-spoof</span>
                    <span style="font-size:11px;font-weight:800;color:${color};">${esc(label)} <span style="font-size:10px;font-weight:600;opacity:.7;">(${esc(String(sc))}/100)</span></span>
                  </div>
                  ${flagHtml ? `<div style="margin-top:2px;">${flagHtml}</div>` : ""}
                </div>`;
              })()}
              ${telemetry && (telemetry.activityType || telemetry.batteryLevel != null) ? `
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
                ${telemetry.activityType ? (() => {
                  const info = ACTIVITY_INFO[telemetry.activityType!];
                  const speedKmh = telemetry.speedMps != null && telemetry.speedMps > 0.2 ? ` · ${(telemetry.speedMps * 3.6).toFixed(1)} km/h` : "";
                  return `<span style="font-size:10px;font-weight:700;padding:3px 7px;border-radius:999px;border:1px solid ${esc(info.color)}40;background:${esc(info.color)}15;color:${esc(info.color)};">${esc(info.icon)} ${esc(info.label)}${esc(speedKmh)}</span>`;
                })() : ""}
                ${telemetry.batteryLevel != null ? `<span style="font-size:10px;font-weight:700;font-family:ui-monospace,monospace;padding:3px 7px;border-radius:999px;border:1px solid ${telemetry.batteryLevel <= 15 && !telemetry.batteryCharging ? "rgba(239,68,68,.4)" : "rgba(255,255,255,.12)"};background:${telemetry.batteryLevel <= 15 && !telemetry.batteryCharging ? "rgba(239,68,68,.12)" : "rgba(255,255,255,.05)"};color:${telemetry.batteryLevel <= 15 && !telemetry.batteryCharging ? "#fca5a5" : "#d4d4d8"};">${telemetry.batteryCharging ? "⚡" : "🔋"} ${esc(telemetry.batteryLevel)}%</span>` : ""}
              </div>` : ""}
              ${(() => {
                // ── Device fingerprint ─────────────────────────────────────────
                const di = sessionInfo?.deviceInfo;
                const device = di && typeof di.device === "object" && di.device ? di.device as Record<string, unknown> : null;
                const net = di && typeof di.network === "object" && di.network ? di.network as Record<string, unknown> : null;
                const platform = device?.platform ?? (di?.platform) ?? null;
                const model = device?.model ?? null;
                const brand = device?.brand ?? null;
                const isMobile = device?.mobile ?? null;
                const netType = net?.effectiveType ?? net?.type ?? null;
                const downlink = net?.downlink != null ? `${net.downlink} Mbps` : null;
                const ua = (device?.userAgent ?? di?.userAgent ?? sessionInfo?.openedUserAgent ?? null) as string | null;
                const browserMatch = ua ? ua.match(/(?:Chrome|Firefox|Safari|Edg|OPR|SamsungBrowser)\/([\d.]+)/i) : null;
                const browserName = browserMatch ? browserMatch[0].replace(/\/[\d.]+/, "") : null;
                const osFromUa = ua ? (
                  /Android ([\d.]+)/.exec(ua)?.[0] ??
                  /iPhone OS ([\d_]+)/.exec(ua)?.[0]?.replace(/_/g,".") ??
                  /Windows NT ([\d.]+)/.exec(ua)?.[0] ??
                  null
                ) : null;
                const rows: string[] = [];
                if (brand || model) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Device</span><span style="color:#e4e4e7;font-weight:600;">${esc([brand, model].filter(Boolean).join(" ") || "—")}</span></div>`);
                if (platform) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">OS</span><span style="color:#e4e4e7;">${esc(String(platform))}${osFromUa && !String(platform).toLowerCase().includes("android") ? ` (${esc(osFromUa)})` : ""}</span></div>`);
                if (isMobile != null) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Type</span><span style="color:#e4e4e7;">${isMobile ? "📱 Mobile" : "💻 Desktop"}</span></div>`);
                if (browserName) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Browser</span><span style="color:#e4e4e7;">${esc(browserName)}</span></div>`);
                if (netType) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Network</span><span style="color:#e4e4e7;">${esc(String(netType))}${downlink ? ` · ${esc(downlink)}` : ""}</span></div>`);
                if (sessionInfo?.source) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">GPS source</span><span style="color:#e4e4e7;">${esc(sessionInfo.source)}</span></div>`);
                return rows.length > 0 ? `
                <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.18);border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:10px;line-height:1.7;font-family:ui-monospace,monospace;">
                  <div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#34d399;text-transform:uppercase;margin-bottom:5px;">🖥 Device</div>
                  ${rows.join("")}
                </div>` : "";
              })()}
              ${(() => {
                // ── IP Intelligence ────────────────────────────────────────────
                const ip = sessionInfo?.ipInfo;
                if (!ip && !sessionInfo?.openedIp && !sessionInfo?.grantedIp) return "";
                const query = (ip?.query ?? sessionInfo?.openedIp ?? null) as string | null;
                const isp = (ip?.isp ?? ip?.org ?? null) as string | null;
                const city = (ip?.city ?? null) as string | null;
                const region = (ip?.regionName ?? null) as string | null;
                const country = (ip?.country ?? null) as string | null;
                const mobile = ip?.mobile as boolean | null;
                const proxy = ip?.proxy as boolean | null;
                const hosting = ip?.hosting as boolean | null;
                const grantedIp = sessionInfo?.grantedIp ?? null;
                const ipChanged = grantedIp && query && grantedIp !== query;
                const locationStr = [city, region, country].filter(Boolean).join(", ");
                const rows: string[] = [];
                if (query) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">IP (open)</span><span style="color:#e4e4e7;font-family:ui-monospace,monospace;">${esc(query)}</span></div>`);
                if (ipChanged) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#f59e0b;">IP (grant)</span><span style="color:#fcd34d;font-family:ui-monospace,monospace;">${esc(grantedIp!)}</span></div>`);
                if (isp) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">ISP / Carrier</span><span style="color:#e4e4e7;max-width:140px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(isp)}</span></div>`);
                if (locationStr) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">IP location</span><span style="color:#e4e4e7;max-width:150px;text-align:right;">${esc(locationStr)}</span></div>`);
                const flags: string[] = [];
                if (mobile) flags.push("📶 Mobile data");
                if (proxy) flags.push("🔀 Proxy/VPN");
                if (hosting) flags.push("🖥 Hosting/DC");
                if (flags.length) rows.push(`<div style="color:#f59e0b;margin-top:2px;">${flags.map(esc).join(" · ")}</div>`);
                return rows.length > 0 ? `
                <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:10px;line-height:1.7;">
                  <div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#f87171;text-transform:uppercase;margin-bottom:5px;">🌐 Network Identity</div>
                  ${rows.join("")}
                </div>` : "";
              })()}
              ${(() => {
                // ── Session timeline ───────────────────────────────────────────
                const openedAt = sessionInfo?.openedAt ?? null;
                const timeToGrantMs = sessionInfo?.timeToGrantMs ?? null;
                if (!openedAt && timeToGrantMs == null) return "";
                const rows: string[] = [];
                if (openedAt) rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Link opened</span><span style="color:#e4e4e7;">${esc(formatDistanceToNow(new Date(openedAt), { addSuffix: true }))}</span></div>`);
                if (timeToGrantMs != null) {
                  const secs = Math.round(timeToGrantMs / 1000);
                  const grantLabel = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
                  rows.push(`<div style="display:flex;justify-content:space-between;"><span style="color:#71717a;">Time to grant</span><span style="color:#e4e4e7;">${esc(grantLabel)}</span></div>`);
                }
                return rows.length > 0 ? `
                <div style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.18);border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:10px;line-height:1.7;">
                  <div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#a5b4fc;text-transform:uppercase;margin-bottom:5px;">⏱ Session</div>
                  ${rows.join("")}
                </div>` : "";
              })()}
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:10px;">
                <span style="font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">🔁 ${esc(grantCount)} grant${grantCount !== 1 ? "s" : ""}</span>
                <div style="display:flex;gap:6px;">
                  <a href="${esc(svUrl)}" target="_blank" rel="noreferrer" style="padding:5px 10px;background:rgba(14,165,233,.15);border:1px solid rgba(14,165,233,.3);border-radius:6px;color:#38bdf8;font-weight:600;font-size:11px;text-decoration:none;">🛣 Street View</a>
                  <a href="${esc(gmUrl)}" target="_blank" rel="noreferrer" style="padding:5px 10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#818cf8;font-weight:600;font-size:11px;text-decoration:none;">Maps ↗</a>
                </div>
              </div>
              <div id="wx-${esc(inv.id)}" style="margin-top:6px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px;padding:9px 11px;font-size:12px;color:#818cf8;">...</div>
              <div id="area-${esc(inv.id)}" style="margin-top:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:9px 11px;font-size:11px;color:#a1a1aa;">...</div>
            </div>`);

          // Async weather + area enrichment
          // Async weather + area enrichment — all external values escaped
          Promise.all([
            fetchWeather(lat, lng).catch(() => null),
            fetchAreaInfo(lat, lng).catch(() => null),
          ]).then(([wx, area]) => {
            const wxEl  = document.getElementById(`wx-${esc(inv.id)}`);
            const areaEl = document.getElementById(`area-${esc(inv.id)}`);
            if (wxEl && wx) {
              wxEl.innerHTML =
                `<strong>${esc(wx.icon)} Weather</strong> · ${esc(wx.temperature)}°C · ` +
                `${esc(wx.description)} · 💨 ${esc(wx.windSpeed)} km/h ${esc(windDirLabel(wx.windDirection))} · 💧 ${esc(wx.humidity)}%`;
            } else if (wxEl) wxEl.style.display = "none";
            if (areaEl && area) {
              const aqiInfo = area.aqi != null ? aqiLabel(area.aqi).label : "";
              areaEl.innerHTML =
                `🏙 ${esc(area.city ?? "Unknown area")} · AQI ${esc(area.aqi ?? "—")} ` +
                `<span style="font-size:10px;">${esc(aqiInfo)}</span>`;
            } else if (areaEl) areaEl.style.display = "none";
          });
        });

        latlngs.push([lat, lng]);
      } catch (err) {
        console.warn("Marker error for", inv.toPhone, err);
      }
    });

    if (myPos && isFinite(myPos.lat) && isFinite(myPos.lng)) {
      try {
        const myMarker = L.marker([myPos.lat, myPos.lng], {
          icon: makePin("#ffffff", "ME", true, heading ?? undefined), zIndexOffset: 1000,
        }).bindPopup(`<div style="color:#f4f4f5;font-family:ui-monospace,monospace;font-size:11px;"><strong>Your position</strong><br/>${formatDMS(myPos.lat, myPos.lng)}<br/><span style="color:#71717a">${myPos.lat.toFixed(6)}, ${myPos.lng.toFixed(6)}</span></div>`).addTo(map);
        layersRef.current.push(myMarker);
        myMarkerRef.current = myMarker;
        latlngs.push([myPos.lat, myPos.lng]);
      } catch { /* ignore */ }
    } else {
      myMarkerRef.current = null;
    }

    // Only auto-fit while nothing has taken manual control of the view: not
    // an AI navigation command, and not the user's own pan/zoom. Without the
    // userViewLockRef check, every background tick (SSE update, 15s
    // telemetry poll, 30s staleness sweep) would re-run fitBounds and yank a
    // manually-zoomed-in view back out to "show everyone", which is what
    // made the map appear to permanently auto-zoom-out.
    if (latlngs.length > 0 && !aiViewLocked.current && !userViewLockRef.current) {
      try {
        withProgrammaticMove(() => {
          if (latlngs.length === 1) map.setView(latlngs[0], 13);
          else map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 19 });
        });
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.map((i) => i.toPhone).join(","), tick, showJourneys, showClusters, showGeofences, geofences, myPos]);

  // ── Manual pin markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    for (const l of manualPinLayersRef.current) { try { l.remove(); } catch { /* */ } }
    manualPinLayersRef.current = [];
    for (const pin of manualPins) {
      try {
        const marker = L.marker([pin.latitude, pin.longitude], {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
              <div style="background:#f59e0b;color:#1c1917;font-size:10px;font-weight:800;font-family:system-ui,sans-serif;padding:3px 8px;border-radius:8px 8px 8px 0;border:2px solid rgba(255,255,255,0.25);box-shadow:0 3px 12px rgba(245,158,11,.6);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${esc(pin.name)}</div>
              <div style="width:2px;height:8px;background:#f59e0b;margin-top:-1px;"></div>
              <div style="width:8px;height:8px;background:#f59e0b;border-radius:50%;margin-top:-1px;box-shadow:0 0 6px rgba(245,158,11,.8);"></div>
            </div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          zIndexOffset: 500,
        }).addTo(map);
        marker.bindPopup(
          `<div style="color:#f4f4f5;font-family:system-ui,sans-serif;font-size:12px;">
            <div style="font-weight:800;font-size:14px;margin-bottom:4px;">📌 ${esc(pin.name)}</div>
            <div style="color:#a1a1aa;font-size:10px;font-family:ui-monospace,monospace;">${formatDMS(pin.latitude, pin.longitude)}</div>
            <div style="color:#71717a;font-size:10px;margin-top:1px;">${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}</div>
            <div style="margin-top:8px;display:flex;gap:8px;">
              <a href="https://www.google.com/maps?q=${pin.latitude},${pin.longitude}" target="_blank" style="color:#f59e0b;text-decoration:none;font-size:11px;font-weight:600;">Open in Maps ↗</a>
            </div>
          </div>`,
          { className: "pl-popup", maxWidth: 260, minWidth: 200 },
        );
        manualPinLayersRef.current.push(marker);
      } catch { /* ignore */ }
    }
  }, [manualPins]);

  // ── Compass marker heading update ─────────────────────────────────────────────
  useEffect(() => {
    const marker = myMarkerRef.current;
    if (!marker) return;
    try { marker.setIcon(makePin("#ffffff", "ME", true, heading ?? undefined)); } catch { /* ignore */ }
  }, [heading]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    if (compassMode && heading != null) {
      el.style.setProperty("--pl-counter-transform", `rotate(${heading}deg) scale(${(1 / 1.6).toFixed(4)})`);
    } else {
      el.style.setProperty("--pl-counter-transform", "none");
    }
  }, [compassMode, heading]);

  // ── Compass mode ──────────────────────────────────────────────────────────────
  const handleToggleCompass = async () => {
    if (compassMode) {
      compassCleanupRef.current?.();
      compassCleanupRef.current = null;
      setCompassMode(false);
      setHeading(null);
      return;
    }

    if (typeof DeviceOrientationEvent === "undefined") {
      toast({ title: "Compass not supported on this device", variant: "destructive" });
      return;
    }

    const RequestPermission = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> }).requestPermission;
    if (typeof RequestPermission === "function") {
      try {
        const result = await RequestPermission();
        if (result !== "granted") { toast({ title: "Compass permission denied", variant: "destructive" }); return; }
      } catch { toast({ title: "Could not access the compass", variant: "destructive" }); return; }
    }

    const handler = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (typeof webkitHeading === "number" && !Number.isNaN(webkitHeading)) h = webkitHeading;
      else if (typeof e.alpha === "number") h = (360 - e.alpha) % 360;
      if (h == null || Number.isNaN(h)) return;
      setHeading(h);
    };

    const eventName: "deviceorientationabsolute" | "deviceorientation" =
      "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handler as EventListener, true);
    compassCleanupRef.current = () => window.removeEventListener(eventName, handler as EventListener, true);
    setCompassMode(true);
    toast({ title: "Compass mode on", description: "The map now rotates to match the direction you're facing." });
  };

  useEffect(() => () => compassCleanupRef.current?.(), []);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const handleFindMe = () => {
    if (!navigator.geolocation) { toast({ title: "Geolocation not supported", variant: "destructive" }); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyPos({ lat: latitude, lng: longitude });
        try { mapInst.current?.flyTo([latitude, longitude], 11, { duration: 1.5 }); } catch { /* */ }
        setLocating(false);
        toast({ title: "Your position pinned", description: formatDMS(latitude, longitude) });
      },
      () => { setLocating(false); toast({ title: "Could not locate you", variant: "destructive" }); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Explicit escape hatch: once the user has manually zoomed/panned, live
  // updates stop auto-fitting the view (see userViewLockRef). This lets them
  // opt back in to "show everyone" on demand instead of it snapping back on
  // its own.
  const handleRecenter = () => {
    const map = mapInst.current;
    if (!map) return;
    aiViewLocked.current = false;
    userViewLockRef.current = false;
    const pts: [number, number][] = latestRef.current
      .map((inv) => {
        const live = livePos.current.get(inv.token);
        return live ? [live.lat, live.lng] as [number, number]
          : (isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!) ? [inv.grantedLatitude!, inv.grantedLongitude!] as [number, number] : null);
      })
      .filter((p): p is [number, number] => p != null);
    if (myPos && isFinite(myPos.lat) && isFinite(myPos.lng)) pts.push([myPos.lat, myPos.lng]);
    if (pts.length === 0) return;
    withProgrammaticMove(() => {
      if (pts.length === 1) map.setView(pts[0], 13);
      else map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 19 });
    });
    toast({ title: "Recentered on all contacts" });
  };

  // Dev-only test hooks so the zoom-lock fix can be exercised end-to-end from
  // an external test script (no production impact — stripped by import.meta.env.DEV).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__plZoomTest = {
      getZoom: () => mapInst.current?.getZoom() ?? null,
      isUserLocked: () => userViewLockRef.current,
      isAiLocked: () => aiViewLocked.current,
      forceTick: () => scheduleMarkerUpdate(),
      recenter: () => handleRecenter(),
      setMyPos: (lat: number, lng: number) => setMyPos({ lat, lng }),
    };
    return () => { delete (window as unknown as Record<string, unknown>).__plZoomTest; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), loadGeofences(), loadManualPins()]);
    setRefreshing(false);
    toast({ title: "Map refreshed" });
  };

  const handleSavePin = async () => {
    const lat = parseFloat(pinLat);
    const lng = parseFloat(pinLng);
    if (!pinName.trim() || isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      toast({ title: "Please enter a valid name, latitude (−90 to 90), and longitude (−180 to 180)", variant: "destructive" });
      return;
    }
    setPinSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/manual-pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: pinName.trim(), latitude: lat, longitude: lng }),
      });
      if (!r.ok) throw new Error("Save failed");
      const pin: ManualPin = await r.json();
      setManualPins((prev) => [...prev, pin]);
      // Fly to the new pin
      const map = mapInst.current;
      if (map) {
        userViewLockRef.current = true;
        withProgrammaticMove(() => map.flyTo([lat, lng], 14, { duration: 1.5 }));
      }
      setPinName(""); setPinLat(""); setPinLng("");
      setShowPinDialog(false);
      toast({ title: `📌 "${pin.name}" pinned on the map` });
    } catch {
      toast({ title: "Could not save pin", variant: "destructive" });
    } finally {
      setPinSaving(false);
    }
  };

  const handleDeletePin = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/manual-pins/${id}`, { method: "DELETE" });
      setManualPins((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast({ title: "Could not delete pin", variant: "destructive" });
    }
  };

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const clearDirections = useCallback(() => {
    for (const l of dirMarkersRef.current) { try { l.remove(); } catch { /* */ } }
    dirMarkersRef.current = [];
    if (dirRouteRef.current) { try { dirRouteRef.current.remove(); } catch { /* */ } dirRouteRef.current = null; }
    dirModeRef.current = false;
    setDirMode(false);
    setDirStart(null);
    setDirEnd(null);
    setDirInfo(null);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`,
        { headers: { "Accept-Language": "en" } },
      );
      if (r.ok) setSearchResults(await r.json());
    } catch { /* ignore */ }
    setSearchLoading(false);
  }, []);

  const handleSelectResult = useCallback(
    (result: { display_name: string; lat: string; lon: string }) => {
      const map = mapInst.current;
      if (!map) return;
      const lat = parseFloat(result.lat);
      const lng = parseFloat(result.lon);
      userViewLockRef.current = true;
      withProgrammaticMove(() => map.flyTo([lat, lng], 14, { duration: 1.5 }));
      setSearchQuery(result.display_name.split(",")[0]);
      setSearchResults([]);
      // Drop a brief pin so the result location is obvious
      const pin = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:14px;height:14px;background:#6366f1;border-radius:50%;border:2px solid white;box-shadow:0 2px 10px rgba(99,102,241,.8);"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7],
        }),
      }).addTo(map);
      setTimeout(() => { try { pin.remove(); } catch { /* */ } }, 8000);
    },
    [withProgrammaticMove],
  );

  const mapRotorStyle: React.CSSProperties =
    compassMode && heading != null ? { transform: `rotate(${-heading}deg) scale(1.6)` } : {};

  const MAP_MODE_ICONS: Record<MapMode, React.ReactNode> = {
    road: <MapIcon className="w-3.5 h-3.5" />,
    hybrid: <Satellite className="w-3.5 h-3.5" />,
    terrain: <Mountain className="w-3.5 h-3.5" />,
  };

  return (
    <div
      className={`relative -m-4 md:-m-8 ${compassMode ? "pl-compass-mode" : ""}`}
      style={{ height: "calc(100vh - 64px)", minHeight: 400 }}
    >
      <MapCloudReveal />
      {/* ── Full-bleed map canvas ── */}
      <div ref={mapRef} className="pl-map-rotor absolute inset-0" style={mapRotorStyle} />

      {/* ════════════════════════════════════════
          TOP BAR: search pill + quick chips
      ════════════════════════════════════════ */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-col gap-2 pointer-events-none">

        {/* Search pill — mirrors Google Maps' floating search bar */}
        <div
          className="flex items-center gap-2.5 rounded-full px-3 py-2 pointer-events-auto"
          style={{
            background: "hsl(var(--card) / 0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid hsl(var(--border))",
            boxShadow: "0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* App logo dot */}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--primary))" }}
          >
            <MapPin className="w-4 h-4 text-white" />
          </div>

          {/* Input or placeholder */}
          {showSearch ? (
            <>
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search places…"
                className="flex-1 bg-transparent text-sm outline-none min-w-0"
                style={{ color: "hsl(var(--foreground))" }}
              />
              {searchLoading && (
                <div
                  className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                  style={{ borderColor: "hsl(var(--primary) / 0.4)", borderTopColor: "hsl(var(--primary))" }}
                />
              )}
              <button
                onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}
                className="flex-shrink-0 transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              className="flex-1 text-sm text-left transition-colors"
              style={{ color: "hsl(var(--muted-foreground))" }}
              onClick={() => setShowSearch(true)}
            >
              Search here
            </button>
          )}

          {/* Divider */}
          {!showSearch && (
            <>
              <button
                onClick={() => setShowSearch(true)}
                className="flex-shrink-0 transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                <Search className="w-4 h-4" />
              </button>
              <div className="w-px h-5 flex-shrink-0" style={{ background: "hsl(var(--border))" }} />
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2"
                style={{
                  background: "hsl(var(--primary) / 0.15)",
                  borderColor: "hsl(var(--primary) / 0.4)",
                }}
              >
                <span className="text-[10px] font-black" style={{ color: "hsl(var(--primary))" }}>PL</span>
              </div>
            </>
          )}
        </div>

        {/* Search results dropdown */}
        {showSearch && (searchResults.length > 0 || (!searchLoading && searchQuery.trim())) && (
          <div
            className="rounded-2xl overflow-hidden pointer-events-auto"
            style={{
              background: "hsl(var(--card) / 0.98)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
            }}
          >
            {searchResults.length > 0 ? (
              <div className="divide-y" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                {searchResults.map((r) => (
                  <button
                    key={r.place_id}
                    onClick={() => handleSelectResult(r)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:opacity-80"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "hsl(var(--muted))" }}
                    >
                      <MapPin className="w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                        {r.display_name.split(",")[0]}
                      </p>
                      <p className="text-xs truncate mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {r.display_name.split(",").slice(1, 3).join(", ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                No results found
              </p>
            )}
          </div>
        )}

        {/* Quick-action chips row — like Google Maps' "Home · 25 min" pills */}
        {!showSearch && (
          <div className="flex gap-2 overflow-x-auto pointer-events-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
            <MapChip
              icon={<Crosshair className="w-3.5 h-3.5" />}
              label={locating ? "Locating…" : "Find me"}
              onClick={handleFindMe}
              disabled={locating}
            />
            <MapChip
              icon={<Maximize2 className="w-3.5 h-3.5" />}
              label="Recenter"
              onClick={handleRecenter}
            />
            <MapChip
              icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />}
              label="Refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            />
            <MapChip
              icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
              label={dirMode ? "Cancel dir." : "Directions"}
              onClick={() => { if (dirMode) clearDirections(); else { clearDirections(); setDirMode(true); } }}
              active={dirMode}
            />
            <MapChip
              icon={<Flame className="w-3.5 h-3.5" />}
              label={heatLoading ? "Loading…" : "Heatmap"}
              onClick={() => setShowHeatmap((v) => !v)}
              active={showHeatmap}
              disabled={heatLoading && !showHeatmap}
            />
            <MapChip
              icon={<TrafficCone className="w-3.5 h-3.5" />}
              label="Traffic"
              onClick={() => toggleDetail("traffic")}
              active={activeDetails.has("traffic")}
            />
            <MapChip
              icon={<BookmarkPlus className="w-3.5 h-3.5" />}
              label="Add Pin"
              onClick={() => setShowPinDialog(true)}
            />
            <MapChip
              icon={<Download className="w-3.5 h-3.5" />}
              label="Export"
              onClick={() => csvExport(granted)}
              disabled={granted.length === 0}
            />
          </div>
        )}
      </div>

      {/* Compass readout badge — floats below search when active */}
      {compassMode && (
        <div className="absolute top-28 left-3 z-[1000]">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{
              background: "hsl(var(--card) / 0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          >
            <Compass
              className="w-4 h-4 text-sky-400 flex-shrink-0"
              style={heading != null ? { transform: `rotate(${heading}deg)` } : undefined}
            />
            <span className="text-xs font-mono tabular-nums" style={{ color: "hsl(var(--foreground))" }}>
              {heading != null ? `${Math.round(heading)}° ${cardinal(heading)}` : "Locating…"}
            </span>
          </div>
        </div>
      )}

      {/* Directions info banner — floats top-center */}
      {(dirMode || dirInfo) && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[1002]">
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-full"
            style={{
              background: "hsl(var(--card) / 0.97)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {dirMode && !dirStart && (
              <span className="text-xs font-semibold text-emerald-400">📍 Click to set start point</span>
            )}
            {dirMode && dirStart && !dirEnd && (
              <span className="text-xs font-semibold text-red-400">📍 Click to set destination</span>
            )}
            {dirInfo && (
              <>
                <Navigation2 className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--primary))" }} />
                <span className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>{dirInfo.distanceKm} km</span>
                <div className="w-px h-4" style={{ background: "hsl(var(--border))" }} />
                <span className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>{dirInfo.durationMin} min</span>
              </>
            )}
            <button
              onClick={clearDirections}
              className="ml-1 transition-colors"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Street View panel */}
      {streetView && (
        <div
          className="absolute inset-x-3 top-28 z-[1001] overflow-hidden rounded-3xl"
          style={{
            height: 280,
            background: "hsl(var(--card) / 0.98)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid hsl(var(--border))",
            boxShadow: "0 20px 64px rgba(0,0,0,0.65)",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            <div>
              <span className="text-xs font-black text-sky-400 uppercase tracking-[0.15em]">Street View</span>
              <span className="text-xs ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>{streetView.name}</span>
            </div>
            <button
              onClick={() => setStreetView(null)}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {svLoading ? (
            <div className="flex items-center justify-center text-xs" style={{ height: 238, color: "hsl(var(--muted-foreground))" }}>
              Looking for nearby street-level photos…
            </div>
          ) : svResult?.available && svResult.imageUrl ? (
            <div className="relative w-full overflow-hidden" style={{ height: 238 }}>
              <img
                src={svResult.imageUrl}
                alt={`Street-level view near ${streetView.name}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <a
                href={svResult.imageId ? mapillaryViewerUrl(svResult.imageId) : streetViewUrl(streetView.lat, streetView.lng)}
                target="_blank" rel="noreferrer"
                className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/75 hover:bg-black/90 text-white text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm transition-all"
              >
                Mapillary →
              </a>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-center px-6" style={{ height: 238 }}>
              <Eye className="w-8 h-8 opacity-20" style={{ color: "hsl(var(--foreground))" }} />
              <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                No street-level imagery available near this location.
              </span>
              <a
                href={streetViewUrl(streetView.lat, streetView.lng)}
                target="_blank" rel="noreferrer"
                className="text-xs underline"
                style={{ color: "hsl(var(--primary))" }}
              >
                Open satellite view →
              </a>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          MAP TYPE PANEL — slides up from bottom
      ════════════════════════════════════════ */}
      {showTypePanel && (
        <div
          className="absolute inset-0 z-[1002] flex items-end justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
          onClick={() => setShowTypePanel(false)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-3xl"
            style={{
              background: "hsl(var(--card) / 0.98)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 -8px 64px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <h3 className="text-base font-black" style={{ color: "hsl(var(--foreground))" }}>Map type</h3>
              <button
                onClick={() => setShowTypePanel(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Map mode thumbnails */}
            <div className="grid grid-cols-3 gap-3 px-5 py-4">
              {MAP_MODES.map((m) => (
                <button key={m} onClick={() => setMapMode(m)} className="flex flex-col items-center gap-2 group">
                  <div
                    className="w-full aspect-square rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all"
                    style={{
                      border: mapMode === m ? "2px solid hsl(var(--accent))" : "1px solid hsl(var(--border))",
                      background: mapMode === m ? "hsl(var(--accent) / 0.15)" : "hsl(var(--muted) / 0.5)",
                      boxShadow: mapMode === m ? "0 0 20px hsl(var(--accent) / 0.25)" : "none",
                    }}
                  >
                    {MAP_MODE_ICONS[m]}
                  </div>
                  <span
                    className="text-xs font-bold"
                    style={{ color: mapMode === m ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}
                  >
                    {MAP_MODE_LABELS[m]}
                  </span>
                </button>
              ))}
            </div>

            {/* Map detail toggles */}
            <div className="px-5 pb-5" style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 16 }}>
              <h4 className="text-sm font-bold mb-3" style={{ color: "hsl(var(--foreground))" }}>Map details</h4>
              <div className="grid grid-cols-4 gap-3">
                {MAP_DETAILS.map((d) => {
                  const isOn = d.id === "streetview" ? streetView != null : activeDetails.has(d.id);
                  return (
                    <button key={d.id} onClick={() => toggleDetail(d.id)} className="flex flex-col items-center gap-1.5">
                      <div
                        className="w-full aspect-square rounded-xl flex items-center justify-center transition-all"
                        style={{
                          background: isOn ? "hsl(var(--accent) / 0.2)" : "hsl(var(--muted) / 0.5)",
                          border: isOn ? "1px solid hsl(var(--accent) / 0.5)" : "1px solid hsl(var(--border))",
                          color: isOn ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
                          opacity: !d.live ? 0.5 : 1,
                        }}
                      >
                        {d.icon}
                      </div>
                      <span className="text-[10px] text-center leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {d.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          RIGHT SIDE FABs — stacked vertically
          (like Google Maps' layer + compass stack)
      ════════════════════════════════════════ */}
      <div className="absolute right-3 z-[1000] flex flex-col gap-2" style={{ bottom: 212 }}>
        {/* Zoom in */}
        <MapFab
          icon={<Plus className="w-5 h-5" />}
          onClick={() => { mapInst.current?.zoomIn(1, { animate: true }); }}
          label="Zoom in"
        />
        {/* Zoom out */}
        <MapFab
          icon={<Minus className="w-5 h-5" />}
          onClick={() => { mapInst.current?.zoomOut(1, { animate: true }); }}
          label="Zoom out"
        />
      </div>

      <div className="absolute right-3 z-[1000] flex flex-col gap-2" style={{ bottom: 360 }}>
        {/* Map type/layers */}
        <MapFab
          icon={<Settings2 className="w-5 h-5" />}
          onClick={() => setShowTypePanel(true)}
          active={showTypePanel || activeDetails.size > 0}
          label="Map type"
        />
        {/* Compass */}
        <MapFab
          icon={
            <Compass
              className="w-5 h-5"
              style={heading != null && compassMode ? { transform: `rotate(${heading}deg)` } : undefined}
            />
          }
          onClick={handleToggleCompass}
          active={compassMode}
          label="Compass"
        />
        {/* Fullscreen */}
        <MapFab
          icon={<Maximize2 className="w-5 h-5" />}
          onClick={handleFullscreen}
          active={isFullscreen}
          label="Fullscreen"
        />
      </div>

      {/* Primary navigation FAB — large teal, bottom-right above sheet */}
      <button
        onClick={handleFindMe}
        disabled={locating}
        className="absolute right-3 z-[1001] w-14 h-14 rounded-2xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
        style={{
          bottom: 158,
          background: "hsl(var(--accent))",
          boxShadow: "0 8px 32px hsl(var(--accent) / 0.55), 0 2px 8px rgba(0,0,0,0.35)",
        }}
        title="Find my location"
      >
        <Navigation2 className="w-6 h-6 text-white" />
      </button>

      {/* ════════════════════════════════════════
          BOTTOM SHEET — info + tab nav
          mirrors Google Maps' slide-up panel
      ════════════════════════════════════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000]">
        <div
          className="rounded-t-[28px] pt-3"
          style={{
            background: "hsl(var(--card) / 0.97)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderTop: "1px solid hsl(var(--border))",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.45)",
          }}
        >
          {/* Drag handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 rounded-full" style={{ background: "hsl(var(--muted-foreground) / 0.3)" }} />
          </div>

          {/* Info row */}
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black truncate" style={{ color: "hsl(var(--foreground))" }}>
                {MAP_MODE_LABELS[mapMode]} View
                {activeDetails.size > 0 && (
                  <span className="ml-2 text-xs font-bold" style={{ color: "hsl(var(--accent))" }}>
                    +{activeDetails.size} layer{activeDetails.size > 1 ? "s" : ""}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {latest.length} contact{latest.length !== 1 ? "s" : ""} · {granted.length} granted
                </span>
                {liveCount > 0 && (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    {liveCount} live
                  </span>
                )}
                {showClusters && clusterCount > 0 && (
                  <span className="text-xs font-bold text-amber-400">{clusterCount} clusters</span>
                )}
              </div>
            </div>
            {myPos && (
              <div
                className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2"
                style={{
                  background: "hsl(var(--primary) / 0.15)",
                  borderColor: "hsl(var(--primary) / 0.4)",
                }}
              >
                <LocateFixed className="w-4 h-4" style={{ color: "hsl(var(--primary))" }} />
              </div>
            )}
            {/* Expand / up-swipe affordance */}
            <button
              onClick={() => setShowTypePanel(true)}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>

          {/* Tab bar — like Google Maps Explore / You / Contribute */}
          <div className="grid grid-cols-4" style={{ borderTop: "1px solid hsl(var(--border))" }}>
            <BottomTab
              icon={<Layers className="w-5 h-5" />}
              label="Journeys"
              active={showJourneys}
              onClick={() => setShowJourneys((v) => !v)}
            />
            <BottomTab
              icon={<AlertTriangle className="w-5 h-5" />}
              label={clusterCount > 0 ? `Clusters (${clusterCount})` : "Clusters"}
              active={showClusters}
              onClick={() => setShowClusters((v) => !v)}
            />
            <BottomTab
              icon={<ShieldCheck className="w-5 h-5" />}
              label="Geofences"
              active={showGeofences}
              onClick={() => setShowGeofences((v) => !v)}
              disabled={geofences.length === 0}
            />
            <BottomTab
              icon={<Eye className="w-5 h-5" />}
              label="Street View"
              active={streetView != null}
              onClick={() => toggleDetail("streetview")}
            />
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          ADD PIN DIALOG — enter name + coordinates
      ════════════════════════════════════════ */}
      {showPinDialog && (
        <div
          className="absolute inset-0 z-[2000] flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPinDialog(false); }}
        >
          <div
            className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-5"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "hsl(var(--primary) / 0.15)" }}
              >
                <BookmarkPlus className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-base" style={{ color: "hsl(var(--foreground))" }}>Pin a Location</p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Save coordinates directly to your map</p>
              </div>
              <button
                onClick={() => setShowPinDialog(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Fields */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Name</label>
                <input
                  type="text"
                  value={pinName}
                  onChange={(e) => setPinName(e.target.value)}
                  placeholder="e.g. John's last known location"
                  className="rounded-xl px-3 py-2.5 text-sm outline-none w-full"
                  style={{
                    background: "hsl(var(--muted))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSavePin()}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Latitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pinLat}
                    onChange={(e) => setPinLat(e.target.value)}
                    placeholder="e.g. 40.7128"
                    className="rounded-xl px-3 py-2.5 text-sm outline-none w-full font-mono"
                    style={{
                      background: "hsl(var(--muted))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Longitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pinLng}
                    onChange={(e) => setPinLng(e.target.value)}
                    placeholder="e.g. -74.0060"
                    className="rounded-xl px-3 py-2.5 text-sm outline-none w-full font-mono"
                    style={{
                      background: "hsl(var(--muted))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleSavePin()}
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Paste coordinates in decimal degrees (e.g. <span className="font-mono">40.7128, -74.0060</span>)
              </p>
            </div>

            {/* Saved pins list */}
            {manualPins.length > 0 && (
              <div
                className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid hsl(var(--border))" }}
              >
                <div
                  className="px-3 py-2 text-xs font-bold uppercase tracking-wider"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                >
                  Saved Pins ({manualPins.length})
                </div>
                <div className="divide-y max-h-40 overflow-y-auto" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                  {manualPins.map((pin) => (
                    <div key={pin.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(245,158,11,0.15)" }}>
                        <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>{pin.name}</p>
                        <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeletePin(pin.id)}
                        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                        style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}
                        title="Remove pin"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowPinDialog(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePin}
                disabled={pinSaving || !pinName.trim() || !pinLat || !pinLng}
                className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-40"
                style={{ background: "hsl(var(--primary))", color: "#fff" }}
              >
                {pinSaving ? "Saving…" : "📌 Pin It"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Google Maps–style helper components ───────────────────────────────────────

/** Pill chip in the quick-action row below the search bar */
function MapChip({
  icon, label, onClick, active = false, disabled = false,
}: {
  icon: React.ReactNode; label: string; onClick: () => void;
  active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all disabled:opacity-40 active:scale-95"
      style={{
        background: active ? "hsl(var(--primary))" : "hsl(var(--card) / 0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: active ? "1px solid hsl(var(--primary))" : "1px solid hsl(var(--border))",
        color: active ? "#ffffff" : "hsl(var(--foreground))",
        boxShadow: active
          ? "0 4px 16px hsl(var(--primary) / 0.4)"
          : "0 2px 10px rgba(0,0,0,0.35)",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Square FAB on the right side of the map */
function MapFab({
  icon, onClick, active = false, disabled = false, label,
}: {
  icon: React.ReactNode; onClick: () => void;
  active?: boolean; disabled?: boolean; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all disabled:opacity-40 active:scale-95"
      style={{
        background: active ? "hsl(var(--accent) / 0.2)" : "hsl(var(--card) / 0.95)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: active ? "1px solid hsl(var(--accent) / 0.5)" : "1px solid hsl(var(--border))",
        color: active ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
      }}
    >
      {icon}
    </button>
  );
}

/** Tab button in the bottom navigation bar */
function BottomTab({
  icon, label, active = false, onClick, disabled = false,
}: {
  icon: React.ReactNode; label: string;
  active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 py-2.5 transition-all disabled:opacity-40 active:opacity-70"
      style={{ color: active ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}
    >
      {icon}
      <span
        className="text-[10px] font-semibold truncate max-w-full px-1 leading-tight"
        style={{ color: active ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
    </button>
  );
}
