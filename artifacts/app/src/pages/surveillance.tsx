import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Camera, Crosshair, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

function buildQuery(lat: number, lng: number, radiusM: number) {
  const around = `around:${radiusM},${lat},${lng}`;
  return `[out:json][timeout:30];
(
  node["man_made"="surveillance"]["surveillance"!="radar"]["surveillance"!="ALPR"](${around});
  node["surveillance:type"="camera"](${around});
  node["camera:type"](${around});
  way["man_made"="surveillance"]["surveillance"!="radar"](${around});
  relation["man_made"="surveillance"]["surveillance"!="radar"](${around});
);
out center;`;
}

// ── Prediction algorithm ──────────────────────────────────────────────────────
// Takes recent location history (ordered oldest→newest), returns predicted
// [lat,lng] at +5 min, +10 min, +15 min using weighted linear regression on
// recent velocity so erratic old points don't skew the forecast.
interface LocPoint { latitude: number; longitude: number; createdAt: string; }

function predictPath(history: LocPoint[]): [number, number][] {
  if (history.length < 2) return [];

  // Use last 8 points max, weight recent ones higher
  const pts = history.slice(-8);
  const n   = pts.length;

  // Weighted velocity: average of consecutive deltas weighted by recency
  let wLat = 0, wLng = 0, totalW = 0;
  for (let i = 1; i < n; i++) {
    const dtMs = new Date(pts[i].createdAt).getTime() - new Date(pts[i-1].createdAt).getTime();
    if (dtMs <= 0) continue;
    const dLat = pts[i].latitude  - pts[i-1].latitude;
    const dLng = pts[i].longitude - pts[i-1].longitude;
    const w = i; // higher weight for more recent steps
    wLat    += (dLat / dtMs) * w;
    wLng    += (dLng / dtMs) * w;
    totalW  += w;
  }
  if (totalW === 0) return [];

  const velLat = wLat / totalW; // lat per ms
  const velLng = wLng / totalW;

  const last = pts[n - 1];
  const lastT = new Date(last.createdAt).getTime();
  const now   = Date.now();
  const elapsed = now - lastT; // ms since last known point

  // Project 5 / 10 / 15 minutes ahead from NOW (not from last point)
  return [5, 10, 15].map(mins => {
    const ms = elapsed + mins * 60_000;
    return [last.latitude + velLat * ms, last.longitude + velLng * ms] as [number, number];
  });
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
function cameraPin() {
  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
    <defs><filter id="sh" x="-40%" y="-20%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/>
    </filter></defs>
    <path d="M16 2C9.4 2 4 7.4 4 14c0 9.5 12 28 12 28s12-18.5 12-28C28 7.4 22.6 2 16 2z"
          fill="#7c3aed" filter="url(#sh)" stroke="white" stroke-width="2.2"/>
    <text x="16" y="18" text-anchor="middle" font-size="11" dy=".1em">📷</text>
  </svg>`);
}
function contactPin(color = "#3b82f6") {
  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <defs><filter id="sh2" x="-40%" y="-20%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/>
    </filter></defs>
    <path d="M15 2C8.9 2 4 6.9 4 13c0 8.5 11 25 11 25s11-16.5 11-25C26 6.9 21.1 2 15 2z"
          fill="${color}" filter="url(#sh2)" stroke="white" stroke-width="2"/>
    <circle cx="15" cy="13" r="5" fill="white" opacity="0.85"/>
  </svg>`);
}
function myLocationPin() {
  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
    <defs><filter id="sh3" x="-50%" y="-20%" width="200%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.55)"/>
    </filter></defs>
    <path d="M14 1C8.5 1 4 5.5 4 11c0 8 10 26 10 26s10-18 10-26C24 5.5 19.5 1 14 1z"
          fill="#22c55e" filter="url(#sh3)" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="11" r="4.5" fill="white" opacity="0.92"/>
  </svg>`);
}

interface OsmElement {
  id: number; lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Surveillance() {
  const { userId } = useAuth();
  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInst     = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const scanId      = useRef(0);
  const mounted     = useRef(true);

  const [status, setStatus] = useState<"idle"|"locating"|"loading"|"done"|"error">("idle");
  const [count,  setCount]  = useState(0);
  const [radius, setRadius] = useState(0);
  const [err,    setErr]    = useState("");

  useEffect(() => {
    mounted.current = true;
    if (!mapRef.current || mapInst.current) return;

    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
    L.tileLayer(SATELLITE_URL, { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.tileLayer(LABELS_URL,    { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    markerLayer.current = layer;
    mapInst.current = map;
    injectStyles();
    startScan(map, layer);

    return () => {
      mounted.current = false;
      scanId.current++;
      try { mapInst.current?.remove(); } catch { /**/ }
      mapInst.current = null; markerLayer.current = null;
    };
  }, []);

  function startScan(map: L.Map, layer: L.LayerGroup) {
    scanId.current++;
    const sid = scanId.current;
    if (!navigator.geolocation) { safeSet(sid, () => { setErr("No geolocation"); setStatus("error"); }); return; }
    safeSet(sid, () => setStatus("locating"));
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (scanId.current === sid) fetchAll(map, layer, pos.coords.latitude, pos.coords.longitude, sid); },
      (e)   => safeSet(sid, () => { setErr(e.message); setStatus("error"); }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }

  async function fetchAll(map: L.Map, layer: L.LayerGroup, lat: number, lng: number, sid: number) {
    safeSet(sid, () => setStatus("loading"));
    layer.clearLayers();

    // "You" pin
    const meIcon = L.icon({ iconUrl: myLocationPin(), iconSize: [28,38], iconAnchor: [14,38], popupAnchor: [0,-40] });
    L.marker([lat, lng], { icon: meIcon, zIndexOffset: 3000 })
      .bindPopup(popup("📍 You", "", `${lat.toFixed(5)}, ${lng.toFixed(5)}`), { className: "surv-pop" })
      .addTo(layer);
    map.setView([lat, lng], 15);

    // Run CCTV scan + contact prediction in parallel
    const [, ] = await Promise.all([
      loadCCTV(map, layer, lat, lng, sid),
      loadContactPredictions(layer, sid),
    ]);

    if (scanId.current !== sid || !mounted.current) return;
    safeSet(sid, () => setStatus("done"));
  }

  // ── CCTV cameras ─────────────────────────────────────────────────────────
  async function loadCCTV(map: L.Map, layer: L.LayerGroup, lat: number, lng: number, sid: number) {
    const RADII = [5_000, 15_000, 30_000, 75_000];
    const camIcon = L.icon({ iconUrl: cameraPin(), iconSize: [32,44], iconAnchor: [16,44], popupAnchor: [0,-46] });

    for (const r of RADII) {
      if (scanId.current !== sid) return;
      safeSet(sid, () => setRadius(r));
      const els = await queryOverpass(lat, lng, r, sid);
      if (!mounted.current || scanId.current !== sid) return;
      if (els === null || els.length === 0) continue;

      const bounds = L.latLngBounds([[lat, lng]]);
      els.forEach(el => {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (elLat == null || elLng == null) return;
        bounds.extend([elLat, elLng]);
        const t = el.tags ?? {};
        const label = t["name"] ?? t["surveillance:type"] ?? t["camera:type"] ?? "CCTV Camera";
        L.marker([elLat, elLng], { icon: camIcon })
          .bindPopup(popup(`📷 ${label}`, [
            t["camera:type"]        ? `Type: <b>${t["camera:type"]}</b>` : "",
            t["operator"]           ? `Operator: <b>${t["operator"]}</b>` : "",
            t["camera:direction"]   ? `Direction: <b>${t["camera:direction"]}°</b>` : "",
          ].filter(Boolean).join("<br/>"), `${elLat.toFixed(5)}, ${elLng.toFixed(5)}`), { className: "surv-pop" })
          .addTo(layer);
      });
      safeSet(sid, () => setCount(els.length));
      map.fitBounds(bounds, { padding: [60,60], maxZoom: 16 });
      return;
    }
    safeSet(sid, () => setCount(0));
  }

  // ── Contact location + movement prediction ────────────────────────────────
  async function loadContactPredictions(layer: L.LayerGroup, sid: number) {
    if (!userId) return;
    try {
      const invRes = await fetch(`${API_BASE}/api/invites?userId=${userId}`);
      if (!invRes.ok || scanId.current !== sid) return;
      const invites: { id: number; token: string; toName: string; status: string }[] = await invRes.json();
      const accepted = invites.filter(i => i.status === "accepted" || i.status === "granted");

      await Promise.all(accepted.map(inv => plotContact(layer, inv.token, inv.toName, sid)));
    } catch { /* non-critical */ }
  }

  async function plotContact(layer: L.LayerGroup, token: string, name: string, sid: number) {
    try {
      const res = await fetch(`${API_BASE}/api/location/history/${token}?limit=20`);
      if (!res.ok || scanId.current !== sid) return;
      const history: LocPoint[] = await res.json();
      if (history.length === 0) return;

      const last = history[history.length - 1];
      const lat  = last.latitude;
      const lng  = last.longitude;

      // Contact current pin
      const icon = L.icon({ iconUrl: contactPin("#3b82f6"), iconSize: [30,40], iconAnchor: [15,40], popupAnchor: [0,-42] });
      L.marker([lat, lng], { icon, zIndexOffset: 2000 })
        .bindPopup(popup(`🔵 ${name}`, "Last known position", `${lat.toFixed(5)}, ${lng.toFixed(5)}`), { className: "surv-pop" })
        .addTo(layer);

      // Predicted path
      const predicted = predictPath(history);
      if (predicted.length === 0) return;

      const pathPoints: [number, number][] = [[lat, lng], ...predicted];

      // Red dashed prediction line
      L.polyline(pathPoints, {
        color: "#ef4444",
        weight: 3,
        dashArray: "8 6",
        opacity: 0.85,
      }).addTo(layer);

      // Arrowhead at each predicted point
      const labels = ["5 min", "10 min", "15 min"];
      predicted.forEach(([pLat, pLng], i) => {
        const opacity = 1 - i * 0.2;
        const arrowIcon = L.divIcon({
          className: "",
          html: `<div style="
            background:rgba(239,68,68,${opacity});
            border:2px solid rgba(255,255,255,0.8);
            border-radius:50%;
            width:${14 - i*2}px;height:${14 - i*2}px;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 0 8px rgba(239,68,68,0.8);
          "></div>`,
          iconSize: [14 - i*2, 14 - i*2],
          iconAnchor: [7 - i, 7 - i],
          popupAnchor: [0, -10],
        });
        L.marker([pLat, pLng], { icon: arrowIcon, zIndexOffset: 1500 })
          .bindPopup(popup(
            `🔴 Predicted: ${labels[i]}`,
            `<b>${name}</b> likely here`,
            `${pLat.toFixed(5)}, ${pLng.toFixed(5)}`
          ), { className: "surv-pop" })
          .addTo(layer);
      });

      // Endpoint arrowhead tip
      const [endLat, endLng] = predicted[predicted.length - 1];
      const [prevLat, prevLng] = predicted.length > 1 ? predicted[predicted.length - 2] : [lat, lng];
      const angle = Math.atan2(endLng - prevLng, endLat - prevLat) * 180 / Math.PI;
      const arrowTip = L.divIcon({
        className: "",
        html: `<div style="
          width:0;height:0;
          border-left:8px solid transparent;border-right:8px solid transparent;
          border-bottom:16px solid #ef4444;
          transform:rotate(${angle}deg);
          filter:drop-shadow(0 0 4px rgba(239,68,68,0.9));
        "></div>`,
        iconSize: [16,16], iconAnchor: [8,8],
      });
      L.marker([endLat, endLng], { icon: arrowTip, zIndexOffset: 1600 }).addTo(layer);

    } catch { /* non-critical */ }
  }

  async function queryOverpass(lat: number, lng: number, r: number, sid: number): Promise<OsmElement[] | null> {
    const body = `data=${encodeURIComponent(buildQuery(lat, lng, r))}`;
    for (const mirror of OVERPASS_MIRRORS) {
      if (scanId.current !== sid) return null;
      try {
        const res = await fetchWithTimeout(mirror, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 28_000);
        if (!res.ok) continue;
        const json = await res.json() as { elements?: OsmElement[] };
        return json.elements ?? [];
      } catch { /* try next */ }
    }
    return null;
  }

  function safeSet(sid: number, fn: () => void) {
    if (mounted.current && scanId.current === sid) fn();
  }

  function popup(title: string, body: string, coords: string) {
    return `<div style="min-width:175px;color:#f4f4f5;font-family:system-ui,sans-serif;">
      <div style="font-weight:700;font-size:13px;margin-bottom:${body?5:2}px;">${title}</div>
      ${body ? `<div style="font-size:11px;color:#d4d4d8;line-height:1.8;">${body}</div>` : ""}
      <div style="margin-top:5px;font-size:9px;font-family:ui-monospace,monospace;color:#71717a;">${coords}</div>
    </div>`;
  }

  function injectStyles() {
    if (document.getElementById("surv-styles")) return;
    const s = document.createElement("style");
    s.id = "surv-styles";
    s.textContent = `
      .surv-pop .leaflet-popup-content-wrapper{background:#0d0d10!important;border:1px solid rgba(167,139,250,.35)!important;border-radius:12px!important;box-shadow:0 20px 60px rgba(0,0,0,.9)!important;padding:0!important;}
      .surv-pop .leaflet-popup-content{margin:0!important;padding:12px 14px!important;}
      .surv-pop .leaflet-popup-tip{background:#0d0d10!important;}
      .surv-pop .leaflet-popup-close-button{color:#52525b!important;top:6px!important;right:8px!important;}
    `;
    document.head.appendChild(s);
  }

  const radiusLabel = radius >= 1000 ? `${radius/1000} km` : `${radius} m`;
  const statusText = {
    idle: "", locating: "Locating you…", loading: `Scanning ${radiusLabel}…`,
    done: count > 0 ? `${count} camera${count!==1?"s":""} found` : "No cameras mapped nearby",
    error: err,
  }[status];

  return (
    <div className="relative -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)" }}>
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm select-none">
        <Camera size={13} className="text-purple-400" />
        <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
        {statusText && <>
          <div className="w-px h-4 bg-white/20 mx-1" />
          <span className={`text-[11px] font-mono flex items-center gap-1 ${status==="error"?"text-red-400":status==="done"&&count===0?"text-zinc-400":status==="done"?"text-green-400":"text-purple-400 animate-pulse"}`}>
            {status==="error"&&<AlertCircle size={10}/>}{statusText}
          </span>
        </>}
      </div>

      {/* Legend */}
      <div className="absolute bottom-8 left-3 z-[1000] flex flex-col gap-1 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm text-[10px] font-mono text-zinc-400">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"/> You</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"/> Contact</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 inline-block border-t-2 border-dashed border-red-500"/> Predicted path</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-600 inline-block"/> CCTV camera</div>
      </div>

      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => { const m=mapInst.current,l=markerLayer.current; if(m&&l) startScan(m,l); }}
          disabled={status==="locating"||status==="loading"}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm text-[11px] font-mono text-zinc-300 hover:text-white hover:border-purple-400/50 disabled:opacity-40 transition-all active:scale-95"
        >
          <Crosshair size={12} className={status==="locating"||status==="loading"?"animate-spin":""} />
          Rescan
        </button>
      </div>
    </div>
  );
}
