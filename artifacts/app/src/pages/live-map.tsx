import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { onMapCommand, registerMapContext } from "@/lib/map-command-bus";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Flame, X, Compass, Map as MapIcon, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, windDirLabel } from "@/hooks/use-weather";
import { fetchAreaInfo, aqiLabel } from "@/hooks/use-area-info";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";
import { fetchStreetView, streetViewUrl, type StreetViewResult } from "@/lib/maps-config";

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
// lyrs=s: satellite only · lyrs=y: hybrid (satellite + roads/labels) · lyrs=m: roadmap
const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
const ROAD_URL      = "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";

type MapMode = "satellite" | "hybrid" | "road";
const MAP_MODES: MapMode[] = ["satellite", "hybrid", "road"];
const MAP_MODE_LABELS: Record<MapMode, string> = {
  satellite: "Satellite",
  hybrid: "Hybrid",
  road: "Road",
};

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

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
}

function riskBadgeHtml(level: "low" | "medium" | "high") {
  const m = {
    low:    { bg: "rgba(16,185,129,.15)",  border: "rgba(16,185,129,.4)",  text: "#6ee7b7", label: "LOW RISK"  },
    medium: { bg: "rgba(245,158,11,.15)",  border: "rgba(245,158,11,.4)",  text: "#fcd34d", label: "MODERATE"  },
    high:   { bg: "rgba(239,68,68,.15)",   border: "rgba(239,68,68,.4)",   text: "#fca5a5", label: "HIGH RISK" },
  }[level];
  return `<span style="display:inline-flex;align-items:center;gap:3px;background:${m.bg};border:1px solid ${m.border};border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:0.06em;color:${m.text}">${m.label}</span>`;
}

