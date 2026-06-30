import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow } from "date-fns";
import { Download, Layers, Crosshair, RefreshCw, MapPin, AlertTriangle, Satellite, Tag, Siren } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWeather, haversineKm, formatDistance, getLocalTime } from "@/hooks/use-weather";
import { fetchAreaInfo, aqiLabel } from "@/hooks/use-area-info";
import { analyzeLocation, findClusters, TYPE_CONFIG } from "@/lib/location-intelligence";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LivePos {
  lat: number;
  lng: number;
  accuracy?: number;
  status: "active" | "offline";
  timestamp: string;
}

const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS_URL    = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

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

function makePin(color: string, label: string, isMine = false) {
  const size = isMine ? 46 : 38;
  const bg = isMine ? "#fff" : color;
  const fg = isMine ? color : "#fff";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size + 12}px;filter:drop-shadow(0 4px 12px ${color}66);">
      <div style="width:${size}px;height:${size}px;background:${bg};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.3);"></div>
      <div style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${isMine ? 12 : 11}px;font-weight:800;color:${fg};font-family:ui-monospace,monospace;">${label}</div>
      <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:4px;height:10px;background:${bg};clip-path:polygon(50% 100%,0% 0%,100% 0%);"></div>
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
  const labelsLayer = useRef<L.TileLayer | null>(null);
  const layersRef   = useRef<L.Layer[]>([]);
  const sseRefs     = useRef<Map<string, EventSource>>(new Map());
  const livePos     = useRef<Map<string, LivePos>>(new Map());

  const [showLabels,   setShowLabels  ] = useState(true);
  const [showJourneys, setShowJourneys] = useState(false);
  const [showClusters, setShowClusters] = useState(false);
  const [liveCount,    setLiveCount   ] = useState(0);
  const [myPos,        setMyPos       ] = useState<{ lat: number; lng: number } | null>(null);
  const [locating,     setLocating    ] = useState(false);
  const [refreshing,   setRefreshing  ] = useState(false);
  const [tick,         setTick        ] = useState(0); // forces marker refresh

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

  // ── Map init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    try {
      const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
      L.tileLayer(SATELLITE_URL, { maxZoom: 19 }).addTo(map);
      const labels = L.tileLayer(LABELS_URL, { maxZoom: 19, opacity: 0.85 });
      labels.addTo(map);
      labelsLayer.current = labels;
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

  // ── Labels toggle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    const layer = labelsLayer.current;
    if (!map || !layer) return;
    try {
      if (showLabels) layer.addTo(map);
      else layer.remove();
    } catch { /* ignore */ }
  }, [showLabels]);

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
            livePos.current.set(token, data);
            setLiveCount(Array.from(livePos.current.values()).filter((p) => p.status === "active").length);
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
      const isLive = rawLive?.status === "active";

      if (!isFinite(lat) || !isFinite(lng)) return;

      try {
        const intel = analyzeLocation(inv.grantedAddress, lat, lng);
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

        const marker = L.marker([lat, lng], { icon: makePin(pinColor, initials(inv.toName)) }).addTo(map);
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
              el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><div><div style="font-size:22px;">${wx.icon}</div><div style="font-size:10px;color:#a1a1aa;">${wx.description}</div></div><div style="text-align:right;"><div style="font-size:22px;font-weight:800;color:#f4f4f5;">${wx.temperature}°C</div><div style="font-size:10px;color:#a1a1aa;">💨 ${wx.windSpeed} km/h</div></div></div><div style="margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.07);font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;">🕐 Local: <strong style="color:#c4b5fd;">${getLocalTime(wx.timezone)}</strong></div>`;
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
              ? String.fromCodePoint(
                  ...[...area.countryCode].map((c) => 127397 + c.charCodeAt(0)),
                )
              : "🌐";
            const place = [area.county, area.state, area.country].filter(Boolean).join(", ");
            const aq = area.aqi != null ? aqiLabel(area.aqi) : null;
            el.innerHTML = `
              <div style="font-size:9px;font-weight:600;letter-spacing:.1em;color:#71717a;text-transform:uppercase;margin-bottom:5px;">Area Info</div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
                <span style="font-size:14px;">${flag}</span>
                <span style="font-size:11px;color:#f4f4f5;font-weight:600;">${place || "Unknown area"}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:10px;">
                ${area.placeType ? `<div>🏷️ <span style="color:#d4d4d8;">${area.placeType}</span></div>` : ""}
                ${area.elevation != null ? `<div>⛰️ <span style="color:#d4d4d8;">${area.elevation} m</span></div>` : ""}
                ${aq ? `<div>🌬️ AQI <span style="color:${aq.color};font-weight:700;">${area.aqi}</span> <span style="color:#71717a;">(${aq.label})</span></div>` : ""}
                ${area.postcode ? `<div>📮 <span style="color:#d4d4d8;">${area.postcode}</span></div>` : ""}
                ${area.sunrise ? `<div>🌅 <span style="color:#d4d4d8;">${area.sunrise}</span></div>` : ""}
                ${area.sunset ? `<div>🌇 <span style="color:#d4d4d8;">${area.sunset}</span></div>` : ""}
              </div>`;
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
        else map.fitBounds(L.latLngBounds(latlngs).pad(0.3), { maxZoom: 13 });
      } catch { /* ignore fitBounds errors */ }
    }
  }, [latest.map((i) => i.toPhone).join(","), tick, showJourneys, showClusters, myPos]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const handleFindMe = () => {
    if (!navigator.geolocation) return toast({ title: "Geolocation not supported", variant: "destructive" });
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
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={() => setShowLabels((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold font-mono transition-all ${showLabels ? "bg-primary/20 text-primary border border-primary/30" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <Tag size={10} /> Labels
          </button>
        </div>
      </div>

      {/* Command bar — bottom */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="pl-command-bar flex items-center gap-1 px-3 py-2">
          <CmdBtn active={showJourneys} onClick={() => setShowJourneys((v) => !v)} icon={<Layers size={13} />} label="Journeys" activeClass="bg-primary/20 border-primary/40 text-primary" />
          <CmdBtn active={showClusters} onClick={() => setShowClusters((v) => !v)} icon={<AlertTriangle size={13} />} label={showClusters && clusterCount > 0 ? `Flags (${clusterCount})` : "Flags"} activeClass="bg-amber-500/20 border-amber-400/40 text-amber-400" />
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
