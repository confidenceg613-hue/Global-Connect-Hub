import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Camera, Crosshair, AlertCircle, Radio } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const SATELLITE_URL = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const LABELS_URL    = "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}";
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface LocPoint { latitude: number; longitude: number; createdAt: string; }
interface Invite   { id: number; token: string; toName: string | null; toPhone: string; status: string; }

// ── Prediction ────────────────────────────────────────────────────────────────
function predictPath(history: LocPoint[]): [number, number][] {
  if (history.length < 2) return [];
  const pts = history.slice(-8);
  let wLat = 0, wLng = 0, totalW = 0;
  for (let i = 1; i < pts.length; i++) {
    const dtMs = new Date(pts[i].createdAt).getTime() - new Date(pts[i-1].createdAt).getTime();
    if (dtMs <= 0) continue;
    const w = i;
    wLat   += ((pts[i].latitude  - pts[i-1].latitude)  / dtMs) * w;
    wLng   += ((pts[i].longitude - pts[i-1].longitude) / dtMs) * w;
    totalW += w;
  }
  if (totalW === 0) return [];
  const velLat = wLat / totalW, velLng = wLng / totalW;
  const last = pts[pts.length - 1];
  const elapsed = Date.now() - new Date(last.createdAt).getTime();
  return [5, 10, 15].map(m => [
    last.latitude  + velLat * (elapsed + m * 60_000),
    last.longitude + velLng * (elapsed + m * 60_000),
  ] as [number, number]);
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
const enc = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`;

const camIcon = L.icon({
  iconUrl: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
    <defs><filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/></filter></defs>
    <path d="M16 2C9.4 2 4 7.4 4 14c0 9.5 12 28 12 28s12-18.5 12-28C28 7.4 22.6 2 16 2z" fill="#7c3aed" filter="url(#s)" stroke="white" stroke-width="2.2"/>
    <text x="16" y="19" text-anchor="middle" font-size="12">📷</text>
  </svg>`),
  iconSize: [32,44], iconAnchor: [16,44], popupAnchor: [0,-46],
});

const meIcon = L.icon({
  iconUrl: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
    <defs><filter id="s"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.55)"/></filter></defs>
    <path d="M14 1C8.5 1 4 5.5 4 11c0 8 10 26 10 26s10-18 10-26C24 5.5 19.5 1 14 1z" fill="#22c55e" filter="url(#s)" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="11" r="4.5" fill="white" opacity="0.92"/>
  </svg>`),
  iconSize: [28,38], iconAnchor: [14,38], popupAnchor: [0,-40],
});

function makeContactIcon(color = "#3b82f6") {
  return L.icon({
    iconUrl: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
      <defs><filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/></filter></defs>
      <path d="M15 2C8.9 2 4 6.9 4 13c0 8.5 11 25 11 25s11-16.5 11-25C26 6.9 21.1 2 15 2z" fill="${color}" filter="url(#s)" stroke="white" stroke-width="2"/>
      <circle cx="15" cy="13" r="5" fill="white" opacity="0.85"/>
    </svg>`),
    iconSize: [30,40], iconAnchor: [15,40], popupAnchor: [0,-42],
  });
}

function predDotIcon(idx: number) {
  const size = 14 - idx * 2;
  const op   = (1 - idx * 0.2).toFixed(2);
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:rgba(239,68,68,${op});border:2px solid rgba(255,255,255,.8);border-radius:50%;box-shadow:0 0 8px rgba(239,68,68,.8);"></div>`,
    iconSize: [size,size], iconAnchor: [size/2,size/2], popupAnchor: [0,-10],
  });
}

function arrowIcon(angle: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid #ef4444;transform:rotate(${angle}deg);filter:drop-shadow(0 0 4px rgba(239,68,68,.9));"></div>`,
    iconSize: [16,16], iconAnchor: [8,8],
  });
}

// ── Overpass ──────────────────────────────────────────────────────────────────
function buildQuery(lat: number, lng: number, r: number) {
  const a = `around:${r},${lat},${lng}`;
  return `[out:json][timeout:30];(node["man_made"="surveillance"]["surveillance"!="radar"](${a});node["surveillance:type"="camera"](${a});node["camera:type"](${a});way["man_made"="surveillance"](${a});relation["man_made"="surveillance"](${a}););out center;`;
}

