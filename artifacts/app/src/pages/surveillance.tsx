import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Camera, Crosshair, AlertCircle } from "lucide-react";

// ─── Tile layers ─────────────────────────────────────────────────────────────
const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";

// ─── Overpass mirrors ────────────────────────────────────────────────────────
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// ─── Overpass query ──────────────────────────────────────────────────────────
// Strictly camera-tagged objects only (avoids non-camera surveillance such as
// radar speed signs, traffic detectors, etc.).  Ways + relations are included
// with "out center" so their centroid is returned as lat/lon.
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

// ─── SVG pin helpers ─────────────────────────────────────────────────────────
function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function cameraPin() {
  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
    <defs>
      <filter id="sh" x="-40%" y="-20%" width="180%" height="180%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/>
      </filter>
    </defs>
    <path d="M16 2C9.4 2 4 7.4 4 14c0 9.5 12 28 12 28s12-18.5 12-28C28 7.4 22.6 2 16 2z"
          fill="#7c3aed" filter="url(#sh)" stroke="white" stroke-width="2.2"/>
    <circle cx="16" cy="14" r="7" fill="white" opacity="0.15"/>
    <text x="16" y="18" text-anchor="middle" font-size="11" dy=".1em">📷</text>
  </svg>`);
}

function myLocationPin() {
  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
    <defs>
      <filter id="sh2" x="-50%" y="-20%" width="200%" height="180%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.55)"/>
      </filter>
    </defs>
    <path d="M14 1C8.5 1 4 5.5 4 11c0 8 10 26 10 26s10-18 10-26C24 5.5 19.5 1 14 1z"
          fill="#3b82f6" filter="url(#sh2)" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="11" r="4.5" fill="white" opacity="0.92"/>
  </svg>`);
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface OsmElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

