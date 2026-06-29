import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow } from "date-fns";
import {
  Navigation, Users, Download, Layers, Crosshair,
  RefreshCw, MapPin, Clock, Wind, Thermometer, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, getLocalTime, weatherDesc } from "@/hooks/use-weather";

// ─── constants ────────────────────────────────────────────────────────────────
const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';
const COLORS = [
  "#6366f1","#ec4899","#f59e0b","#10b981",
  "#3b82f6","#ef4444","#8b5cf6","#14b8a6",
  "#f97316","#06b6d4","#a855f7","#84cc16",
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function makePin(color: string, label: string, isMine = false): L.DivIcon {
  const size = isMine ? 48 : 40;
  const bg = isMine ? "#ffffff" : color;
  const fg = isMine ? color : "#ffffff";
  const border = isMine ? `3px solid ${color}` : "2px solid rgba(255,255,255,0.4)";
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size + 10}px;">
        <div style="
          width:${size}px;height:${size}px;
          background:${bg};
          border-radius:50% 50% 50% 4px;
          transform:rotate(-45deg);
          box-shadow:0 4px 16px rgba(0,0,0,0.55);
          border:${border};
        "></div>
        <div style="
          position:absolute;top:0;left:0;
          width:${size}px;height:${size}px;
          display:flex;align-items:center;justify-content:center;
          font-size:${isMine ? 14 : 12}px;
          font-weight:800;
          color:${fg};
          font-family:system-ui,sans-serif;
          letter-spacing:-0.5px;
        ">${label}</div>
      </div>`,
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size + 10],
    popupAnchor: [0, -(size + 14)],
  });
}

function csvExport(grants: Invite[]) {
  const cols = ["ID","Contact","Phone","Latitude","Longitude","Address","Granted At","Sent At"];
  const rows = grants.map((g) => [
    g.id,
    `"${(g.toName ?? "Unknown").replace(/"/g,'""')}"`,
    g.toPhone,
    g.grantedLatitude ?? "",
    g.grantedLongitude ?? "",
    `"${(g.grantedAddress ?? "").replace(/"/g,'""')}"`,
    g.grantedAt ? format(new Date(g.grantedAt), "yyyy-MM-dd HH:mm:ss") : "",
    format(new Date(g.sentAt), "yyyy-MM-dd HH:mm:ss"),
  ]);
  const csv = [cols, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phonelink-locations-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── component ────────────────────────────────────────────────────────────────
export default function LiveMap() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const linesRef = useRef<L.Polyline[]>([]);
  const myMarkerRef = useRef<L.Marker | null>(null);
  const myCircleRef = useRef<L.Circle | null>(null);
  const clusterCirclesRef = useRef<L.Circle[]>([]);

  const [showJourneys, setShowJourneys] = useState(false);
  const [showClusters, setShowClusters] = useState(false);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: invites, refetch } = useListInvites(
    { userId: userId! },
    {
      query: {
        enabled: !!userId,
        queryKey: getListInvitesQueryKey({ userId: userId! }),
        refetchInterval: 20000,
      },
    },
  );

  const granted = (invites ?? []).filter(
    (inv: Invite) =>
      inv.status === "accepted" &&
      inv.grantedLatitude != null &&
      inv.grantedLongitude != null,
  );

  // Latest grant per contact
  const latestByPhone = granted.reduce<Record<string, Invite>>((acc, inv: Invite) => {
    const existing = acc[inv.toPhone];
    if (!existing || (inv.grantedAt ?? inv.sentAt) > (existing.grantedAt ?? existing.sentAt)) {
      acc[inv.toPhone] = inv;
    }
    return acc;
  }, {});
  const latest = Object.values(latestByPhone) as Invite[];

  // All grants per contact (for journey lines)
  const allByPhone = granted.reduce<Record<string, Invite[]>>((acc, inv: Invite) => {
    if (!acc[inv.toPhone]) acc[inv.toPhone] = [];
    acc[inv.toPhone].push(inv);
    return acc;
  }, {});

  // ── init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer(DARK_TILES, {
      attribution: TILE_ATTR,
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  // ── place / update markers ───────────────────────────────────────────────────
  const buildPopupHtml = useCallback(
    (inv: Invite, color: string, myP: { lat: number; lng: number } | null): string => {
      const lat = inv.grantedLatitude!;
      const lng = inv.grantedLongitude!;
      const dist = myP ? formatDistance(haversineKm(myP.lat, myP.lng, lat, lng)) : null;
      const grantCount = allByPhone[inv.toPhone]?.length ?? 1;

      const distRow = dist
        ? `<div style="display:flex;align-items:center;gap:6px;color:#a1a1aa;font-size:11px;margin-top:4px;">
            <span>📍</span><span>${dist} from you</span>
           </div>`
        : "";

      return `
        <div style="
          min-width:220px;max-width:260px;
          font-family:system-ui,sans-serif;
          color:#f4f4f5;
        ">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="
              width:34px;height:34px;border-radius:50%;
              background:${color};
              display:flex;align-items:center;justify-content:center;
              font-weight:800;font-size:12px;color:#fff;flex-shrink:0;
            ">${initials(inv.toName)}</div>
            <div>
              <p style="margin:0;font-weight:700;font-size:14px;">${inv.toName ?? "Unknown"}</p>
              <p style="margin:0;font-size:11px;color:#a1a1aa;">${inv.toPhone}</p>
            </div>
          </div>

          <div style="
            background:rgba(255,255,255,0.05);
            border-radius:8px;padding:8px 10px;
            font-size:11px;color:#d4d4d8;
            margin-bottom:8px;line-height:1.7;
          ">
            <div>🕒 ${inv.grantedAt ? formatDistanceToNow(new Date(inv.grantedAt), { addSuffix: true }) : "Unknown"}</div>
            <div>📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            ${inv.grantedAddress ? `<div style="margin-top:2px;color:#a1a1aa;font-size:10px;">${inv.grantedAddress.slice(0, 80)}${inv.grantedAddress.length > 80 ? "…" : ""}</div>` : ""}
            ${distRow}
          </div>

          <div id="weather-${inv.id}" style="
            background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);
            border-radius:8px;padding:8px 10px;font-size:12px;color:#c4b5fd;
            margin-bottom:8px;
          ">
            <span style="opacity:0.6;">Fetching weather…</span>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="
              background:rgba(255,255,255,0.08);border-radius:999px;
              padding:2px 10px;font-size:10px;color:#a1a1aa;
            ">🔄 ${grantCount} grant${grantCount > 1 ? "s" : ""}</span>
          </div>

          <div style="display:flex;gap:6px;">
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="
              flex:1;text-align:center;padding:6px;
              background:rgba(99,102,241,0.25);border-radius:6px;
              color:#818cf8;font-size:11px;font-weight:600;text-decoration:none;
            ">Open in Maps ↗</a>
          </div>
        </div>
      `;
    },
    [allByPhone],
  );

  const renderMarkers = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    clusterCirclesRef.current.forEach((c) => c.remove());
    clusterCirclesRef.current = [];

    latest.forEach((inv: Invite, i) => {
      const lat = inv.grantedLatitude!;
      const lng = inv.grantedLongitude!;
      const color = COLORS[i % COLORS.length];
      const pin = makePin(color, initials(inv.toName));

      const marker = L.marker([lat, lng], { icon: pin })
        .bindPopup("", {
          className: "phonelink-popup",
          maxWidth: 280,
          minWidth: 240,
        })
        .addTo(map);

      marker.on("popupopen", async () => {
        const html = buildPopupHtml(inv, color, myPos);
        marker.setPopupContent(html);

        // Async weather fill-in
        const weather = await fetchWeather(lat, lng);
        const el = document.getElementById(`weather-${inv.id}`);
        if (el && weather) {
          const localTime = getLocalTime(weather.timezone);
          el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:20px;">${weather.icon}</span>
              <div style="text-align:right;">
                <div style="font-size:18px;font-weight:700;color:#f4f4f5;">${weather.temperature}°C</div>
                <div style="font-size:10px;color:#a1a1aa;">${weather.description} · 💨 ${weather.windSpeed} km/h</div>
              </div>
            </div>
            <div style="margin-top:6px;font-size:11px;color:#a1a1aa;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;">
              🕐 Local time: <strong style="color:#c4b5fd;">${localTime}</strong>
              <span style="margin-left:6px;font-size:10px;opacity:0.6;">${weather.timezone.replace("_", " ")}</span>
            </div>
          `;
        } else if (el) {
          el.innerHTML = `<span style="opacity:0.5;font-size:11px;">Weather unavailable</span>`;
        }
      });

      markersRef.current.push(marker);
    });

    // Cluster detection: flag contacts within 2 km of each other
    if (showClusters) {
      const clusters: number[][] = [];
      for (let i = 0; i < latest.length; i++) {
        for (let j = i + 1; j < latest.length; j++) {
          const dist = haversineKm(
            latest[i].grantedLatitude!, latest[i].grantedLongitude!,
            latest[j].grantedLatitude!, latest[j].grantedLongitude!,
          );
          if (dist < 2) clusters.push([i, j]);
        }
      }
      clusters.forEach(([a]) => {
        const inv = latest[a];
        const circle = L.circle([inv.grantedLatitude!, inv.grantedLongitude!], {
          radius: 2000,
          color: "#f59e0b",
          fillColor: "#f59e0b",
          fillOpacity: 0.08,
          weight: 1.5,
          dashArray: "4",
        }).addTo(map);
        clusterCirclesRef.current.push(circle);
      });
    }

    // Fit bounds to all markers
    if (latest.length > 0) {
      const bounds = L.latLngBounds(
        latest.map((inv: Invite) => [inv.grantedLatitude!, inv.grantedLongitude!] as [number, number]),
      );
      map.fitBounds(bounds.pad(0.25), { maxZoom: 12 });
    }
  }, [latest, myPos, showClusters, buildPopupHtml]);

  const renderJourneyLines = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    linesRef.current.forEach((l) => l.remove());
    linesRef.current = [];
    if (!showJourneys) return;

    Object.entries(allByPhone).forEach(([phone, grants], i) => {
      if (grants.length < 2) return;
      const color = COLORS[i % COLORS.length];
      const sorted = [...grants].sort(
        (a: Invite, b: Invite) =>
          new Date(a.grantedAt ?? a.sentAt).getTime() -
          new Date(b.grantedAt ?? b.sentAt).getTime(),
      );
      const coords = sorted.map((g: Invite) => [g.grantedLatitude!, g.grantedLongitude!] as [number, number]);
      const line = L.polyline(coords, {
        color,
        weight: 2.5,
        opacity: 0.7,
        dashArray: "6 4",
      }).addTo(map);
      linesRef.current.push(line);
    });
  }, [allByPhone, showJourneys]);

  const renderMyMarker = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (myMarkerRef.current) myMarkerRef.current.remove();
    if (myCircleRef.current) myCircleRef.current.remove();
    if (!myPos) return;

    myMarkerRef.current = L.marker([myPos.lat, myPos.lng], {
      icon: makePin("#ffffff", "ME", true),
      zIndexOffset: 1000,
    })
      .bindPopup(`<div style="color:#f4f4f5;font-family:system-ui;"><strong>Your position</strong><br/><span style="font-size:11px;color:#a1a1aa;">${myPos.lat.toFixed(5)}, ${myPos.lng.toFixed(5)}</span></div>`)
      .addTo(map);

    myCircleRef.current = L.circle([myPos.lat, myPos.lng], {
      radius: 500,
      color: "#ffffff",
      fillColor: "#ffffff",
      fillOpacity: 0.06,
      weight: 1,
    }).addTo(map);
  }, [myPos]);

  useEffect(() => { renderMarkers(); }, [renderMarkers]);
  useEffect(() => { renderJourneyLines(); }, [renderJourneyLines]);
  useEffect(() => { renderMyMarker(); }, [renderMyMarker]);

  // ── inject popup CSS ─────────────────────────────────────────────────────────
  useEffect(() => {
    const id = "phonelink-popup-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .phonelink-popup .leaflet-popup-content-wrapper {
        background: #18181b !important;
        border: 1px solid rgba(255,255,255,0.12) !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 60px rgba(0,0,0,0.7) !important;
        padding: 0 !important;
      }
      .phonelink-popup .leaflet-popup-content {
        margin: 14px !important;
      }
      .phonelink-popup .leaflet-popup-tip {
        background: #18181b !important;
      }
      .phonelink-popup .leaflet-popup-close-button {
        color: #71717a !important;
        font-size: 18px !important;
        top: 8px !important;
        right: 8px !important;
      }
      .leaflet-control-attribution {
        background: rgba(0,0,0,0.5) !important;
        color: #71717a !important;
        font-size: 9px !important;
      }
      .leaflet-control-attribution a { color: #6366f1 !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // ── actions ──────────────────────────────────────────────────────────────────
  const handleFindMe = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapInstance.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 10, { duration: 1.5 });
        setLocating(false);
        toast({ title: "Your position pinned on map" });
      },
      () => {
        setLocating(false);
        toast({ title: "Could not get your location", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [toast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    toast({ title: "Map refreshed" });
  }, [refetch, toast]);

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-2rem)] -m-4 md:-m-8 relative">
      {/* Map */}
      <div ref={mapRef} className="flex-1 w-full z-0" />

      {/* Top-left stats bar */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-wrap gap-2">
        <div className="bg-black/70 backdrop-blur border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
          <Users size={14} className="text-primary" />
          <span className="text-xs font-semibold text-white">{latest.length} contact{latest.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="bg-black/70 backdrop-blur border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
          <MapPin size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-white">{granted.length} total grants</span>
        </div>
        {myPos && (
          <div className="bg-black/70 backdrop-blur border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Crosshair size={14} className="text-white" />
            <span className="text-xs font-semibold text-white">You located</span>
          </div>
        )}
        {showClusters && clusterCirclesRef.current.length > 0 && (
          <div className="bg-amber-500/20 backdrop-blur border border-amber-400/30 rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-300">
              {clusterCirclesRef.current.length} cluster{clusterCirclesRef.current.length !== 1 ? "s" : ""} detected
            </span>
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl flex-wrap justify-center">
          {/* Journey toggle */}
          <button
            onClick={() => setShowJourneys((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              showJourneys
                ? "bg-primary text-white shadow-lg shadow-primary/30"
                : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            <Layers size={14} />
            Journey Lines
          </button>

          {/* Cluster toggle */}
          <button
            onClick={() => setShowClusters((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              showClusters
                ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30"
                : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            <AlertTriangle size={14} />
            Clusters
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-white/10" />

          {/* Find me */}
          <button
            onClick={handleFindMe}
            disabled={locating}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/10 text-white/70 hover:bg-white/15 transition-all disabled:opacity-40"
          >
            <Crosshair size={14} className={locating ? "animate-spin" : ""} />
            {locating ? "Locating…" : "Find Me"}
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/10 text-white/70 hover:bg-white/15 transition-all disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-white/10" />

          {/* CSV export */}
          <button
            onClick={() => {
              csvExport(granted);
              toast({ title: `Exported ${granted.length} location grants as CSV` });
            }}
            disabled={granted.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-all disabled:opacity-40"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Empty state overlay */}
      {latest.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 backdrop-blur border border-white/10 rounded-2xl px-8 py-8 text-center max-w-xs">
            <Navigation size={36} className="text-primary mx-auto mb-3 opacity-60" />
            <h3 className="text-white font-semibold mb-1">No locations yet</h3>
            <p className="text-white/50 text-sm">
              Once contacts grant you location access via WhatsApp invites, they'll appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