async function queryOverpass(lat: number, lng: number, r: number, signal: AbortSignal) {
  const body = `data=${encodeURIComponent(buildQuery(lat, lng, r))}`;
  for (const mirror of OVERPASS_MIRRORS) {
    if (signal.aborted) return null;
    try {
      const res = await fetch(mirror, { method:"POST", body, headers:{"Content-Type":"application/x-www-form-urlencoded"}, signal });
      if (!res.ok) continue;
      const json = await res.json() as { elements?: { id:number; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags:Record<string,string> }[] };
      return json.elements ?? [];
    } catch { /* try next */ }
  }
  return null;
}

// ── Popup HTML ────────────────────────────────────────────────────────────────
function popup(title: string, body: string, coords: string) {
  return `<div style="min-width:175px;color:#f4f4f5;font-family:system-ui,sans-serif;">
    <div style="font-weight:700;font-size:13px;margin-bottom:${body?5:2}px;">${title}</div>
    ${body ? `<div style="font-size:11px;color:#d4d4d8;line-height:1.8;">${body}</div>` : ""}
    <div style="margin-top:5px;font-size:9px;font-family:ui-monospace,monospace;color:#71717a;">${coords}</div>
  </div>`;
}

// ── Contact live tracker ──────────────────────────────────────────────────────
// Manages a single contact's marker + prediction layers via SSE.
// Re-renders only that contact's layers when a new position arrives.
class ContactTracker {
  name:      string;
  token:     string;
  layer:     L.LayerGroup;
  apiBase:   string;
  marker:    L.Marker | null    = null;
  predLine:  L.Polyline | null  = null;
  predDots:  L.Marker[]         = [];
  predArrow: L.Marker | null    = null;
  history:   LocPoint[]         = [];
  es:        EventSource | null = null;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  disposed = false;

  constructor(token: string, name: string, layer: L.LayerGroup, apiBase: string) {
    this.token = token; this.name = name; this.layer = layer; this.apiBase = apiBase;
  }