// ─── Compat-safe timeout helper ───────────────────────────────────────────────
function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Surveillance() {
  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInst     = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  // Monotonically incrementing scan ID — only the latest scan may write state
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
    mapInst.current     = map;

    injectPopupStyles();
    startScan(map, layer);

    return () => {
      mounted.current = false;
      scanId.current++;                 // invalidate any in-flight scan
      try { mapInst.current?.remove(); } catch { /**/ }
      mapInst.current  = null;
      markerLayer.current = null;
    };
  }, []);

  // ── Begin a new scan (invalidates previous) ───────────────────────────────
  function startScan(map: L.Map, layer: L.LayerGroup) {
    scanId.current++;
    const thisScan = scanId.current;

    if (!navigator.geolocation) {
      safeSet(thisScan, () => { setErr("Geolocation not available"); setStatus("error"); });
      return;
    }

    safeSet(thisScan, () => setStatus("locating"));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (scanId.current !== thisScan) return;
        fetchCameras(map, layer, pos.coords.latitude, pos.coords.longitude, thisScan);
      },
      (e) => safeSet(thisScan, () => { setErr(`Location denied: ${e.message}`); setStatus("error"); }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }

  // ── Fetch cameras, expanding radius until results found ───────────────────
  async function fetchCameras(
    map: L.Map, layer: L.LayerGroup,
    lat: number, lng: number,
    thisScan: number
  ) {
    safeSet(thisScan, () => setStatus("loading"));
    layer.clearLayers();

    // "You are here" pin
    const meIcon = L.icon({ iconUrl: myLocationPin(), iconSize: [28,38], iconAnchor: [14,38], popupAnchor: [0,-40] });
    L.marker([lat, lng], { icon: meIcon, zIndexOffset: 2000 })
      .bindPopup(popupHtml("📍 You are here", "", `${lat.toFixed(6)}, ${lng.toFixed(6)}`), { className: "surv-pop", maxWidth: 220 })
      .addTo(layer);

    map.setView([lat, lng], 15);

    const RADII = [5_000, 15_000, 30_000, 75_000];

    for (const r of RADII) {
      if (scanId.current !== thisScan) return;          // superseded
      safeSet(thisScan, () => setRadius(r));

      const elements = await queryOverpass(lat, lng, r, thisScan);
      if (!mounted.current || scanId.current !== thisScan) return;  // unmounted or superseded

      if (elements === null) {
        safeSet(thisScan, () => { setErr("Could not reach camera database"); setStatus("error"); });
        return;
      }
      if (elements.length === 0) continue;              // try wider radius

      // ── Plot camera pins ─────────────────────────────────────────────────
      const camIcon = L.icon({ iconUrl: cameraPin(), iconSize: [32,44], iconAnchor: [16,44], popupAnchor: [0,-46] });
      const bounds  = L.latLngBounds([[lat, lng]]);

      elements.forEach((el) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (elLat == null || elLng == null) return;

        bounds.extend([elLat, elLng]);
        const t     = el.tags ?? {};
        const label = t["name"] ?? t["description"] ?? t["surveillance:type"] ?? t["camera:type"] ?? "CCTV Camera";
        const rows  = [
          t["camera:type"]        ? `Type: <strong>${t["camera:type"]}</strong>` : "",
          t["surveillance:type"]  ? `Mode: <strong>${t["surveillance:type"]}</strong>` : "",
          t["surveillance:mount"] ? `Mount: <strong>${t["surveillance:mount"]}</strong>` : "",
          t["camera:direction"]   ? `Direction: <strong>${t["camera:direction"]}°</strong>` : "",
          t["operator"]           ? `Operator: <strong>${t["operator"]}</strong>` : "",
          t["ref"]                ? `Ref: <strong>${t["ref"]}</strong>` : "",
        ].filter(Boolean).join("<br/>");

        L.marker([elLat, elLng], { icon: camIcon })
          .bindPopup(popupHtml(`📷 ${label}`, rows, `${elLat.toFixed(5)}, ${elLng.toFixed(5)}`), { className: "surv-pop", maxWidth: 240 })
          .addTo(layer);
      });

      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
      safeSet(thisScan, () => { setCount(elements.length); setStatus("done"); });
      return;
    }

    // All radii exhausted with 0 results
    safeSet(thisScan, () => { setCount(0); setStatus("done"); });
  }

  // ── Overpass fetch with mirror fallback ───────────────────────────────────
  async function queryOverpass(lat: number, lng: number, radiusM: number, thisScan: number): Promise<OsmElement[] | null> {
    const body = `data=${encodeURIComponent(buildQuery(lat, lng, radiusM))}`;

    for (const mirror of OVERPASS_MIRRORS) {
      if (scanId.current !== thisScan) return null;   // superseded mid-loop
      try {
        const res = await fetchWithTimeout(mirror, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }, 28_000);
        if (!res.ok) continue;
        const json = await res.json() as { elements?: OsmElement[] };
        return json.elements ?? [];
      } catch {
        // try next mirror
      }
    }
    return null;
  }

  // ── Guard: only apply state if this scan is still current & mounted ────────
  function safeSet(thisScan: number, fn: () => void) {
    if (mounted.current && scanId.current === thisScan) fn();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function popupHtml(title: string, body: string, coords: string) {
    return `<div style="min-width:180px;color:#f4f4f5;font-family:system-ui,sans-serif;">
      <div style="font-weight:700;font-size:13px;margin-bottom:${body ? 6 : 2}px;">${title}</div>
      ${body ? `<div style="font-size:11px;color:#d4d4d8;line-height:1.8;">${body}</div>` : ""}
      <div style="margin-top:6px;font-size:9px;font-family:ui-monospace,monospace;color:#71717a;">${coords}</div>
    </div>`;
  }

  function injectPopupStyles() {
    if (document.getElementById("surv-styles")) return;
    const s = document.createElement("style");
    s.id = "surv-styles";
    s.textContent = `
      .surv-pop .leaflet-popup-content-wrapper {
        background:#0d0d10!important;border:1px solid rgba(167,139,250,.35)!important;
        border-radius:12px!important;box-shadow:0 20px 60px rgba(0,0,0,.9)!important;padding:0!important;
      }
      .surv-pop .leaflet-popup-content{margin:0!important;padding:12px 14px!important;}
      .surv-pop .leaflet-popup-tip{background:#0d0d10!important;}
      .surv-pop .leaflet-popup-close-button{color:#52525b!important;top:6px!important;right:8px!important;}
    `;
    document.head.appendChild(s);
  }

  // ─── Derived display strings ──────────────────────────────────────────────
  const radiusLabel = radius >= 1000 ? `${radius / 1000} km` : `${radius} m`;
  const statusText  = {
    idle:     "",
    locating: "Locating you…",
    loading:  `Scanning ${radiusLabel} radius…`,
    done:     count > 0 ? `${count} camera${count !== 1 ? "s" : ""} found` : "No cameras mapped nearby",
    error:    err,
  }[status];

  return (
    <div className="relative -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)" }}>
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      {/* HUD bar */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm select-none">
        <Camera size={13} className="text-purple-400" />
        <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
        {statusText && (
          <>
            <div className="w-px h-4 bg-white/20 mx-1" />
            <span className={`text-[11px] font-mono flex items-center gap-1 ${
              status === "error"               ? "text-red-400"    :
              status === "done" && count === 0 ? "text-zinc-400"   :
              status === "done"                ? "text-green-400"  :
                                                 "text-purple-400 animate-pulse"
            }`}>
              {status === "error" && <AlertCircle size={10} />}
              {statusText}
            </span>
          </>
        )}
      </div>

      {/* Rescan */}
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => {
            const m = mapInst.current;
            const l = markerLayer.current;
            if (m && l) startScan(m, l);
          }}
          disabled={status === "locating" || status === "loading"}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm text-[11px] font-mono text-zinc-300 hover:text-white hover:border-purple-400/50 disabled:opacity-40 transition-all active:scale-95"
        >
          <Crosshair size={12} className={status === "locating" || status === "loading" ? "animate-spin" : ""} />
          Rescan
        </button>
      </div>
    </div>
  );
}
