import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow } from "date-fns";
import { Users, Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, getLocalTime } from "@/hooks/use-weather";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";
import type { LocationIntelligence } from "@/lib/location-intelligence";

// ─── tile layers ───────────────────────────────────────────────────────────────
const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTR =
  "Tiles &copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP";

// ─── helpers ──────────────────────────────────────────────────────────────────
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function riskBadgeHtml(level: "low" | "medium" | "high"): string {
  const map = {
    low:    { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)",  text: "#6ee7b7", label: "LOW RISK"   },
    medium: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)",  text: "#fcd34d", label: "MODERATE"   },
    high:   { bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.4)",   text: "#fca5a5", label: "HIGH RISK"  },
  };
  const s = map[level];
  return `<span style="
    display:inline-flex;align-items:center;gap:3px;
    background:${s.bg};border:1px solid ${s.border};
    border-radius:4px;padding:2px 6px;
    font-size:9px;font-weight:700;letter-spacing:0.08em;color:${s.text};
    font-family:ui-monospace,monospace;
  "><span style="width:5px;height:5px;border-radius:50%;background:${s.text};display:inline-block;"></span>${s.label}</span>`;
}

function makePin(color: string, label: string, isMine = false): L.DivIcon {
  const size = isMine ? 46 : 38;
  const bg = isMine ? "#fff" : color;
  const fg = isMine ? color : "#fff";
  const glowColor = isMine ? "rgba(255,255,255,0.4)" : `${color}66`;
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size + 12}px;filter:drop-shadow(0 4px 12px ${glowColor});">
        <div style="
          width:${size}px;height:${size}px;
          background:${bg};
          clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);
          display:flex;align-items:center;justify-content:center;
          border:2px solid rgba(255,255,255,0.3);
        "></div>
        <div style="
          position:absolute;top:0;left:0;
          width:${size}px;height:${size}px;
          display:flex;align-items:center;justify-content:center;
          font-size:${isMine ? 12 : 11}px;font-weight:800;
          color:${fg};font-family:ui-monospace,monospace;
          letter-spacing:-0.5px;
        ">${label}</div>
        <div style="
          position:absolute;bottom:0;left:50%;transform:translateX(-50%);
          width:4px;height:10px;background:${bg};
          clip-path:polygon(50% 100%,0% 0%,100% 0%);
        "></div>
      </div>`,
    iconSize: [size, size + 12],
    iconAnchor: [size / 2, size + 12],
    popupAnchor: [0, -(size + 16)],
  });
}

function clusterPinHtml(color: string): string {
  return `
    <div style="position:relative;width:34px;height:34px;">
      <div style="
        position:absolute;inset:0;border-radius:50%;
        background:${color};opacity:0.25;
        animation:pl-pulse 1.8s ease-in-out infinite;
      "></div>
      <div style="
        position:absolute;inset:4px;border-radius:50%;
        background:${color};opacity:0.45;
        animation:pl-pulse 1.8s ease-in-out infinite 0.3s;
      "></div>
      <div style="
        position:absolute;inset:0;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:16px;
      ">⚠️</div>
    </div>`;
}

function csvExport(grants: Invite[]) {
  const cols = ["ID", "Contact", "Phone", "Latitude", "Longitude", "Address", "Location Type", "Granted At", "Sent At"];
  const rows = grants.map((g) => {
    const intel = analyzeLocation(g.grantedAddress, g.grantedLatitude ?? 0, g.grantedLongitude ?? 0);
    return [
      g.id,
      `"${(g.toName ?? "Unknown").replace(/"/g, '""')}"`,
      g.toPhone,
      g.grantedLatitude ?? "",
      g.grantedLongitude ?? "",
      `"${(g.grantedAddress ?? "").replace(/"/g, '""')}"`,
      intel.typeLabel,
      g.grantedAt ? format(new Date(g.grantedAt), "yyyy-MM-dd HH:mm:ss") : "",
      format(new Date(g.sentAt), "yyyy-MM-dd HH:mm:ss"),
    ];
  });
  const csv = [cols, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phonelink-intel-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildPopupHtml(
  inv: Invite,
  intel: LocationIntelligence,
  myPos: { lat: number; lng: number } | null,
  grantCount: number,
): string {
  const lat = inv.grantedLatitude!;
  const lng = inv.grantedLongitude!;
  const distRow = myPos
    ? `<div style="font-size:10px;color:#a1a1aa;margin-top:3px;">📐 ${formatDistance(haversineKm(myPos.lat, myPos.lng, lat, lng))} from you</div>`
    : "";

  const tags = intel.tags
    .map(
      (t) =>
        `<span style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:1px 7px;font-size:9px;color:#a1a1aa;font-family:ui-monospace,monospace;">${t}</span>`,
    )
    .join("");

  return `
    <div style="width:260px;font-family:system-ui,sans-serif;color:#f4f4f5;">

      <!-- header row -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="
          width:40px;height:40px;border-radius:10px;flex-shrink:0;
          background:${intel.pinColor}22;border:1.5px solid ${intel.pinColor}55;
          display:flex;align-items:center;justify-content:center;font-size:20px;
        ">${intel.typeIcon}</div>
        <div style="min-width:0;">
          <p style="margin:0;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${inv.toName ?? "Unknown"}</p>
          <p style="margin:0;font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">${inv.toPhone}</p>
        </div>
      </div>

      <!-- intel strip -->
      <div style="
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
        border-radius:8px;padding:9px 11px;margin-bottom:10px;
        display:grid;grid-template-columns:1fr 1fr;gap:6px;
      ">
        <div>
          <div style="font-size:9px;font-weight:600;letter-spacing:0.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Location Type</div>
          <div style="font-size:12px;font-weight:600;color:${intel.pinColor};">${intel.typeIcon} ${intel.typeLabel}</div>
        </div>
        <div>
          <div style="font-size:9px;font-weight:600;letter-spacing:0.1em;color:#71717a;text-transform:uppercase;margin-bottom:2px;">Risk Level</div>
          <div>${riskBadgeHtml(intel.riskLevel)}</div>
        </div>
        <div style="grid-column:1/-1;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;margin-top:2px;">
          <div style="font-size:9px;font-weight:600;letter-spacing:0.1em;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Intelligence</div>
          <p style="margin:0;font-size:11px;color:#d4d4d8;line-height:1.5;">${intel.description}</p>
        </div>
        ${intel.clusterFlag && intel.clusterReason ? `
        <div style="grid-column:1/-1;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:6px 8px;margin-top:2px;">
          <span style="font-size:10px;color:#fcd34d;">⚠️ ${intel.clusterReason}</span>
        </div>` : ""}
      </div>

      <!-- coords + time -->
      <div style="
        background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);
        border-radius:8px;padding:9px 11px;margin-bottom:10px;
        font-family:ui-monospace,monospace;
      ">
        <div style="font-size:10px;font-weight:600;color:#f4f4f5;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        ${inv.grantedAddress ? `<div style="font-size:10px;color:#71717a;margin-top:3px;line-height:1.4;">${inv.grantedAddress.slice(0, 90)}${inv.grantedAddress.length > 90 ? "…" : ""}</div>` : ""}
        <div style="font-size:10px;color:#a1a1aa;margin-top:4px;">🕒 ${inv.grantedAt ? formatDistanceToNow(new Date(inv.grantedAt), { addSuffix: true }) : "—"}</div>
        ${distRow}
      </div>

      <!-- tags -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${tags}</div>

      <!-- weather placeholder -->
      <div id="wx-${inv.id}" style="
        background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);
        border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:12px;color:#818cf8;
      ">
        <span style="opacity:0.5;">Fetching live weather…</span>
      </div>

      <!-- grant count + links -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:10px;color:#71717a;font-family:ui-monospace,monospace;">
          🔁 ${grantCount} grant${grantCount !== 1 ? "s" : ""} · Confidence ${Math.round(intel.confidence * 100)}%
        </span>
        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noreferrer" style="
          padding:5px 12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);
          border-radius:6px;color:#818cf8;font-size:11px;font-weight:600;text-decoration:none;
        ">Maps ↗</a>
      </div>
    </div>`;
}

// ─── component ────────────────────────────────────────────────────────────────
export default function LiveMap() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInst       = useRef<L.Map | null>(null);
  const labelsLayer   = useRef<L.TileLayer | null>(null);
  const markersRef    = useRef<L.Marker[]>([]);
  const linesRef      = useRef<L.Polyline[]>([]);
  const clusterMarkers= useRef<L.Marker[]>([]);
  const clusterRings  = useRef<L.Circle[]>([]);
  const myMarkerRef   = useRef<L.Marker | null>(null);
  const myCircleRef   = useRef<L.Circle | null>(null);

  const [showJourneys,  setShowJourneys ] = useState(false);
  const [showLabels,    setShowLabels   ] = useState(true);
  const [showClusters,  setShowClusters ] = useState(false);
  const [clusterCount,  setClusterCount ] = useState(0);
  const [myPos,         setMyPos        ] = useState<{ lat: number; lng: number } | null>(null);
  const [locating,      setLocating     ] = useState(false);
  const [refreshing,    setRefreshing   ] = useState(false);

  const { data: invites, refetch } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }), refetchInterval: 20000 } },
  );

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

  // ── init map ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false, attributionControl: true });

    L.tileLayer(SATELLITE_URL, { attribution: ESRI_ATTR, maxZoom: 19 }).addTo(map);

    const labels = L.tileLayer(LABELS_URL, { maxZoom: 19, opacity: 0.85 });
    labels.addTo(map);
    labelsLayer.current = labels;

    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  // ── labels toggle ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map || !labelsLayer.current) return;
    if (showLabels) labelsLayer.current.addTo(map);
    else labelsLayer.current.remove();
  }, [showLabels]);

  // ── markers + clusters ───────────────────────────────────────────────────────
  const renderMarkers = useCallback(() => {
    const map = mapInst.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove()); markersRef.current = [];
    clusterMarkers.current.forEach((m) => m.remove()); clusterMarkers.current = [];
    clusterRings.current.forEach((c) => c.remove()); clusterRings.current = [];

    // Run location intelligence for all contacts
    const intelMap = new Map<string, LocationIntelligence>();
    latest.forEach((inv: Invite) => {
      intelMap.set(inv.toPhone, analyzeLocation(inv.grantedAddress, inv.grantedLatitude!, inv.grantedLongitude!));
    });

    // Geometric cluster detection
    const geoClusteredPhones = findClusters(
      latest.map((inv: Invite) => ({
        id: inv.id,
        lat: inv.grantedLatitude!,
        lng: inv.grantedLongitude!,
        phone: inv.toPhone,
      })),
      2,
    );

    // Also flag AI-determined cluster locations
    const aiClusterPhones = new Set<string>();
    latest.forEach((inv: Invite) => {
      if (intelMap.get(inv.toPhone)?.clusterFlag) aiClusterPhones.add(inv.toPhone);
    });

    const allFlaggedPhones = new Set([...geoClusteredPhones, ...aiClusterPhones]);
    setClusterCount(allFlaggedPhones.size);

    // Place markers
    latest.forEach((inv: Invite) => {
      const lat = inv.grantedLatitude!;
      const lng = inv.grantedLongitude!;
      const intel = intelMap.get(inv.toPhone)!;
      const grantCount = allByPhone[inv.toPhone]?.length ?? 1;

      const pin = makePin(intel.pinColor, initials(inv.toName));
      const marker = L.marker([lat, lng], { icon: pin }).addTo(map);

      marker.bindPopup("", { className: "pl-popup", maxWidth: 300, minWidth: 280 });

      marker.on("popupopen", async () => {
        marker.setPopupContent(buildPopupHtml(inv, intel, myPos, grantCount));
        const wx = await fetchWeather(lat, lng);
        const el = document.getElementById(`wx-${inv.id}`);
        if (el && wx) {
          const localTime = getLocalTime(wx.timezone);
          el.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div>
                <div style="font-size:22px;line-height:1;">${wx.icon}</div>
                <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">${wx.description}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:22px;font-weight:800;color:#f4f4f5;">${wx.temperature}°C</div>
                <div style="font-size:10px;color:#a1a1aa;">💨 ${wx.windSpeed} km/h</div>
              </div>
            </div>
            <div style="margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.07);font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;">
              🕐 Local time: <strong style="color:#c4b5fd;">${localTime}</strong>
              <span style="margin-left:6px;opacity:0.5;">${wx.timezone.replace("_", " ")}</span>
            </div>`;
        } else if (el) {
          el.innerHTML = `<span style="font-size:10px;opacity:0.4;">Weather data unavailable</span>`;
        }
      });

      markersRef.current.push(marker);
    });

    // Cluster overlays (only when toggle is on)
    if (showClusters) {
      allFlaggedPhones.forEach((phone) => {
        const inv = latest.find((i: Invite) => i.toPhone === phone);
        if (!inv) return;
        const intel = intelMap.get(phone)!;
        const lat = inv.grantedLatitude!;
        const lng = inv.grantedLongitude!;

        // Pulsing ⚠️ overlay marker
        const warnIcon = L.divIcon({
          className: "",
          html: clusterPinHtml(intel.riskLevel === "high" ? "#ef4444" : "#f59e0b"),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const warnMarker = L.marker([lat, lng], { icon: warnIcon, zIndexOffset: 500 })
          .bindTooltip(
            `<span style="font-size:11px;font-family:ui-monospace,monospace;">
              ⚠️ ${intel.clusterReason ?? "Co-location detected"}
            </span>`,
            { direction: "top", offset: [0, -20] },
          )
          .addTo(map);
        clusterMarkers.current.push(warnMarker);

        // Radius ring
        const ring = L.circle([lat, lng], {
          radius: 2000,
          color: intel.riskLevel === "high" ? "#ef4444" : "#f59e0b",
          fillColor: intel.riskLevel === "high" ? "#ef4444" : "#f59e0b",
          fillOpacity: 0.06,
          weight: 1.5,
          dashArray: "5 4",
        }).addTo(map);
        clusterRings.current.push(ring);
      });
    }

    // Fit map
    if (latest.length > 0) {
      const bounds = L.latLngBounds(
        latest.map((inv: Invite) => [inv.grantedLatitude!, inv.grantedLongitude!] as [number, number]),
      );
      map.fitBounds(bounds.pad(0.3), { maxZoom: 13 });
    }
  }, [latest, allByPhone, myPos, showClusters]);

  // ── journey lines ─────────────────────────────────────────────────────────────
  const renderJourneys = useCallback(() => {
    const map = mapInst.current;
    if (!map) return;
    linesRef.current.forEach((l) => l.remove()); linesRef.current = [];
    if (!showJourneys) return;
    Object.values(allByPhone).forEach((grants, i) => {
      if ((grants as Invite[]).length < 2) return;
      const colors = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6","#14b8a6","#f97316"];
      const color = colors[i % colors.length];
      const sorted = [...(grants as Invite[])].sort(
        (a, b) => new Date(a.grantedAt ?? a.sentAt).getTime() - new Date(b.grantedAt ?? b.sentAt).getTime(),
      );
      const line = L.polyline(
        sorted.map((g) => [g.grantedLatitude!, g.grantedLongitude!] as [number, number]),
        { color, weight: 2, opacity: 0.75, dashArray: "6 4" },
      ).addTo(map);
      linesRef.current.push(line);
    });
  }, [allByPhone, showJourneys]);

  // ── my position ───────────────────────────────────────────────────────────────
  const renderMyPin = useCallback(() => {
    const map = mapInst.current;
    if (!map) return;
    myMarkerRef.current?.remove();
    myCircleRef.current?.remove();
    if (!myPos) return;
    myMarkerRef.current = L.marker([myPos.lat, myPos.lng], {
      icon: makePin("#ffffff", "ME", true),
      zIndexOffset: 1000,
    })
      .bindPopup(
        `<div style="color:#f4f4f5;font-family:ui-monospace,monospace;font-size:11px;">
          <strong style="font-size:13px;">Your position</strong><br/>
          ${myPos.lat.toFixed(6)}, ${myPos.lng.toFixed(6)}
        </div>`,
      )
      .addTo(map);
    myCircleRef.current = L.circle([myPos.lat, myPos.lng], {
      radius: 300, color: "#fff", fillColor: "#fff", fillOpacity: 0.06, weight: 1,
    }).addTo(map);
  }, [myPos]);

  useEffect(() => { renderMarkers(); },  [renderMarkers]);
  useEffect(() => { renderJourneys(); }, [renderJourneys]);
  useEffect(() => { renderMyPin(); },    [renderMyPin]);

  // ── popup + keyframe CSS ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = "pl-map-styles";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .pl-popup .leaflet-popup-content-wrapper{background:#111113!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:14px!important;box-shadow:0 24px 64px rgba(0,0,0,0.8)!important;padding:0!important;}
      .pl-popup .leaflet-popup-content{margin:14px!important;}
      .pl-popup .leaflet-popup-tip{background:#111113!important;}
      .pl-popup .leaflet-popup-close-button{color:#52525b!important;font-size:18px!important;top:8px!important;right:8px!important;}
      .leaflet-tooltip{background:#111113!important;border:1px solid rgba(255,255,255,0.12)!important;color:#f4f4f5!important;border-radius:6px!important;box-shadow:0 8px 24px rgba(0,0,0,0.6)!important;}
      .leaflet-tooltip-left:before,.leaflet-tooltip-right:before{border-right-color:#111113!important;border-left-color:#111113!important;}
      .leaflet-control-attribution{background:rgba(0,0,0,0.55)!important;color:#52525b!important;font-size:8px!important;padding:2px 6px!important;border-radius:4px!important;}
      .leaflet-control-attribution a{color:#6366f1!important;}
      @keyframes pl-pulse{0%,100%{transform:scale(1);opacity:0.25;}50%{transform:scale(1.35);opacity:0.1;}}
    `;
    document.head.appendChild(s);
  }, []);

  // ── actions ───────────────────────────────────────────────────────────────────
  const handleFindMe = useCallback(() => {
    if (!navigator.geolocation) { toast({ title: "Geolocation not supported", variant: "destructive" }); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapInst.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 11, { duration: 1.5 });
        setLocating(false);
        toast({ title: "Your position pinned" });
      },
      () => { setLocating(false); toast({ title: "Could not locate you", variant: "destructive" }); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [toast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    toast({ title: "Intelligence refreshed" });
  }, [refetch, toast]);

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-2rem)] -m-4 md:-m-8">
      {/* Map canvas */}
      <div ref={mapRef} className="flex-1 w-full" style={{ zIndex: 0 }} />

      {/* ── Top-left: HUD stats ── */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2 pointer-events-none">
        <div className="pl-hud-card flex items-center gap-6">
          <StatCell icon="👤" value={latest.length} label="Contacts" />
          <div className="w-px h-8 bg-white/10" />
          <StatCell icon="📍" value={granted.length} label="Grants" />
          {showClusters && clusterCount > 0 && (
            <>
              <div className="w-px h-8 bg-white/10" />
              <StatCell icon="⚠️" value={clusterCount} label="Flagged" accent="#f59e0b" />
            </>
          )}
          {myPos && (
            <>
              <div className="w-px h-8 bg-white/10" />
              <StatCell icon="🎯" value="LIVE" label="You" accent="#10b981" />
            </>
          )}
        </div>
      </div>

      {/* ── Top-right: Layer controls ── */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
        <div className="pl-hud-card flex items-center gap-2">
          <Satellite size={13} className="text-zinc-400" />
          <span className="text-[11px] font-semibold text-zinc-300 font-mono tracking-wide">SAT</span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={() => setShowLabels((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold font-mono transition-all ${
              showLabels ? "bg-primary/20 text-primary border border-primary/30" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Tag size={10} />
            Labels
          </button>
        </div>
      </div>

      {/* ── Bottom: Command bar ── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="pl-command-bar flex items-center gap-1 px-3 py-2">

          <CmdBtn
            active={showJourneys}
            onClick={() => setShowJourneys((v) => !v)}
            icon={<Layers size={13} />}
            label="Journeys"
            activeClass="bg-primary/20 border-primary/40 text-primary"
          />

          <CmdBtn
            active={showClusters}
            onClick={() => setShowClusters((v) => !v)}
            icon={<AlertTriangle size={13} />}
            label={showClusters && clusterCount > 0 ? `Flags (${clusterCount})` : "Flags"}
            activeClass="bg-amber-500/20 border-amber-400/40 text-amber-400"
            badge={showClusters && clusterCount > 0 ? clusterCount : undefined}
          />

          <div className="w-px h-5 bg-white/10 mx-1" />

          <CmdBtn
            active={!!myPos}
            onClick={handleFindMe}
            disabled={locating}
            icon={<Crosshair size={13} className={locating ? "animate-spin" : ""} />}
            label={locating ? "Locating…" : myPos ? "Located" : "Find Me"}
            activeClass="bg-emerald-500/20 border-emerald-400/40 text-emerald-400"
          />

          <CmdBtn
            active={false}
            onClick={handleRefresh}
            disabled={refreshing}
            icon={<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />}
            label="Refresh"
          />

          <div className="w-px h-5 bg-white/10 mx-1" />

          <CmdBtn
            active={false}
            onClick={() => {
              csvExport(granted);
              toast({ title: `Exported ${granted.length} grants with intel data` });
            }}
            disabled={granted.length === 0}
            icon={<Download size={13} />}
            label="Export"
            activeClass="bg-emerald-500/20 border-emerald-400/40 text-emerald-400"
          />
        </div>
      </div>

      {/* ── Empty state ── */}
      {latest.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="pl-hud-card flex flex-col items-center gap-3 px-10 py-10 text-center max-w-xs">
            <MapPin size={36} className="text-primary opacity-40" />
            <p className="font-semibold text-white">No locations on map</p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Once contacts accept WhatsApp invites and share their location, pins appear here with full intelligence profiles.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── small sub-components ──────────────────────────────────────────────────────
function StatCell({
  icon, value, label, accent,
}: {
  icon: string;
  value: number | string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center min-w-[40px]">
      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono mb-0.5">{label}</span>
      <span
        className="text-base font-black font-mono leading-none"
        style={{ color: accent ?? "#f4f4f5" }}
      >
        {value}
      </span>
    </div>
  );
}

function CmdBtn({
  active,
  onClick,
  disabled = false,
  icon,
  label,
  badge,
  activeClass = "bg-primary/20 border-primary/40 text-primary",
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold font-mono transition-all disabled:opacity-40 ${
        active
          ? activeClass
          : "border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}