  async start() {
    // Load recent history first for good initial prediction
    try {
      const res = await fetch(`${this.apiBase}/api/location/history/${this.token}?limit=30`);
      if (res.ok) {
        this.history = await res.json();
        if (this.history.length) this.render(this.history[this.history.length-1].latitude, this.history[this.history.length-1].longitude);
      }
    } catch { /**/ }

    if (this.disposed) return;

    // SSE for real-time updates
    const es = new EventSource(`${this.apiBase}/api/location/stream/${this.token}`);
    this.es = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { lat: number; lng: number; timestamp: string };
        const pt: LocPoint = { latitude: d.lat, longitude: d.lng, createdAt: d.timestamp };
        this.history = [...this.history.slice(-29), pt];
        this.render(d.lat, d.lng);
      } catch { /**/ }
    };

    // Fallback poll every 5 s if SSE delivers nothing (stale contacts)
    this.pollTimer = setInterval(async () => {
      if (this.disposed) return;
      try {
        const r = await fetch(`${this.apiBase}/api/location/history/${this.token}?limit=5`);
        if (!r.ok) return;
        const pts: LocPoint[] = await r.json();
        if (!pts.length) return;
        const latest = pts[pts.length-1];
        const alreadyKnown = this.history.some(h => h.createdAt === latest.createdAt);
        if (!alreadyKnown) {
          this.history = [...this.history.slice(-29), ...pts.filter(p => !this.history.some(h => h.createdAt === p.createdAt))];
          this.render(latest.latitude, latest.longitude);
        }
      } catch { /**/ }
    }, 5_000);
  }

  render(lat: number, lng: number) {
    if (this.disposed) return;
    const icon = makeContactIcon("#3b82f6");

    if (!this.marker) {
      this.marker = L.marker([lat, lng], { icon, zIndexOffset: 2000 })
        .bindPopup(popup(`🔵 ${this.name}`, "Live position", `${lat.toFixed(5)}, ${lng.toFixed(5)}`), { className: "surv-pop" })
        .addTo(this.layer);
    } else {
      this.marker.setLatLng([lat, lng]);
      this.marker.setPopupContent(popup(`🔵 ${this.name}`, "Live position", `${lat.toFixed(5)}, ${lng.toFixed(5)}`));
    }

    // Remove old prediction layers
    this.predLine?.remove();   this.predLine  = null;
    this.predDots.forEach(d => d.remove()); this.predDots = [];
    this.predArrow?.remove();  this.predArrow = null;

    const predicted = predictPath(this.history);
    if (!predicted.length) return;

    const path: [number,number][] = [[lat, lng], ...predicted];
    this.predLine = L.polyline(path, { color:"#ef4444", weight:3, dashArray:"8 6", opacity:0.85 }).addTo(this.layer);

    const labels = ["5 min","10 min","15 min"];
    this.predDots = predicted.map(([pLat, pLng], i) =>
      L.marker([pLat, pLng], { icon: predDotIcon(i), zIndexOffset: 1500 })
        .bindPopup(popup(`🔴 ${labels[i]}`, `<b>${this.name}</b> likely here`, `${pLat.toFixed(5)}, ${pLng.toFixed(5)}`), { className:"surv-pop" })
        .addTo(this.layer)
    );

    const [endLat, endLng] = predicted[predicted.length-1];
    const [prevLat, prevLng] = predicted.length > 1 ? predicted[predicted.length-2] : [lat, lng];
    const angle = Math.atan2(endLng - prevLng, endLat - prevLat) * 180 / Math.PI;
    this.predArrow = L.marker([endLat, endLng], { icon: arrowIcon(angle), zIndexOffset:1600 }).addTo(this.layer);
  }

  dispose() {
    this.disposed = true;
    this.es?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.marker?.remove();
    this.predLine?.remove();
    this.predDots.forEach(d => d.remove());
    this.predArrow?.remove();
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Surveillance() {
  const { userId } = useAuth();
  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInst     = useRef<L.Map | null>(null);
  const cctvLayer   = useRef<L.LayerGroup | null>(null);  // static, set once
  const liveLayer   = useRef<L.LayerGroup | null>(null);  // contacts + me
  const meMarker    = useRef<L.Marker | null>(null);
  const watchId     = useRef<number | null>(null);
  const trackers    = useRef<Map<string, ContactTracker>>(new Map());
  const abortCtrl   = useRef<AbortController>(new AbortController());

  const [cctvCount, setCctvCount] = useState(0);
  const [cctvStatus, setCctvStatus] = useState<"scanning"|"done"|"error"|"idle">("idle");
  const [liveCount, setLiveCount]   = useState(0);
  const [err, setErr] = useState("");

  // ── Inject popup styles once ─────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("surv-styles")) return;
    const s = document.createElement("style"); s.id = "surv-styles";
    s.textContent = `.surv-pop .leaflet-popup-content-wrapper{background:#0d0d10!important;border:1px solid rgba(167,139,250,.35)!important;border-radius:12px!important;box-shadow:0 20px 60px rgba(0,0,0,.9)!important;padding:0!important;}.surv-pop .leaflet-popup-content{margin:0!important;padding:12px 14px!important;}.surv-pop .leaflet-popup-tip{background:#0d0d10!important;}.surv-pop .leaflet-popup-close-button{color:#52525b!important;top:6px!important;right:8px!important;}`;
    document.head.appendChild(s);
  }, []);

  // ── Map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center:[20,0], zoom:2, zoomControl:false });
    L.tileLayer(SATELLITE_URL, { maxZoom:22, maxNativeZoom:21, subdomains:["0","1","2","3"] }).addTo(map);
    L.tileLayer(LABELS_URL,    { maxZoom:22, maxNativeZoom:21, subdomains:["0","1","2","3"] }).addTo(map);
    L.control.zoom({ position:"bottomright" }).addTo(map);
    cctvLayer.current = L.layerGroup().addTo(map);
    liveLayer.current = L.layerGroup().addTo(map);
    mapInst.current   = map;

    return () => {
      abortCtrl.current.abort();
      trackers.current.forEach(t => t.dispose());
      trackers.current.clear();
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      try { mapInst.current?.remove(); } catch { /**/ }
      mapInst.current = null;
    };
  }, []);

  // ── Own location via watchPosition ───────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setErr("No geolocation"); return; }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const map = mapInst.current;
        const layer = liveLayer.current;
        if (!map || !layer) return;

        if (!meMarker.current) {
          meMarker.current = L.marker([lat, lng], { icon: meIcon, zIndexOffset:3000 })
            .bindPopup(popup("📍 You", "", `${lat.toFixed(5)}, ${lng.toFixed(5)}`), { className:"surv-pop" })
            .addTo(layer);
          map.setView([lat, lng], 15);
          // Kick off one-time CCTV scan and contact stream
          scanCCTV(lat, lng);
          startContactStreams();
        } else {
          meMarker.current.setLatLng([lat, lng]);
          meMarker.current.setPopupContent(popup("📍 You", "", `${lat.toFixed(5)}, ${lng.toFixed(5)}`));
        }
      },
      () => setErr("Location denied"),
      { enableHighAccuracy:true, maximumAge:2000, timeout:15000 }
    );
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CCTV scan (one-time, expands radius until hits) ─────────────────────
  const scanCCTV = useCallback(async (lat: number, lng: number) => {
    const sig = abortCtrl.current.signal;
    setCctvStatus("scanning");
    const RADII = [5_000, 15_000, 30_000, 75_000];
    for (const r of RADII) {
      if (sig.aborted) return;
      const els = await queryOverpass(lat, lng, r, sig);
      if (!els || els.length === 0) continue;

      const layer = cctvLayer.current!;
      layer.clearLayers();
      els.forEach(el => {
        const eLat = el.lat ?? el.center?.lat;
        const eLng = el.lon ?? el.center?.lon;
        if (eLat == null || eLng == null) return;
        const t = el.tags ?? {};
        const label = t["name"] ?? t["surveillance:type"] ?? t["camera:type"] ?? "CCTV Camera";
        L.marker([eLat, eLng], { icon: camIcon })
          .bindPopup(popup(`📷 ${label}`, [t["camera:type"]&&`Type: <b>${t["camera:type"]}</b>`,t["operator"]&&`Operator: <b>${t["operator"]}</b>`].filter(Boolean).join("<br/>"), `${eLat.toFixed(5)}, ${eLng.toFixed(5)}`), { className:"surv-pop" })
          .addTo(layer);
      });
      setCctvCount(els.length);
      setCctvStatus("done");
      return;
    }
    setCctvCount(0);
    setCctvStatus("done");
  }, []);

  // ── Contact SSE streams ──────────────────────────────────────────────────
  const startContactStreams = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/invites?userId=${userId}`);
      if (!res.ok) return;
      const invites: Invite[] = await res.json();
      const accepted = invites.filter(i => i.status === "accepted" || i.status === "granted");
      setLiveCount(accepted.length);

      accepted.forEach(inv => {
        if (trackers.current.has(inv.token)) return;
        const tracker = new ContactTracker(inv.token, inv.toName ?? inv.toPhone ?? "Contact", liveLayer.current!, API_BASE);
        trackers.current.set(inv.token, tracker);
        tracker.start();
      });
    } catch { /**/ }
  }, [userId]);

  const rescan = () => {
    // Refresh contacts (may have new ones)
    startContactStreams();
    // Re-scan CCTV from current position
    const me = meMarker.current?.getLatLng();
    if (me) scanCCTV(me.lat, me.lng);
  };

  const scanning = cctvStatus === "scanning";

  return (
    <div className="relative -m-4 md:-m-8" style={{ height:"calc(100vh - 64px)" }}>
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex:0 }} />

      {/* HUD */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm select-none">
        <Camera size={13} className="text-purple-400" />
        <span className="text-[11px] font-bold font-mono text-purple-300 uppercase tracking-wider">Surveillance</span>
        <div className="w-px h-4 bg-white/20 mx-1" />
        {err
          ? <span className="text-[11px] font-mono text-red-400 flex items-center gap-1"><AlertCircle size={10}/>{err}</span>
          : <span className={`text-[11px] font-mono ${scanning ? "text-purple-400 animate-pulse" : "text-green-400"}`}>
              {scanning ? "Scanning cameras…" : `${cctvCount} cameras · ${liveCount} live`}
            </span>
        }
        {/* Live pulse */}
        {!scanning && liveCount > 0 && (
          <span className="relative flex h-2 w-2 ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"/>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"/>
          </span>
        )}
        {scanning && (
          <span className="relative flex h-2 w-2 ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"/>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"/>
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-8 left-3 z-[1000] flex flex-col gap-1 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm text-[10px] font-mono text-zinc-400">
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block"/>You</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"/>Contact (live)</div>
        <div className="flex items-center gap-1.5"><Radio size={10} className="text-red-400"/>Predicted path</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"/>CCTV camera</div>
      </div>

      {/* Rescan */}
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={rescan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-black/65 backdrop-blur-sm text-[11px] font-mono text-zinc-300 hover:text-white hover:border-purple-400/50 disabled:opacity-40 transition-all active:scale-95"
        >
          <Crosshair size={12} className={scanning ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
    </div>
  );
}