function makePin(color: string, label: string, isMine = false, bearing?: number) {
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
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size + 12}px;filter:drop-shadow(0 4px 12px ${color}66);">
      <div class="pl-pin-upright" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;">
        <div style="width:${size}px;height:${size}px;background:${bg};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.06);border-radius:10px;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${isMine ? 12 : 11}px;font-weight:800;color:${fg};">${label}</div>
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:4px;height:10px;background:${bg};clip-path:polygon(50% 100%,0% 0%,100% 0%);"></div>
      </div>
      ${arrow}
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
  a.download = `phonelink-${format(new Date(), "yyyy-MM-dd")}.csv`;
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
  const [liveCount,    setLiveCount   ] = useState(0);
  const [myPos,        setMyPos       ] = useState<{ lat: number; lng: number } | null>(null);
  const [locating,     setLocating    ] = useState(false);
  const [refreshing,   setRefreshing  ] = useState(false);
  const [tick,         setTick        ] = useState(0);
  const [heatLoading,  setHeatLoading ] = useState(false);
  const [compassMode,  setCompassMode ] = useState(false);
  const [heading,      setHeading     ] = useState<number | null>(null);
  const [mapMode,         setMapMode        ] = useState<MapMode>("satellite");
  const [streetView,      setStreetView     ] = useState<StreetViewPos | null>(null);
  const [svResult,        setSvResult       ] = useState<StreetViewResult | null>(null);
  const [svLoading,       setSvLoading      ] = useState(false);

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
      const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInst.current = map;

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
      if (mapMode === "road") {
        tileBaseRef.current = L.tileLayer(ROAD_URL, {
          maxZoom: 20,
          subdomains: "0123",
          attribution: '© Google Maps',
        }).addTo(map);
        tileLabelRef.current = null;
      } else if (mapMode === "hybrid") {
        // Hybrid is already satellite + roads/labels in a single Google tile layer.
        tileBaseRef.current = L.tileLayer(LABELS_URL, {
          maxZoom: 20,
          subdomains: "0123",
          attribution: '© Google Maps',
        }).addTo(map);
        tileLabelRef.current = null;
      } else {
        tileBaseRef.current = L.tileLayer(SATELLITE_URL, {
          maxZoom: 20,
          subdomains: "0123",
          attribution: '© Google Maps',
        }).addTo(map);
        tileLabelRef.current = null;
      }
    } catch (err) {
      console.error("Tile layer error:", err);
    }
  }, [mapMode]);

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
      aiViewLocked.current = true;
      if (cmd.type === "flyTo") map.flyTo([cmd.lat, cmd.lng], cmd.zoom ?? 14, { duration: 1.2 });
      else if (cmd.type === "fitAll") {
        const pts = latestRef.current.map(
          (i) => [i.grantedLatitude!, i.grantedLongitude!] as [number, number],
        );
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 19 });
      }
    });
    return () => { unregister(); cleanup(); };
  // Only re-run when the map instance first becomes available — state is read
  // through refs above so they never go stale without re-registering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInst.current != null]);

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

    const latlngs: [number, number][] = [];

    latest.forEach((inv) => {
      const rawLive = livePos.current.get(inv.token);
      const lat = rawLive ? rawLive.lat : inv.grantedLatitude!;
      const lng = rawLive ? rawLive.lng : inv.grantedLongitude!;
      const isLive = rawLive?.status === "active" && !isLiveStale(rawLive.timestamp);

      if (!isFinite(lat) || !isFinite(lng)) return;

      try {
        const intel = applyOverride(inv.token, lat, lng, analyzeLocation(inv.grantedAddress, lat, lng));
        const pinColor = isLive ? "#10b981" : intel.pinColor;
        const grantCount = allByPhone[inv.toPhone]?.length ?? 1;

        if (isLive) {
          const ring = L.circle([lat, lng], { radius: 60, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.12, weight: 2 }).addTo(map);
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

        const marker = L.marker([lat, lng], { icon: makePin(pinColor, initials(inv.toName), false, isLive ? rawLive?.bearing : undefined) }).addTo(map);
        layersRef.current.push(marker);

        marker.bindPopup("", { className: "pl-popup", maxWidth: 320, minWidth: 280 });
        marker.on("popupopen", () => {
          const distRow = myPos
            ? `<div style="font-size:10px;color:#a1a1aa;margin-top:3px;">📐 ${formatDistance(haversineKm(myPos.lat, myPos.lng, lat, lng))} from you</div>`
            : "";
          const dmsStr = formatDMS(lat, lng);
          const svUrl = streetViewUrl(lat, lng); // opens Google Maps satellite view in a new tab
          const gmUrl = `https://www.google.com/maps?q=${lat},${lng}`;

          // All untrusted values are run through esc() before HTML insertion
          marker.setPopupContent(`
            <div style="width:270px;font-family:system-ui,sans-serif;color:#f4f4f5;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:${esc(intel.pinColor)}22;border:1.5px solid ${esc(intel.pinColor)}55;display:flex;align-items:center;justify-content:center;font-weight:700;color:${esc(intel.pinColor)}">${esc(initials(inv.toName))}</div>
                <div>
                  <p style="margin:0;font-weight:700;font-size:14px;">${esc(inv.toName ?? "Unknown")}</p>
                  <p style="margin:0;font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">${esc(inv.toPhone)}</p>
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
                <div style="font-size:10px;color:#a1a1aa;margin-top:4px;">🕒 ${inv.grantedAt ? esc(formatDistanceToNow(new Date(inv.grantedAt), { addSuffix: true })) : "—"}</div>
                ${distRow}
              </div>
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

    if (latlngs.length > 0 && !aiViewLocked.current) {
      try {
        if (latlngs.length === 1) map.setView(latlngs[0], 13);
        else map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 19 });
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.map((i) => i.toPhone).join(","), tick, showJourneys, showClusters, myPos]);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    toast({ title: "Map refreshed" });
  };

  const cycleMapMode = () => {
    setMapMode((prev) => {
      const idx = MAP_MODES.indexOf(prev);
      const next = MAP_MODES[(idx + 1) % MAP_MODES.length];
      toast({ title: `Map: ${MAP_MODE_LABELS[next]}` });
      return next;
    });
  };

  const mapRotorStyle: React.CSSProperties =
    compassMode && heading != null ? { transform: `rotate(${-heading}deg) scale(1.6)` } : {};

  const mapModeIcon = mapMode === "road" ? <MapIcon className="w-3.5 h-3.5" /> : <Satellite className="w-3.5 h-3.5" />;

  return (
    <div className={`relative flex flex-col -m-4 md:-m-8 ${compassMode ? "pl-compass-mode" : ""}`} style={{ height: "calc(100vh - 64px)", minHeight: 400 }}>
      {/* Map viewport */}
      <div className="relative flex-1 w-full overflow-hidden" style={{ zIndex: 0, minHeight: 300 }}>
        <div ref={mapRef} className="pl-map-rotor absolute inset-0" style={mapRotorStyle} />
      </div>

      {/* HUD — top left */}
      <div className="absolute top-3 left-3 z-[1000] pointer-events-none">
        <div className="pl-hud-card flex items-center gap-4 px-4 py-2.5">
          <HudStat label="Contacts" value={latest.length} />
          <div className="w-px h-7 bg-white/10" />
          <HudStat label="Grants" value={granted.length} />
          {liveCount > 0 && <><div className="w-px h-7 bg-white/10" /><HudStat label="Live" value={liveCount} accent="#10b981" /></>}
          {showClusters && clusterCount > 0 && <><div className="w-px h-7 bg-white/10" /><HudStat label="Flags" value={clusterCount} accent="#f59e0b" /></>}
          {myPos && <><div className="w-px h-7 bg-white/10" /><HudStat label="You" value="📍" /></>}
          <div className="w-px h-7 bg-white/10" />
          <HudStat label="View" value={MAP_MODE_LABELS[mapMode]} accent="#a1a1aa" />
        </div>
      </div>

      {/* Compass readout — top right */}
      {compassMode && (
        <div className="absolute top-3 right-3 z-[1000] pointer-events-none">
          <div className="pl-hud-card flex items-center gap-2 px-3 py-2">
            <Compass className="w-4 h-4 text-sky-400 flex-shrink-0" style={heading != null ? { transform: `rotate(${heading}deg)` } : undefined} />
            <span className="text-xs font-mono text-zinc-300 tabular-nums">
              {heading != null ? `${Math.round(heading)}° ${cardinal(heading)}` : "Locating…"}
            </span>
          </div>
        </div>
      )}

      {/* Street View panel */}
      {streetView && (
        <div className="absolute inset-x-3 top-14 z-[1001] bg-[#111113] border border-white/10 rounded-2xl overflow-hidden shadow-2xl" style={{ height: 280 }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
            <div>
              <span className="text-xs font-bold text-sky-400 uppercase tracking-widest">Street View</span>
              <span className="text-xs text-zinc-500 ml-2">{streetView.name}</span>
            </div>
            <button onClick={() => setStreetView(null)} className="text-zinc-500 hover:text-zinc-200 transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          {svLoading ? (
            <div className="flex items-center justify-center text-xs text-zinc-500" style={{ height: 238 }}>
              Looking for nearby street-level photos…
            </div>
          ) : svResult?.available && svResult.embedUrl ? (
            <iframe
              title="Street View"
              src={svResult.embedUrl}
              className="w-full border-0"
              style={{ height: 238 }}
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ height: 238 }}>
              <span className="text-xs text-zinc-500">No street-level imagery available near this location.</span>
              <a
                href={streetViewUrl(streetView.lat, streetView.lng)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 underline"
              >
                View satellite map instead
              </a>
            </div>
          )}
        </div>
      )}

      {/* Command bar — bottom center */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="pl-command-bar flex items-center gap-0.5 px-1.5 py-1.5">
          <CmdBtn active={false} onClick={handleFindMe} disabled={locating} icon={<Crosshair className="w-3.5 h-3.5" />} label={locating ? "Locating…" : "Find me"} />
          <CmdBtn active={false} onClick={handleRefresh} disabled={refreshing} icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />} label="Refresh" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={mapMode !== "satellite"} onClick={cycleMapMode} icon={mapModeIcon} label={MAP_MODE_LABELS[mapMode]} activeClass="border-violet-500/40 text-violet-300 bg-violet-500/10" />
          <CmdBtn active={streetView != null} onClick={() => {
            const first = latest[0];
            if (!first) { toast({ title: "No contacts to show Street View for", variant: "destructive" }); return; }
            const rawLive = livePos.current.get(first.token);
            const lat = rawLive ? rawLive.lat : first.grantedLatitude!;
            const lng = rawLive ? rawLive.lng : first.grantedLongitude!;
            setStreetView(streetView ? null : { lat, lng, name: first.toName ?? "Contact" });
          }} icon={<Eye className="w-3.5 h-3.5" />} label="Street View" activeClass="border-sky-500/40 text-sky-300 bg-sky-500/10" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={compassMode} onClick={handleToggleCompass} icon={<Compass className="w-3.5 h-3.5" />} label={compassMode ? "Compass on" : "Compass"} activeClass="border-sky-500/40 text-sky-300 bg-sky-500/10" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={showJourneys} onClick={() => setShowJourneys((v) => !v)} icon={<Layers className="w-3.5 h-3.5" />} label="Journeys" activeClass="border-indigo-500/40 text-indigo-300 bg-indigo-500/10" />
          <CmdBtn active={showClusters} onClick={() => setShowClusters((v) => !v)} icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Clusters" activeClass="border-amber-500/40 text-amber-300 bg-amber-500/10" />
          <CmdBtn active={showHeatmap} onClick={() => setShowHeatmap((v) => !v)} disabled={heatLoading && !showHeatmap} icon={<Flame className="w-3.5 h-3.5" />} label={heatLoading ? "Loading…" : "Heat"} activeClass="border-orange-500/40 text-orange-300 bg-orange-500/10" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={false} onClick={() => csvExport(granted)} disabled={granted.length === 0} icon={<Download className="w-3.5 h-3.5" />} label="Export" />
        </div>
      </div>
    </div>
  );
}

function HudStat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="flex flex-col items-center min-w-[36px]">
      <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">{label}</span>
      <span className="text-sm font-black font-mono leading-none" style={{ color: accent ?? "#f4f4f5" }}>{value}</span>
    </div>
  );
}

function CmdBtn({
  active, onClick, icon, label, activeClass = "", disabled = false,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  label: string; activeClass?: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold font-mono transition-all disabled:opacity-40 ${
        active ? activeClass : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-white/10"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
