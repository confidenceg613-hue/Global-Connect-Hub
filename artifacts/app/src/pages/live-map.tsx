import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Siren, Flame, X, Camera, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, windDirLabel } from "@/hooks/use-weather";
import { fetchAreaInfo, aqiLabel } from "@/hooks/use-area-info";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// A live position is considered stale (and treated as offline) if the last
// "active" update arrived more than 2 minutes ago — handles devices that
// lose connectivity without sending an explicit "offline" ping.
function isLiveStale(timestamp: string): boolean {
  return differenceInMinutes(new Date(), new Date(timestamp)) >= 2;
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
  return `<span style="display:inline-flex;align-items:center;gap:3px;background:${m.bg};border:1px solid ${m.border};border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.08em;color:${m.text};font-family:ui-monospace,monospace;"><span style="width:5px;height:5px;border-radius:50%;background:${m.text};display:inline-block;"></span>${m.label}</span>`;
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
      <div style="width:${size}px;height:${size}px;background:${bg};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.3);"></div>
      <div style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${isMine ? 12 : 11}px;font-weight:800;color:${fg};font-family:ui-monospace,monospace;">${label}</div>
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

  const [showJourneys, setShowJourneys] = useState(false);
  const [showClusters, setShowClusters] = useState(false);
  const [showHeatmap,  setShowHeatmap ] = useState(false);
  const [liveCount,    setLiveCount   ] = useState(0);
  const [myPos,        setMyPos       ] = useState<{ lat: number; lng: number } | null>(null);
  const [locating,     setLocating    ] = useState(false);
  const [refreshing,   setRefreshing  ] = useState(false);
  const [tick,         setTick        ] = useState(0); // forces marker refresh
  const [heatLoading,  setHeatLoading ] = useState(false);

  const heatLayerRef = useRef<L.HeatLayer | null>(null);
  const heatPoints   = useRef<L.HeatLatLngTuple[]>([]);
  const prevPos      = useRef<Map<string, { lat: number; lng: number }>>(new Map());

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

  // ── Map init ─────────────────────────────────────────────────────────────────
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
          .pl-popup .leaflet-popup-content-wrapper{background:#111113!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:14px!important;box-shadow:0 24px 64px rgba(0,0,0,.8)!important;padding:0!important;}
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

  // ── SSE subscriptions ─────────────────────────────────────────────────────────
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
            setLiveCount(Array.from(livePos.current.values()).filter((p) => p.status === "active" && !isLiveStale(p.timestamp)).length);
            setTick((n) => n + 1);
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
      const count = Array.from(livePos.current.values()).filter(
        (p) => p.status === "active" && !isLiveStale(p.timestamp),
      ).length;
      setLiveCount(count);
      setTick((n) => n + 1); // force marker layer redraw
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Render markers ────────────────────────────────────────────────────────────
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
                <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:${intel.pinColor}22;border:1.5px solid ${intel.pinColor}55;display:flex;align-items:center;justify-content:center;font-size:20px;">${intel.typeIcon}</div>
                <div>
                  <p style="margin:0;font-weight:700;font-size:14px;">${inv.toName ?? "Unknown"}</p>
                  <p style="margin:0;font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">${inv.toPhone}</p>
                </div>
              </div>
              <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 11px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
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
                <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noreferrer" style="padding:5px 12px;background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#818cf8;font-size:11px;font-weight:600;text-decoration:none;">Maps ↗</a>
              </div>
              <div id="wx-${inv.id}" style="margin-top:10px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px;padding:9px 11px;font-size:12px;color:#818cf8;"><span style="opacity:.5;">Loading weather…</span></div>
              <div id="area-${inv.id}" style="margin-top:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:9px 11px;font-size:11px;color:#a1a1aa;"><span style="opacity:.5;">Loading area info…</span></div>
              <div id="report-wrap-${inv.id}" style="margin-top:8px;text-align:right;">
                <button id="report-btn-${inv.id}" style="background:none;border:none;color:#71717a;font-size:10px;cursor:pointer;text-decoration:underline;padding:2px;">🚩 Report incorrect type</button>
              </div>
              <div id="report-form-${inv.id}" style="display:none;margin-top:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 11px;">
                <div style="font-size:10px;color:#a1a1aa;margin-bottom:6px;">Flag "${intel.typeLabel}" as wrong — what should it be?</div>
                <select id="report-select-${inv.id}" style="width:100%;background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:5px 6px;font-size:11px;margin-bottom:6px;">
                  ${Object.entries(TYPE_CONFIG)
                    .filter(([key]) => key !== intel.locationType)
                    .map(([key, cfg]) => `<option value="${key}">${cfg.icon} ${cfg.label}</option>`)
                    .join("")}
                </select>
                <input id="report-comment-${inv.id}" type="text" placeholder="Optional comment…" style="width:100%;background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:5px 6px;font-size:11px;margin-bottom:6px;box-sizing:border-box;" />
                <div style="display:flex;gap:6px;justify-content:flex-end;">
                  <button id="report-cancel-${inv.id}" style="background:none;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#a1a1aa;font-size:10px;padding:4px 10px;cursor:pointer;">Cancel</button>
                  <button id="report-submit-${inv.id}" style="background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#818cf8;font-size:10px;font-weight:600;padding:4px 10px;cursor:pointer;">Submit</button>
                </div>
              </div>
            </div>`);

          const reportBtn = document.getElementById(`report-btn-${inv.id}`);
          const reportForm = document.getElementById(`report-form-${inv.id}`);
          const reportWrap = document.getElementById(`report-wrap-${inv.id}`);
          const reportCancel = document.getElementById(`report-cancel-${inv.id}`);
          const reportSubmit = document.getElementById(`report-submit-${inv.id}`);
          reportBtn?.addEventListener("click", () => {
            if (reportForm) reportForm.style.display = "block";
            if (reportWrap) reportWrap.style.display = "none";
          });
          reportCancel?.addEventListener("click", () => {
            if (reportForm) reportForm.style.display = "none";
            if (reportWrap) reportWrap.style.display = "block";
          });
          reportSubmit?.addEventListener("click", async () => {
            const select = document.getElementById(`report-select-${inv.id}`) as HTMLSelectElement | null;
            const commentInput = document.getElementById(`report-comment-${inv.id}`) as HTMLInputElement | null;
            if (!select || !reportForm) return;
            (reportSubmit as HTMLButtonElement).disabled = true;
            try {
              const r = await fetch(`${API_BASE}/api/location-reports`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  token: inv.token,
                  latitude: lat,
                  longitude: lng,
                  reportedType: intel.locationType,
                  suggestedType: select.value,
                  comment: commentInput?.value || undefined,
                }),
              });
              if (r.ok) {
                reportForm.innerHTML = `<div style="font-size:11px;color:#22c55e;">Thanks! Report submitted ✓</div>`;
              } else {
                reportForm.innerHTML = `<div style="font-size:11px;color:#ef4444;">Couldn't submit — try again later.</div>`;
              }
            } catch {
              reportForm.innerHTML = `<div style="font-size:11px;color:#ef4444;">Couldn't submit — try again later.</div>`;
            }
          });

          fetchWeather(lat, lng).then((wx) => {
            const el = document.getElementById(`wx-${inv.id}`);
            if (!el) return;
            if (wx) {
              const uvColor = wx.uvIndex <= 2 ? "#22c55e" : wx.uvIndex <= 5 ? "#eab308" : wx.uvIndex <= 7 ? "#f97316" : "#ef4444";
              el.innerHTML = `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:9px;">
                  <div>
                    <div style="font-size:26px;line-height:1;">${wx.icon}</div>
                    <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">${wx.description}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:26px;font-weight:800;color:#f4f4f5;line-height:1;">${wx.temperature}°C</div>
                    <div style="font-size:10px;color:#a1a1aa;margin-top:1px;">Feels ${wx.feelsLike}°C</div>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;font-size:10px;margin-bottom:9px;">
                  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:5px 6px;">
                    <div style="color:#71717a;font-size:9px;margin-bottom:1px;">💧 Humidity</div>
                    <div style="color:#93c5fd;font-weight:700;">${wx.humidity}%</div>
                  </div>
                  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:5px 6px;">
                    <div style="color:#71717a;font-size:9px;margin-bottom:1px;">🌧️ Rain</div>
                    <div style="color:#93c5fd;font-weight:700;">${wx.precipProb}%</div>
                  </div>
                  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:5px 6px;">
                    <div style="color:#71717a;font-size:9px;margin-bottom:1px;">☀️ UV</div>
                    <div style="color:${uvColor};font-weight:700;">${wx.uvIndex}</div>
                  </div>
                  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:5px 6px;">
                    <div style="color:#71717a;font-size:9px;margin-bottom:1px;">💨 Wind</div>
                    <div style="color:#d4d4d8;font-weight:700;">${wx.windSpeed} km/h ${windDirLabel(wx.windDirection)}</div>
                  </div>
                  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:5px 6px;">
                    <div style="color:#71717a;font-size:9px;margin-bottom:1px;">👁️ Vis</div>
                    <div style="color:#d4d4d8;font-weight:700;">${wx.visibility} km</div>
                  </div>
                </div>
                <div style="padding-top:7px;border-top:1px solid rgba(255,255,255,.07);">
                  <div style="font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;margin-bottom:2px;">🕐 Local time: <strong style="color:#c4b5fd;">${wx.localTime}</strong></div>
                  <div style="font-size:9px;color:#71717a;font-family:ui-monospace,monospace;">${wx.localDay}, ${wx.localDate}</div>
                  <div style="font-size:9px;color:#52525b;margin-top:1px;">${wx.timezone.replace(/_/g," ")} (${wx.utcOffsetSeconds >= 0 ? "+" : ""}${Math.round(wx.utcOffsetSeconds/3600)}h UTC)</div>
                </div>`;
            } else {
              el.innerHTML = `<span style="font-size:10px;opacity:.4;">Weather unavailable</span>`;
            }
          }).catch(() => {});

          fetchAreaInfo(lat, lng).then((area) => {
            const el = document.getElementById(`area-${inv.id}`);
            if (!el) return;
            if (!area) {
              el.innerHTML = `<span style="font-size:10px;opacity:.4;">Area info unavailable</span>`;
              return;
            }
            const flag = area.countryCode
              ? String.fromCodePoint(...[...area.countryCode].map((c) => 127397 + c.charCodeAt(0)))
              : "🌐";
            const locationParts = [area.neighbourhood || area.suburb, area.city || area.county, area.state, area.country].filter(Boolean);
            const primaryPlace = locationParts.slice(0, 2).join(", ");
            const regionLine  = locationParts.slice(2).join(", ");
            const aq = area.aqi != null ? aqiLabel(area.aqi) : null;
            el.innerHTML = `
              <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:6px;">📍 Area Findings</div>
              <div style="display:flex;align-items:flex-start;gap:7px;margin-bottom:7px;">
                <span style="font-size:16px;flex-shrink:0;">${flag}</span>
                <div>
                  <div style="font-size:12px;color:#f4f4f5;font-weight:700;line-height:1.3;">${primaryPlace || "Unknown area"}</div>
                  ${regionLine ? `<div style="font-size:10px;color:#71717a;margin-top:1px;">${regionLine}</div>` : ""}
                </div>
              </div>
              ${area.road ? `<div style="font-size:10px;color:#a1a1aa;margin-bottom:6px;padding:4px 7px;background:rgba(255,255,255,.04);border-radius:5px;">🛣️ ${area.road}${area.postcode ? " · " + area.postcode : ""}</div>` : (area.postcode ? `<div style="font-size:10px;color:#a1a1aa;margin-bottom:6px;">📮 ${area.postcode}</div>` : "")}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;margin-bottom:7px;">
                ${area.placeType ? `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:4px 6px;"><span style="color:#71717a;font-size:9px;">Type</span><br/><span style="color:#d4d4d8;">🏷️ ${area.placeType}</span></div>` : ""}
                ${area.elevation != null ? `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:4px 6px;"><span style="color:#71717a;font-size:9px;">Elevation</span><br/><span style="color:#d4d4d8;">⛰️ ${area.elevation} m</span></div>` : ""}
                ${area.utcOffset ? `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:4px 6px;"><span style="color:#71717a;font-size:9px;">Timezone</span><br/><span style="color:#d4d4d8;">🌐 ${area.utcOffset}</span></div>` : ""}
                ${area.sunrise ? `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:4px 6px;"><span style="color:#71717a;font-size:9px;">Sunrise</span><br/><span style="color:#fbbf24;">🌅 ${area.sunrise}</span></div>` : ""}
                ${area.sunset ? `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:4px 6px;"><span style="color:#71717a;font-size:9px;">Sunset</span><br/><span style="color:#f97316;">🌇 ${area.sunset}</span></div>` : ""}
              </div>
              ${aq ? `
              <div style="margin-bottom:6px;padding:6px 8px;background:rgba(255,255,255,.04);border-radius:6px;border-left:2px solid ${aq.color};">
                <div style="font-size:9px;color:#71717a;margin-bottom:3px;">🌬️ Air Quality</div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-size:13px;font-weight:800;color:${aq.color};">AQI ${area.aqi}</span>
                  <span style="font-size:10px;color:${aq.color};font-weight:600;">${aq.label}</span>
                </div>
                <div style="display:flex;gap:8px;margin-top:4px;font-size:9px;color:#71717a;flex-wrap:wrap;">
                  ${area.pm25 != null ? `<span>PM2.5: <strong style="color:#d4d4d8;">${area.pm25.toFixed(1)}</strong></span>` : ""}
                  ${area.no2  != null ? `<span>NO₂: <strong style="color:#d4d4d8;">${area.no2}</strong></span>` : ""}
                  ${area.o3   != null ? `<span>O₃: <strong style="color:#d4d4d8;">${area.o3}</strong></span>` : ""}
                </div>
              </div>` : ""}
              <a href="${area.googleMapsUrl}" target="_blank" rel="noreferrer"
                style="display:block;text-align:center;padding:5px;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.25);border-radius:6px;color:#818cf8;font-size:10px;font-weight:600;text-decoration:none;">
                🗺️ View on Google Maps
              </a>`;
          }).catch(() => {});
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

    // Fit bounds
    if (latlngs.length > 0) {
      try {
        if (latlngs.length === 1) map.setView(latlngs[0], 13);
        else map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 19 });
      } catch { /* ignore fitBounds errors */ }
    }
  }, [latest.map((i) => i.toPhone).join(","), tick, showJourneys, showClusters, myPos]);

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

  // ── Surveillance ─────────────────────────────────────────────────────────────
  interface SurvPhoto {
    id: number;
    photoData: string;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    takenAt: string;
    inviteToken: string;
    toName: string | null;
    toPhone: string;
  }

  const [showSurveillance, setShowSurveillance] = useState(false);
  const [survPhotos, setSurvPhotos] = useState<SurvPhoto[]>([]);
  const [survLoading, setSurvLoading] = useState(false);
  const [survSelected, setSurvSelected] = useState<SurvPhoto | null>(null);
  const survLayersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    if (!showSurveillance || !userId) {
      // Clear markers when toggled off
      for (const l of survLayersRef.current) { try { l.remove(); } catch { /* */ } }
      survLayersRef.current = [];
      if (!showSurveillance) { setSurvPhotos([]); setSurvSelected(null); }
      return;
    }
    let cancelled = false;
    setSurvLoading(true);
    fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: SurvPhoto[]) => { if (!cancelled) { setSurvPhotos(data); setSurvLoading(false); } })
      .catch(() => { if (!cancelled) setSurvLoading(false); });
    return () => { cancelled = true; };
  }, [showSurveillance, userId]);

  // Place surveillance camera markers on the map
  useEffect(() => {
    const map = mapInst.current;
    for (const l of survLayersRef.current) { try { l.remove(); } catch { /* */ } }
    survLayersRef.current = [];
    if (!map || !showSurveillance) return;

    survPhotos.forEach((photo) => {
      if (photo.latitude == null || photo.longitude == null) return;
      if (!isFinite(photo.latitude) || !isFinite(photo.longitude)) return;
      try {
        const camIcon = L.divIcon({
          className: "",
          html: `<div style="width:32px;height:32px;background:#7c3aed;border:2px solid rgba(167,139,250,.5);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 4px 14px rgba(124,58,237,.6);cursor:pointer;">📷</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -36],
        });
        const marker = L.marker([photo.latitude, photo.longitude], { icon: camIcon }).addTo(map);
        marker.bindPopup(
          `<div style="width:220px;font-family:system-ui,sans-serif;color:#f4f4f5;">
            <img src="${photo.photoData}" style="width:100%;border-radius:8px;margin-bottom:8px;display:block;" />
            <div style="font-size:12px;font-weight:700;">${photo.toName ?? photo.toPhone}</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">${photo.address ?? `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`}</div>
            <div style="font-size:10px;color:#71717a;margin-top:2px;">${new Date(photo.takenAt).toLocaleString()}</div>
          </div>`,
          { className: "pl-popup", maxWidth: 240, minWidth: 230 },
        );
        survLayersRef.current.push(marker);
      } catch { /* ignore */ }
    });
  }, [showSurveillance, survPhotos]);

  const [sosSending, setSosSending] = useState(false);
  const handleSOS = () => {
    if (!userId) return;
    setSosSending(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await fetch(`${API_BASE}/api/sos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
          toast({ title: "🆘 SOS sent", description: "Emergency alert broadcast to your group." });
        } catch {
          toast({ title: "SOS failed to send", variant: "destructive" });
        }
        setSosSending(false);
      },
      () => {
        toast({ title: "Could not get location for SOS", variant: "destructive" });
        setSosSending(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const clusterCount = findClusters(
    latest
      .filter((inv) => isFinite(inv.grantedLatitude!) && isFinite(inv.grantedLongitude!))
      .map((inv) => ({ id: inv.id, lat: inv.grantedLatitude!, lng: inv.grantedLongitude!, phone: inv.toPhone })),
    2,
  ).size;

  // ── Render ────────────────────────────────────────────────────────────────────
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

      {/* Layer controls — top right */}
      <div className="absolute top-3 right-3 z-[1000]">
        <div className="pl-hud-card flex items-center gap-2 px-3 py-2">
          <Satellite size={12} className="text-zinc-400" />
          <span className="text-[11px] font-semibold text-zinc-300 font-mono">SAT</span>
        </div>
      </div>

      {/* Close button — top left below HUD */}
      <div className="absolute top-14 left-3 z-[1000]">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 backdrop-blur text-zinc-300 text-[11px] font-semibold font-mono hover:bg-white/10 hover:text-white transition-all"
          title="Go back — contacts keep sharing in the background"
        >
          <X size={12} />
          <span>Close</span>
        </button>
      </div>

      {/* Command bar — bottom */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="pl-command-bar flex items-center gap-1 px-3 py-2">
          <CmdBtn active={showSurveillance} onClick={() => setShowSurveillance((v) => !v)} disabled={survLoading} icon={<Camera size={13} className={survLoading ? "animate-pulse" : ""} />} label={survLoading ? "Loading…" : `Surveillance${survPhotos.length > 0 ? ` (${survPhotos.length})` : ""}`} activeClass="bg-purple-500/20 border-purple-400/40 text-purple-400" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={showJourneys} onClick={() => setShowJourneys((v) => !v)} icon={<Layers size={13} />} label="Journeys" activeClass="bg-primary/20 border-primary/40 text-primary" />
          <CmdBtn active={showClusters} onClick={() => setShowClusters((v) => !v)} icon={<AlertTriangle size={13} />} label={showClusters && clusterCount > 0 ? `Flags (${clusterCount})` : "Flags"} activeClass="bg-amber-500/20 border-amber-400/40 text-amber-400" />
          <CmdBtn active={showHeatmap} onClick={() => setShowHeatmap((v) => !v)} disabled={heatLoading} icon={<Flame size={13} className={heatLoading ? "animate-pulse" : ""} />} label={heatLoading ? "Loading…" : "Heatmap"} activeClass="bg-orange-500/20 border-orange-400/40 text-orange-400" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={!!myPos} onClick={handleFindMe} disabled={locating} icon={<Crosshair size={13} className={locating ? "animate-spin" : ""} />} label={locating ? "Locating…" : myPos ? "Located" : "Find Me"} activeClass="bg-emerald-500/20 border-emerald-400/40 text-emerald-400" />
          <CmdBtn active={false} onClick={handleRefresh} disabled={refreshing} icon={<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />} label="Refresh" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <CmdBtn active={false} onClick={() => { csvExport(granted); toast({ title: `Exported ${granted.length} grants` }); }} disabled={granted.length === 0} icon={<Download size={13} />} label="Export" />
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button
            onClick={handleSOS}
            disabled={sosSending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/20 text-red-400 text-[11px] font-bold font-mono transition-all hover:bg-red-500/30 disabled:opacity-40 animate-pulse-once"
            title="Broadcast SOS emergency alert to your group"
          >
            <Siren size={13} className={sosSending ? "animate-spin" : ""} />
            <span>{sosSending ? "Sending…" : "SOS"}</span>
          </button>
        </div>
      </div>

      {/* Surveillance side panel */}
      {showSurveillance && survPhotos.length > 0 && (
        <div className="absolute top-3 right-3 bottom-20 z-[1000] w-64 flex flex-col gap-0 pointer-events-auto" style={{ marginTop: "2.5rem" }}>
          <div className="pl-hud-card flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 flex-shrink-0">
              <Camera size={13} className="text-purple-400" />
              <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
              <span className="ml-auto text-[10px] font-mono text-zinc-500">{survPhotos.length} photos</span>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {survSelected ? (
                <div className="p-2 flex flex-col gap-2">
                  <button onClick={() => setSurvSelected(null)} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white font-mono mb-1">
                    <ChevronRight size={10} className="rotate-180" /> Back
                  </button>
                  <img src={survSelected.photoData} className="w-full rounded-lg border border-white/10" alt="Surveillance capture" />
                  <div className="text-[12px] font-bold text-white">{survSelected.toName ?? survSelected.toPhone}</div>
                  <div className="text-[10px] text-zinc-400 font-mono">{survSelected.address ?? (survSelected.latitude != null ? `${survSelected.latitude.toFixed(5)}, ${survSelected.longitude?.toFixed(5)}` : "No coords")}</div>
                  <div className="text-[10px] text-zinc-500">{new Date(survSelected.takenAt).toLocaleString()}</div>
                  {survSelected.latitude != null && survSelected.longitude != null && (
                    <button onClick={() => { try { mapInst.current?.flyTo([survSelected.latitude!, survSelected.longitude!], 17, { duration: 1.2 }); } catch { /* */ } }} className="text-[10px] font-mono text-purple-400 hover:text-purple-300 text-left">
                      📍 Fly to on map →
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1 p-1.5">
                  {survPhotos.map((photo) => (
                    <button key={photo.id} onClick={() => { setSurvSelected(photo); if (photo.latitude != null && photo.longitude != null) { try { mapInst.current?.flyTo([photo.latitude, photo.longitude], 17, { duration: 1 }); } catch { /* */ } } }} className="relative group rounded-lg overflow-hidden border border-white/10 hover:border-purple-400/50 transition-all aspect-square bg-zinc-900">
                      <img src={photo.photoData} className="w-full h-full object-cover" alt="" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />
                      <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all">
                        <div className="text-[9px] font-mono text-white truncate">{photo.toName ?? photo.toPhone}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {latest.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="pl-hud-card flex flex-col items-center gap-3 px-8 py-8 text-center max-w-xs">
            <MapPin size={32} className="text-primary opacity-40" />
            <p className="font-semibold text-white text-sm">No locations on map</p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Once contacts accept WhatsApp invites and share their location, pins appear here.
            </p>
          </div>
        </div>
      )}
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
