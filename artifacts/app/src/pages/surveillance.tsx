import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format } from "date-fns";
import { Camera } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";

interface SurvPhoto {
  id: number;
  photoData: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  takenAt: string;
  toName: string | null;
  toPhone: string;
}

export default function Surveillance() {
  const { userId } = useAuth();
  const mapRef  = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layers  = useRef<L.Layer[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

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
      s.textContent = `.surv-pop .leaflet-popup-content-wrapper{background:#0d0d10!important;border:1px solid rgba(167,139,250,.3)!important;border-radius:14px!important;box-shadow:0 20px 60px rgba(0,0,0,.9)!important;padding:0!important;}.surv-pop .leaflet-popup-content{margin:0!important;}.surv-pop .leaflet-popup-tip{background:#0d0d10!important;}.surv-pop .leaflet-popup-close-button{color:#52525b!important;top:6px!important;right:8px!important;}`;
      document.head.appendChild(s);
    }
    return () => { try { mapInst.current?.remove(); } catch { /**/ } mapInst.current = null; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`)
      .then(r => r.ok ? r.json() : [])
      .then((photos: SurvPhoto[]) => {
        setLoading(false);
        const map = mapInst.current;
        if (!map) return;
        for (const l of layers.current) { try { l.remove(); } catch { /**/ } }
        layers.current = [];

        const pts: [number,number][] = [];
        photos.forEach(p => {
          if (p.latitude == null || p.longitude == null) return;
          if (!isFinite(p.latitude) || !isFinite(p.longitude)) return;
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:34px;height:34px;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:2px solid rgba(167,139,250,.6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 4px 16px rgba(124,58,237,.8);cursor:pointer;">📷</div>`,
            iconSize: [34,34], iconAnchor: [17,34], popupAnchor: [0,-38],
          });
          const m = L.marker([p.latitude, p.longitude], { icon }).addTo(map);
          m.bindPopup(
            `<div style="width:220px;font-family:system-ui,sans-serif;color:#f4f4f5;padding:12px;">
              <img src="${p.photoData}" style="width:100%;border-radius:9px;margin-bottom:9px;display:block;border:1px solid rgba(255,255,255,.1);">
              <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${p.toName ?? p.toPhone}</div>
              <div style="font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;margin-bottom:2px;">${p.address ?? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}</div>
              <div style="font-size:10px;color:#71717a;">${format(new Date(p.takenAt), "PPpp")}</div>
            </div>`,
            { className: "surv-pop", maxWidth: 244, minWidth: 244 }
          );
          layers.current.push(m);
          pts.push([p.latitude, p.longitude]);
        });

        setCount(pts.length);
        if (pts.length === 1) map.setView(pts[0], 15);
        else if (pts.length > 1) { try { map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 18 }); } catch { /**/ } }
      })
      .catch(() => setLoading(false));
  }, [userId]);

  return (
    <div className="relative -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)" }}>
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      {/* HUD */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/60 backdrop-blur">
        <Camera size={13} className="text-purple-400" />
        <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
        {!loading && <><div className="w-px h-4 bg-white/20 mx-1" /><span className="text-[11px] font-mono text-zinc-400">{count} camera{count !== 1 ? "s" : ""}</span></>}
        {loading && <span className="text-[11px] font-mono text-purple-400 animate-pulse ml-1">Loading…</span>}
      </div>
    </div>
  );
}
