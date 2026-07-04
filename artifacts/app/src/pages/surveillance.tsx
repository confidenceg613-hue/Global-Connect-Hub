import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format, formatDistanceToNow } from "date-fns";
import { Camera, MapPin, ChevronLeft } from "lucide-react";

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
  inviteToken: string;
  toName: string | null;
  toPhone: string;
}

export default function Surveillance() {
  const { userId } = useAuth();
  const mapRef    = useRef<HTMLDivElement>(null);
  const mapInst   = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  const [photos, setPhotos]       = useState<SurvPhoto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<SurvPhoto | null>(null);

  // Fetch photos
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: SurvPhoto[]) => { setPhotos(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: false });
    L.tileLayer(SATELLITE_URL, { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.tileLayer(LABELS_URL,    { maxZoom: 22, maxNativeZoom: 21, subdomains: ["0","1","2","3"] }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInst.current = map;

    if (!document.getElementById("surv-map-styles")) {
      const s = document.createElement("style");
      s.id = "surv-map-styles";
      s.textContent = `
        .surv-popup .leaflet-popup-content-wrapper{background:#0d0d10!important;border:1px solid rgba(167,139,250,.25)!important;border-radius:14px!important;box-shadow:0 24px 64px rgba(0,0,0,.9)!important;padding:0!important;}
        .surv-popup .leaflet-popup-content{margin:0!important;}
        .surv-popup .leaflet-popup-tip{background:#0d0d10!important;}
        .surv-popup .leaflet-popup-close-button{color:#52525b!important;font-size:16px!important;top:6px!important;right:8px!important;z-index:10;}
        .surv-cam-marker{transition:transform .15s;}
        .surv-cam-marker:hover{transform:scale(1.15);}
      `;
      document.head.appendChild(s);
    }

    return () => {
      try { mapInst.current?.remove(); } catch { /* */ }
      mapInst.current = null;
    };
  }, []);

  // Place markers whenever photos load
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    for (const l of layersRef.current) { try { l.remove(); } catch { /* */ } }
    layersRef.current = [];

    const latlngs: [number, number][] = [];

    photos.forEach((photo) => {
      if (photo.latitude == null || photo.longitude == null) return;
      if (!isFinite(photo.latitude) || !isFinite(photo.longitude)) return;

      const icon = L.divIcon({
        className: "",
        html: `<div class="surv-cam-marker" style="width:36px;height:36px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:2px solid rgba(167,139,250,.5);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 4px 16px rgba(124,58,237,.7);cursor:pointer;">📷</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -40],
      });

      const marker = L.marker([photo.latitude, photo.longitude], { icon }).addTo(map);

      marker.bindPopup(
        `<div style="width:230px;font-family:system-ui,sans-serif;color:#f4f4f5;padding:12px;">
          <img src="${photo.photoData}" style="width:100%;border-radius:9px;margin-bottom:10px;display:block;border:1px solid rgba(255,255,255,.1);" />
          <div style="font-size:13px;font-weight:700;margin-bottom:3px;">${photo.toName ?? photo.toPhone}</div>
          <div style="font-size:10px;color:#a1a1aa;font-family:ui-monospace,monospace;margin-bottom:3px;">${photo.address ?? `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`}</div>
          <div style="font-size:10px;color:#71717a;">${format(new Date(photo.takenAt), "PPpp")}</div>
        </div>`,
        { className: "surv-popup", maxWidth: 250, minWidth: 250 }
      );

      marker.on("click", () => setSelected(photo));
      layersRef.current.push(marker);
      latlngs.push([photo.latitude, photo.longitude]);
    });

    if (latlngs.length === 1) map.setView(latlngs[0], 14);
    else if (latlngs.length > 1) {
      try { map.fitBounds(L.latLngBounds(latlngs).pad(0.12), { maxZoom: 18 }); } catch { /* */ }
    }
  }, [photos]);

  const flyTo = (photo: SurvPhoto) => {
    if (photo.latitude == null || photo.longitude == null) return;
    try { mapInst.current?.flyTo([photo.latitude, photo.longitude], 17, { duration: 1.2 }); } catch { /* */ }
  };

  const withCoords = photos.filter((p) => p.latitude != null && p.longitude != null);
  const noCoords   = photos.filter((p) => p.latitude == null || p.longitude == null);

  return (
    <div className="flex flex-col gap-0 -m-4 md:-m-8" style={{ height: "calc(100vh - 64px)", minHeight: 500 }}>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-background flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
            <Camera size={14} className="text-purple-400" />
          </div>
          <span className="font-bold text-sm text-white">Surveillance</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-zinc-500">
          {loading ? (
            <span className="animate-pulse text-purple-400">Loading…</span>
          ) : (
            <>
              <span><span className="text-white font-bold">{withCoords.length}</span> on map</span>
              {noCoords.length > 0 && <span><span className="text-zinc-400">{noCoords.length}</span> no GPS</span>}
            </>
          )}
        </div>
      </div>

      {/* Body: map + side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-w-0">
          <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

          {/* Empty state overlay */}
          {!loading && photos.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-3 px-8 py-8 rounded-2xl border border-white/10 bg-black/60 backdrop-blur text-center max-w-xs">
                <MapPin size={32} className="text-purple-400 opacity-40" />
                <p className="font-semibold text-white text-sm">No surveillance photos yet</p>
                <p className="text-xs text-zinc-500 leading-relaxed">Photos are auto-captured when contacts grant location consent. They'll appear here as map pins.</p>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="w-64 flex-shrink-0 flex flex-col border-l border-white/10 bg-[#0d0d10] overflow-hidden">
          {selected ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 flex-shrink-0">
                <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white font-mono transition-colors">
                  <ChevronLeft size={12} /> Back
                </button>
                <span className="ml-auto text-[10px] font-mono text-purple-400">Detail</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                <img src={selected.photoData} className="w-full rounded-xl border border-white/10" alt="Capture" />
                <div>
                  <div className="text-[13px] font-bold text-white">{selected.toName ?? selected.toPhone}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{selected.toPhone}</div>
                </div>
                <div className="rounded-lg bg-white/[.04] border border-white/[.07] px-3 py-2.5 flex flex-col gap-1.5 text-[10px] font-mono">
                  <div className="text-zinc-400">{selected.address ?? "No address"}</div>
                  {selected.latitude != null && (
                    <div className="text-zinc-500">{selected.latitude.toFixed(6)}, {selected.longitude?.toFixed(6)}</div>
                  )}
                  <div className="text-zinc-600 mt-0.5">{formatDistanceToNow(new Date(selected.takenAt), { addSuffix: true })}</div>
                  <div className="text-zinc-700">{format(new Date(selected.takenAt), "PPpp")}</div>
                </div>
                {selected.latitude != null && (
                  <button
                    onClick={() => flyTo(selected)}
                    className="w-full py-2 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-400 text-[11px] font-bold font-mono hover:bg-purple-600/30 transition-colors"
                  >
                    📍 Fly to on map
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 flex-shrink-0">
                <Camera size={12} className="text-purple-400" />
                <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Captures</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-[11px] text-zinc-500 font-mono animate-pulse">Loading…</div>
                ) : photos.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[11px] text-zinc-600 font-mono text-center px-4">No captures yet</div>
                ) : (
                  <div className="grid grid-cols-2 gap-1 p-1.5">
                    {photos.map((photo) => (
                      <button
                        key={photo.id}
                        onClick={() => { setSelected(photo); flyTo(photo); }}
                        className="relative group rounded-lg overflow-hidden border border-white/10 hover:border-purple-400/50 transition-all aspect-square bg-zinc-900"
                      >
                        <img src={photo.photoData} className="w-full h-full object-cover" alt="" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />
                        {photo.latitude == null && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-zinc-800/80 flex items-center justify-center text-[8px]">📵</div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all">
                          <div className="text-[9px] font-mono text-white truncate">{photo.toName ?? photo.toPhone}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
