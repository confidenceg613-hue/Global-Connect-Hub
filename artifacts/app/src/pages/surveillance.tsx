import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Camera, Crosshair } from "lucide-react";

const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";
const OVERPASS_URL  = "https://overpass-api.de/api/interpreter";

// Overpass query: surveillance cameras within radius of a point
function buildQuery(lat: number, lng: number, radiusM: number) {
  return `[out:json][timeout:20];
(
  node["man_made"="surveillance"](around:${radiusM},${lat},${lng});
  node["surveillance"="camera"](around:${radiusM},${lat},${lng});
  node["surveillance:type"="camera"](around:${radiusM},${lat},${lng});
);
out body;`;
}

interface Camera { id: number; lat: number; lon: number; tags: Record<string, string>; }

export default function Surveillance() {
  const mapRef  = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layers  = useRef<L.Layer[]>([]);

  const [status, setStatus] = useState<"idle"|"locating"|"loading"|"done"|"error">("idle");
  const [count, setCount]   = useState(0);
  const [err, setErr]       = useState("");

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
    L.tileLayer(SATELLITE_URL, { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.tileLayer(LABELS_URL,    { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInst.current = map;

    if (!document.getElementById("surv-styles")) {
      const s = document.createElement("style");
      s.id = "surv-styles";
      s.textContent = `.surv-pop .leaflet-popup-content-wrapper{background:#0d0d10!important;border:1px solid rgba(167,139,250,.3)!important;border-radius:12px!important;box-shadow:0 20px 60px rgba(0,0,0,.9)!important;padding:0!important;}.surv-pop .leaflet-popup-content{margin:0!important;padding:12px!important;color:#f4f4f5;font-family:system-ui,sans-serif;font-size:12px;}.surv-pop .leaflet-popup-tip{background:#0d0d10!important;}.surv-pop .leaflet-popup-close-button{color:#52525b!important;top:6px!important;right:8px!important;}`;
      document.head.appendChild(s);
    }

    // Auto-locate on mount
    locate(map);

    return () => { try { mapInst.current?.remove(); } catch { /**/ } mapInst.current = null; };
  }, []);

  function clearLayers() {
    for (const l of layers.current) { try { l.remove(); } catch { /**/ } }
    layers.current = [];
  }

  async function locate(map: L.Map) {
    if (!navigator.geolocation) { setErr("Geolocation not supported"); setStatus("error"); return; }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchCameras(map, pos.coords.latitude, pos.coords.longitude),
      () => { setErr("Location access denied"); setStatus("error"); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function fetchCameras(map: L.Map, lat: number, lng: number) {
    setStatus("loading");
    clearLayers();

    // My position marker
    const meIcon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,.3);"></div>`,
      iconSize: [14,14], iconAnchor: [7,7],
    });
    const meMarker = L.marker([lat, lng], { icon: meIcon, zIndexOffset: 1000 })
      .bindPopup(`<strong>Your location</strong><br/><span style="font-size:10px;color:#a1a1aa;">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`)
      .addTo(map);
    layers.current.push(meMarker);
    map.setView([lat, lng], 15);

    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        body: `data=${encodeURIComponent(buildQuery(lat, lng, 5000))}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const json = await res.json() as { elements: Camera[] };
      const cams = json.elements ?? [];

      cams.forEach((cam) => {
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:30px;height:30px;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:2px solid rgba(167,139,250,.7);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 4px 14px rgba(124,58,237,.8);">📷</div>`,
          iconSize: [30,30], iconAnchor: [15,30], popupAnchor: [0,-34],
        });

        const t = cam.tags;
        const label = t["name"] || t["surveillance:type"] || t["surveillance"] || "CCTV Camera";
        const mount = t["surveillance:mount"] ? `<div>Mount: <strong>${t["surveillance:mount"]}</strong></div>` : "";
        const dir   = t["camera:direction"] ? `<div>Direction: <strong>${t["camera:direction"]}°</strong></div>` : "";
        const type  = t["camera:type"] ? `<div>Type: <strong>${t["camera:type"]}</strong></div>` : "";
        const op    = t["operator"] ? `<div>Operator: <strong>${t["operator"]}</strong></div>` : "";

        L.marker([cam.lat, cam.lon], { icon })
          .bindPopup(
            `<div style="min-width:180px;">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;">📷 ${label}</div>
              <div style="font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;line-height:1.7;">
                ${type}${mount}${dir}${op}
                <div style="margin-top:4px;color:#71717a;">${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}</div>
              </div>
            </div>`,
            { className: "surv-pop", maxWidth: 220 }
          )
          .addTo(map);
      });

      setCount(cams.length);
      setStatus("done");
    } catch {
      setErr("Could not load camera data");
      setStatus("error");
    }
  }

  const statusLabel = {
    idle: "",
    locating: "Locating you…",
    loading: "Scanning for cameras…",
    done: `${count} camera${count !== 1 ? "s" : ""} nearby`,
    error: err,
  }[status];

  return (
    <div className="relative -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)" }}>
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      {/* HUD */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/60 backdrop-blur">
        <Camera size={13} className="text-purple-400" />
        <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
        {statusLabel && <><div className="w-px h-4 bg-white/20 mx-1" /><span className={`text-[11px] font-mono ${status === "error" ? "text-red-400" : status === "done" ? "text-zinc-300" : "text-purple-400 animate-pulse"}`}>{statusLabel}</span></>}
      </div>

      {/* Re-scan button */}
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => { const m = mapInst.current; if (m) locate(m); }}
          disabled={status === "locating" || status === "loading"}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-black/60 backdrop-blur text-[11px] font-mono text-zinc-300 hover:text-white hover:border-purple-400/40 disabled:opacity-40 transition-all"
        >
          <Crosshair size={12} className={status === "locating" || status === "loading" ? "animate-spin" : ""} />
          Rescan
        </button>
      </div>
    </div>
  );
}
