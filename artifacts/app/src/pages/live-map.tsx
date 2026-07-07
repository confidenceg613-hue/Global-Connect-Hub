import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { onMapCommand, registerMapContext } from "@/lib/map-command-bus";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Siren, Flame, X, Camera, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, windDirLabel } from "@/hooks/use-weather";
import { fetchAreaInfo, aqiLabel } from "@/hooks/use-area-info";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// A live position is considered stale (and treated as offline) if the last
// "active" update arrived more than 5 minutes ago — handles devices that
// lose connectivity without sending an explicit "offline" ping.
// 5 min threshold is generous enough to survive GPS pauses and brief network gaps.
function isLiveStale(timestamp: string): boolean {
  return differenceInMinutes(new Date(), new Date(timestamp)) >= 5;
}

interface LivePos {
  lat: number;
  lng: number;
  accuracy?: number;
  status: "active" | "offline";
  timestamp: string;
  bearing?: number; // degrees 0–360, calculated from previous position
}

function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";

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
  // Compass arrow: shown when bearing is known, rotated to direction of travel
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
      <div style="width:${size}px;height:${size}px;background:${bg};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.06);border-radius:10px;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${isMine ? 12 : 11}px;font-weight:800;color:${fg};">${label}</div>
      <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:4px;height:10px;background:${bg};clip-path:polygon(50% 100%,0% 0%,100% 0%);"></div>
      ${arrow}
    </div>`,
    iconSize: [size, size + 12],
    iconAnchor: [size / 2, size + 12],
    popupAnchor: [0, -(size + 16)],
  });
}

function csvExport(grants: Invite[]) {
  const cols = ["ID", "Contact", "Phone", "Latitude", "Longitude", "Address", "Granted At"];
  const rows = grants.map((g) => [
    g.id,
    `"${(g.toName ?? "Unknown").replace(/"/g, '""')}"`,
    g.toPhone,
    g.grantedLatitude ?? "",
    g.grantedLongitude ?? "",
    `"${(g.grantedAddress ?? "").replace(/"/g, '""')}"`,
    g.grantedAt ? format(new Date(g.grantedAt), "yyyy-MM-dd HH:mm:ss") : "",
  ]);
  const csv = [cols, ...rows].map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `phonelink-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
}

export default function LiveMap() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInst     = useRef<L.Map | null>(null);
  const layersRef   = useRef<L.Layer[]>([]);
  const sseRefs     = useRef<Map<string, EventSource>>(new Map());
  const livePos     = useRef<Map<string, LivePos>>(new Map());

  // throttle/batch updates to avoid causing a React re-render and Leaflet redraw
  // for every incoming SSE frame which can cause UI jank on mobile.
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
  const [tick,         setTick        ] = useState(0); // forces marker refresh
  const [heatLoading,  setHeatLoading ] = useState(false);

  const heatLayerRef  = useRef<L.HeatLayer | null>(null);
  const heatPoints    = useRef<L.HeatLatLngTuple[]>([]);
  const prevPos       = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  // Prevents auto-fitBounds overriding a view the AI assistant commanded
  const aiViewLocked  = useRef(false);

  const { data: invites, refetch } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }), refetchInterval: 20000 } },
  );

  const [overridesByToken, setOverridesByToken] = useState<Map<string, Map<string, string>>>(new Map());

  useEffect(() => {
    const tokens: string[] = Array.from(new Set((invites ?? []).map((inv: Invite) => inv.token as string)));
    if (tokens.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, Map<string, string>>();
      await Promise.all(
        tokens.map(async (token) => {
          try {
            const r = await fetch(`${API_BASE}/api/location-overrides/by-token/${token}`);
            if (!r.ok) return;
            const rows: { latKey: number; lngKey: number; overrideType: string }[] = await r.json();
            const m = new Map<string, string>();
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
    return {
      ...intel,
      locationType: overrideType as typeof intel.locationType,
      typeLabel: cfg.label,
      typeIcon: cfg.icon,
      pinColor: cfg.color,
      riskLevel: cfg.risk,
    };
  }

  const granted = (invites ?? []).filter(
    (inv: Invite) => inv.status === "accepted" && inv.grantedLatitude != null && inv.grantedLongitude != null,
  );

  const latestByPhone = granted.reduce<Record<string, Invite>>((acc, inv: Invite) => {
    const ex = acc[inv.toPhone];
    if (!ex || (inv.grantedAt ?? inv.sentAt) > (ex.grantedAt ?? ex.sentAt)) acc[inv.toPhone] = inv;
    return acc;
  }, {});
  const latest = Object.values(latestByPhone) as Invite[];

  const allByPhone = granted.reduce<Record<string, Invite[]>>((acc, inv: Invite) => {
    if (!acc[inv.toPhone]) acc[inv.toPhone] = [];
    acc[inv.toPhone].push(inv);
    return acc;
  }, {});

  // ── Map init ──────────────────────────────────────────────────────────[...] 
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    try {
      const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
      L.tileLayer(SATELLITE_URL, { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0", "1", "2", "3"] }).addTo(map);
      L.tileLayer(LABELS_URL,    { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0", "1", "2", "3"] }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInst.current = map;

      // Inject styles once
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
            const ageSec = row.timestamp
              ? (now - new Date(row.timestamp).getTime()) / 1000
              : 86400;
            // Newer = more intense (max 1.0 within last hour, fades to 0.2 after 7d)
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
        radius: 28,
        blur: 22,
        maxZoom: 17,
        max: 1.0,
        minOpacity: 0.35,
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
      if (heatLayerRef.current) {
        try { heatLayerRef.current.remove(); } catch { /* */ }
        heatLayerRef.current = null;
      }
      return;
    }

    // Seed with grant positions immediately, then enrich with full GPS history
    const acceptedTokens = (invites ?? [])
      .filter((inv: Invite) => inv.status === "accepted")
      .map((inv: Invite) => inv.token as string)
      .filter(Boolean);

    const basePoints: L.HeatLatLngTuple[] = granted
      .filter((inv) => isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!))
      .map((inv) => [inv.grantedLatitude!, inv.grantedLongitude!, 0.6] as L.HeatLatLngTuple);

    buildHeatmap(acceptedTokens, basePoints);

    return () => {
      if (heatLayerRef.current) {
        try { heatLayerRef.current.remove(); } catch { /* */ }
        heatLayerRef.current = null;
      }
    };
  }, [showHeatmap, (invites ?? []).map((inv: Invite) => inv.token).join(","), buildHeatmap]);

  // ── SSE subscriptions ───────────────────────────────────────────────────────[...] 
  useEffect(() => {
    const tokens = new Set((invites ?? [])
      .filter((inv: Invite) => inv.status === "accepted")
      .map((inv: Invite) => inv.token)
      .filter(Boolean) as string[]);

    // Close removed tokens
    for (const [t, es] of sseRefs.current) {
      if (!tokens.has(t)) { try { es.close(); } catch { /* */ } sseRefs.current.delete(t); }
    }

    // Open new tokens
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
              const dist = haversineKm(prev.lat, prev.lng, data.lat, data.lng) * 1000; // metres
              if (dist > 1) { // 1 m threshold to avoid GPS noise
                data.bearing = computeBearing(prev.lat, prev.lng, data.lat, data.lng);
              } else {
                data.bearing = livePos.current.get(token)?.bearing; // keep last known
              }
            }
            prevPos.current.set(token, { lat: data.lat, lng: data.lng });
            livePos.current.set(token, data);

            // Batch UI updates to the next animation frame to avoid frequent React re-renders
            scheduleMarkerUpdate();
          } catch { /* ignore bad SSE data */ }
        };
        es.onerror = () => { /* auto-reconnects */ };
        sseRefs.current.set(token, es);
      } catch { /* ignore SSE setup errors */ }
    }

    return () => {
      for (const es of sseRefs.current.values()) { try { es.close(); } catch { /* */ } }
      sseRefs.current.clear();
    };
  }, [(invites ?? []).map((inv: Invite) => inv.token).join(",")]);

  // ── Staleness recompute timer ─────────────────────────────────────────────────
  // Recomputes active count and triggers marker redraw every 30s so that
  // devices that silently drop connection (without sending "offline") transition
  // from green→grey at the 2-minute threshold without waiting for a new SSE frame.
  useEffect(() => {
    const id = setInterval(() => {
      // schedule a single batched update rather than forcing two state updates here
      scheduleMarkerUpdate();
    }, 30_000);
    return () => clearInterval(id);
  }, [scheduleMarkerUpdate]);

  // ── Render markers ────────────────────────────────────────────────────────[...] 
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    // Clear old layers
    for (const layer of layersRef.current) { try { layer.remove(); } catch { /* */ } }
    layersRef.current = [];

    // Journey lines
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
        } catch { /* ignore bad coordinates */ }
      });
    }

    // Cluster detection
    const geoClusteredPhones = findClusters(
      latest
        .filter((inv) => isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!))
        .map((inv) => ({ id: inv.id, lat: inv.grantedLatitude!, lng: inv.grantedLongitude!, phone: inv.toPhone })),
      2,
    );

    // Place markers
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

        // Live pulse ring
        if (isLive) {
          const ring = L.circle([lat, lng], {
            radius: 60, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.12, weight: 2,
          }).addTo(map);
          layersRef.current.push(ring);
        }

        // Cluster overlay
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

        // Popup
        marker.bindPopup("", { className: "pl-popup", maxWidth: 300, minWidth: 260 });
        marker.on("popupopen", () => {
          const distRow = myPos
            ? `<div style="font-size:10px;color:#a1a1aa;margin-top:3px;">📐 ${formatDistance(haversineKm(myPos.lat, myPos.lng, lat, lng))} from you</div>`
            : "";
          marker.setPopupContent(`
            <div style="width:250px;font-family:system-ui,sans-serif;color:#f4f4f5;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:${intel.pinColor}22;border:1.5px solid ${intel.pinColor}55;display:flex;align-items:center;justify-content:center;font-weight:700;color:${intel.pinColor}">${initials(inv.toName)}</div>
                <div>
                  <p style="margin:0;font-weight:700;font-size:14px;">${inv.toName ?? "Unknown"}</p>
                  <p style="margin:0;font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">${inv.toPhone}</p>
                </div>
              </div>
              <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 11px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Type</div>
                  <div style="font-size:12px;font-weight:600;color:${intel.pinColor};">${intel.typeIcon} ${intel.typeLabel}</div>
                </div>
                <div>
                  <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Risk</div>
                  ${riskBadgeHtml(intel.riskLevel)}
                </div>
              </div>
              <div style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:9px 11px;margin-bottom:10px;font-family:ui-monospace,monospace;">
                <div style="font-size:10px;font-weight:600;color:#f4f4f5;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                ${inv.grantedAddress ? `<div style="font-size:10px;color:#71717a;margin-top:3px;">${inv.grantedAddress.slice(0,80)}</div>` : ""}
                <div style="font-size:10px;color:#a1a1aa;margin-top:4px;">🕒 ${inv.grantedAt ? formatDistanceToNow(new Date(inv.grantedAt), { addSuffix: true }) : "—"}</div>
                ${distRow}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">🔁 ${grantCount} grant${grantCount !== 1 ? "s" : ""}</span>
                <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noreferrer" style="padding:5px 12px;background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#818cf8;font-weight:600;text-decoration:none;">Open</a>
              </div>
              <div id="wx-${inv.id}" style="margin-top:10px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px;padding:9px 11px;font-size:12px;color:#818cf8;">...</div>
              <div id="area-${inv.id}" style="margin-top:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:9px 11px;font-size:11px;color:#a1a1aa;">...</div>
            </div>`);

          // ... setup report buttons and async content fills (weather / area) ...
        });

        latlngs.push([lat, lng]);
      } catch (err) {
        console.warn("Marker error for", inv.toPhone, err);
      }
    });

    // My position pin
    if (myPos && isFinite(myPos.lat) && isFinite(myPos.lng)) {
      try {
        const myMarker = L.marker([myPos.lat, myPos.lng], {
          icon: makePin("#ffffff", "ME", true), zIndexOffset: 1000,
        }).bindPopup(`<div style="color:#f4f4f5;font-family:ui-monospace,monospace;font-size:11px;"><strong>Your position</strong><br/>${myPos.lat.toFixed(6)}, ${myPos.lng.toFixed(6)}</div>`).addTo(map);
        layersRef.current.push(myMarker);
        latlngs.push([myPos.lat, myPos.lng]);
      } catch { /* ignore */ }
    }

    // Fit bounds — only auto-pan when AI hasn't commanded a specific location
    if (latlngs.length > 0 && !aiViewLocked.current) {
      try {
        if (latlngs.length === 1) map.setView(latlngs[0], 13);
        else map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 19 });
      } catch { /* ignore fitBounds errors */ }
    }
  }, [latest.map((i) => i.toPhone).join(","), tick, showJourneys, showClusters, myPos]);

  // ── Actions ──────────────────────────────────────────────────────────�[...] 
  const handleFindMe = () => {
    if (!navigator.geolocation) { toast({ title: "Geolocation not supported", variant: "destructive" }); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyPos({ lat: latitude, lng: longitude });
        try { mapInst.current?.flyTo([latitude, longitude], 11, { duration: 1.5 }); } catch { /* */ }
        setLocating(false);
        toast({ title: "Your position pinned" });
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

  // ... rest of the component unchanged ...

  return (
    <div className="relative flex flex-col -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)", minHeight: 400 }}>
      {/* Map container */}
      <div ref={mapRef} className="flex-1 w-full" style={{ zIndex: 0, minHeight: 300 }} />

      {/* HUD — top left */}
      <div className="absolute top-3 left-3 z-[1000] pointer-events-none">
        <div className="pl-hud-card flex items-center gap-4 px-4 py-2.5">
          <HudStat label="Contacts" value={latest.length} />
          <div className="w-px h-7 bg-white/10" />
          <HudStat label="Grants" value={granted.length} />
          {liveCount > 0 && <><div className="w-px h-7 bg-white/10" /><HudStat label="Live" value={liveCount} accent="#10b981" /></>}
          {showClusters && clusterCount > 0 && <><div className="w-px h-7 bg-white/10" /><HudStat label="Flags" value={clusterCount} accent="#f59e0b" /></>}
          {myPos && <><div className="w-px h-7 bg-white/10" /><HudStat label="You" value="📍" /></>}
        </div>
      </div>

      {/* ... rest of the render omitted for brevity in this patch view ... */}
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
