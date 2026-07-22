import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatDistanceToNow, format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Tier = "PRECISE" | "HIGH" | "MODERATE" | "LOW" | "ESTIMATE";

const TIER_CONFIG: Record<Tier, { color: string; glow: string; bg: string; border: string; label: string }> = {
  PRECISE:  { color: "#00ff88", glow: "#00ff8866", bg: "rgba(0,255,136,.07)",  border: "rgba(0,255,136,.25)",  label: "PRECISE"  },
  HIGH:     { color: "#10b981", glow: "#10b98166", bg: "rgba(16,185,129,.07)", border: "rgba(16,185,129,.25)", label: "HIGH"     },
  MODERATE: { color: "#f59e0b", glow: "#f59e0b66", bg: "rgba(245,158,11,.07)", border: "rgba(245,158,11,.25)", label: "MODERATE" },
  LOW:      { color: "#f97316", glow: "#f9731666", bg: "rgba(249,115,22,.07)", border: "rgba(249,115,22,.25)", label: "LOW"      },
  ESTIMATE: { color: "#ef4444", glow: "#ef444466", bg: "rgba(239,68,68,.07)",  border: "rgba(239,68,68,.25)",  label: "ESTIMATE" },
};

type ActivityType = "stationary" | "walking" | "running" | "driving";
const ACTIVITY: Record<ActivityType, { icon: string; label: string }> = {
  stationary: { icon: "⏸", label: "Stationary" },
  walking:    { icon: "🚶", label: "Walking"    },
  running:    { icon: "🏃", label: "Running"    },
  driving:    { icon: "🚗", label: "Driving"    },
};

interface GeoSource {
  provider: string;
  lat: number; lon: number;
  city?: string; regionName?: string; country?: string;
  isp?: string; org?: string; asn?: string; asnName?: string;
  mobile?: boolean; proxy?: boolean; hosting?: boolean;
}

interface IpIntel {
  sources: GeoSource[];
  consensus: {
    lat: number; lon: number;
    radiusKm: number; confidencePct: number;
    agreementCount: number; totalQueried: number; method: string;
  };
  flags: { mobile: boolean; proxy: boolean; hosting: boolean; vpnLikely: boolean };
  asn?: string; asnName?: string;
}

interface HistoryFix {
  lat: number; lng: number;
  accuracy?: number | null;
  source?: string | null;
  activity?: string | null;
  battery?: number | null;
  address?: string | null;
  ts: string;
}

interface Contact {
  inviteId: number; token: string;
  toName: string | null; toPhone: string; status: string;
  grantedAt: string | null; openedAt: string | null;
  openedIp: string | null; grantedIp: string | null;
  ipInfo: Record<string, unknown> | null;
  latitude: number | null; longitude: number | null;
  address: string | null; lastUpdate: string | null;
  accuracy: number | null; batteryLevel: number | null;
  batteryCharging: boolean | null; activityType: ActivityType | null;
  source: string | null; hasGpsfix: boolean;
  gpsQualityScore: number;
  movementVector?: { bearingDeg: number; speedKmh: number; distanceM: number; ageSecs: number } | null;
  locationHistory: HistoryFix[];
  matchedOn: string[];
}

interface BestEstimate {
  lat: number; lon: number; accuracyM: number;
  method: string; confidencePct: number;
  tier: Tier;
  contactName: string | null; contactPhone: string | null;
  source: string;
}

interface LanIpEntry {
  id: number;
  userId: number;
  ip: string;
  label: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

interface LookupResult {
  contacts: Contact[];
  ipIntel: IpIntel | { note: string };
  searchedIp: string;
  bestEstimate: BestEstimate | null;
  lanEntry?: LanIpEntry | null;
}

function initials(name?: string | null, phone?: string | null) {
  if (name) return name.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2);
  const d = (phone ?? "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}

// ── Leaflet icon factories ─────────────────────────────────────────────────

function makeGpsPin(color: string, label: string, pulsing = false) {
  const pulse = pulsing ? `<div style="position:absolute;inset:-8px;border-radius:50%;background:${color}22;animation:pl-pulse 2s ease-out infinite;"></div>` : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:40px;height:52px;filter:drop-shadow(0 0 8px ${color}aa);">
      ${pulse}
      <div style="width:40px;height:40px;background:${color};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;letter-spacing:-0.5px;">${label}</div>
      <div style="width:4px;height:12px;background:${color};margin:0 auto;border-radius:0 0 3px 3px;"></div>
    </div>`,
    iconSize: [40, 52], iconAnchor: [20, 52], popupAnchor: [0, -54],
  });
}

function makeHistoryDot(color: string, radius = 6) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${color};border:1.5px solid #000a;opacity:0.75;"></div>`,
    iconSize: [radius * 2, radius * 2], iconAnchor: [radius, radius],
  });
}

function makeReticle(tier: Tier) {
  const c = TIER_CONFIG[tier].color;
  return L.divIcon({
    className: "",
    html: `<div style="filter:drop-shadow(0 0 12px ${c});">
      <svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <circle cx="30" cy="30" r="27" fill="none" stroke="${c}" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.6"/>
        <circle cx="30" cy="30" r="14" fill="none" stroke="${c}" stroke-width="1" opacity="0.5"/>
        <circle cx="30" cy="30" r="4" fill="${c}"/>
        <line x1="30" y1="2"  x2="30" y2="16" stroke="${c}" stroke-width="2"/>
        <line x1="30" y1="44" x2="30" y2="58" stroke="${c}" stroke-width="2"/>
        <line x1="2"  y1="30" x2="16" y2="30" stroke="${c}" stroke-width="2"/>
        <line x1="44" y1="30" x2="58" y2="30" stroke="${c}" stroke-width="2"/>
        <line x1="30" y1="2"  x2="30" y2="8"  stroke="${c}" stroke-width="3"/>
        <line x1="30" y1="52" x2="30" y2="58" stroke="${c}" stroke-width="3"/>
        <line x1="2"  y1="30" x2="8"  y2="30" stroke="${c}" stroke-width="3"/>
        <line x1="52" y1="30" x2="58" y2="30" stroke="${c}" stroke-width="3"/>
      </svg>
    </div>`,
    iconSize: [60, 60], iconAnchor: [30, 30], popupAnchor: [0, -32],
  });
}

function makeIpSourcePin(color: string, idx: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #000;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;">${idx}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
  });
}

// ── Confidence gauge component ─────────────────────────────────────────────
function ConfidenceGauge({ pct, tier, accuracyM }: { pct: number; tier: Tier; accuracyM: number }) {
  const cfg = TIER_CONFIG[tier];
  const r = 36;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);

  const accStr = accuracyM < 1000
    ? `±${Math.round(accuracyM)} m`
    : `±${(accuracyM / 1000).toFixed(1)} km`;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 shrink-0">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="6"/>
          <circle cx="40" cy="40" r={r} fill="none" stroke={cfg.color} strokeWidth="6"
            strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
            transform="rotate(-90 40 40)"
            style={{ filter: `drop-shadow(0 0 6px ${cfg.glow})`, transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-black" style={{ color: cfg.color }}>{pct}%</span>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-0.5">Confidence</div>
        <div className="text-lg font-black tracking-wider" style={{ color: cfg.color, textShadow: `0 0 12px ${cfg.glow}` }}>
          {cfg.label}
        </div>
        <div className="text-xs text-zinc-400 mt-0.5 font-mono">{accStr} accuracy radius</div>
      </div>
    </div>
  );
}

// ── Source agreement table ─────────────────────────────────────────────────
function SourceTable({ intel, searchedIp }: { intel: IpIntel; searchedIp: string }) {
  const SOURCE_COLORS = ["#38bdf8", "#a78bfa", "#fb923c", "#34d399"];
  const agreeing = new Set<string>();
  const { consensus, sources } = intel;

  // A source "agrees" if it's within 50km of the consensus centroid
  sources.forEach((s) => {
    if (haversineKm(consensus.lat, consensus.lon, s.lat, s.lon) <= 50) {
      agreeing.add(s.provider);
    }
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">IP Geolocation Sources</span>
        <span className="font-mono text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">{searchedIp}</span>
      </div>
      {sources.map((s, i) => {
        const ok = agreeing.has(s.provider);
        const loc = [s.city, s.regionName, s.country].filter(Boolean).join(", ");
        const dist = haversineKm(consensus.lat, consensus.lon, s.lat, s.lon);
        return (
          <div key={s.provider} className="flex items-start gap-2 p-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-black shrink-0 mt-0.5"
              style={{ background: SOURCE_COLORS[i] }}>
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">{s.provider}</span>
                {ok
                  ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">✓ AGREES</span>
                  : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-400">✗ OUTLIER</span>
                }
              </div>
              <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                {dist > 0.1 && <span className="text-zinc-600"> · {dist < 1 ? `${(dist*1000).toFixed(0)}m` : `${dist.toFixed(1)}km`} from consensus</span>}
              </div>
              {loc && <div className="text-[10px] text-zinc-500">{loc}</div>}
              {s.isp && <div className="text-[10px] text-zinc-600 truncate">{s.isp}</div>}
            </div>
          </div>
        );
      })}
      {intel.flags.mobile && <div className="text-xs text-blue-400 flex items-center gap-1"><span>📶</span> Mobile carrier network</div>}
      {intel.flags.proxy && <div className="text-xs text-red-400 flex items-center gap-1"><span>🔀</span> Proxy / VPN detected</div>}
      {intel.flags.hosting && <div className="text-xs text-red-400 flex items-center gap-1"><span>🖥</span> Datacenter / hosting IP</div>}
      {intel.asn && <div className="text-[10px] text-zinc-600 font-mono">{intel.asn}{intel.asnName ? ` · ${intel.asnName}` : ""}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function IpLookupPage() {
  const { userId } = useAuth();
  const [ip, setIp]         = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase]   = useState<"idle" | "acquiring" | "done">("idle");
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const mapRef    = useRef<HTMLDivElement>(null);
  const mapInst   = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Init Leaflet
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [20, 0], zoom: 2, zoomControl: true });
    L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      subdomains: ["0","1","2","3"], attribution: "Google Maps", maxZoom: 21,
    }).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  // Render all map layers whenever result changes
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /**/ } });
    layersRef.current = [];
    if (!result) return;

    const viewPoints: [number, number][] = [];
    const SOURCE_COLORS = ["#38bdf8", "#a78bfa", "#fb923c", "#34d399"];

    // ── IP source uncertainty rings ──────────────────────────────────────────
    const intel = result.ipIntel;
    if ("consensus" in intel) {
      const { consensus, sources } = intel;

      // Large translucent uncertainty circle for the consensus
      const uncertR = consensus.radiusKm * 1000;
      const uncertCircle = L.circle([consensus.lat, consensus.lon], {
        radius: Math.max(uncertR, 500),
        color: "#f59e0b", fillColor: "#f59e0b",
        fillOpacity: 0.04, weight: 1, dashArray: "6 4",
      }).addTo(map);
      layersRef.current.push(uncertCircle);

      // Per-source pins + small rings
      sources.forEach((s, i) => {
        const color = SOURCE_COLORS[i] ?? "#aaa";
        const pin = L.marker([s.lat, s.lon], { icon: makeIpSourcePin(color, i + 1) });
        const loc = [s.city, s.regionName, s.country].filter(Boolean).join(", ");
        pin.bindPopup(`
          <div style="font-family:ui-monospace,monospace;font-size:11px;color:#f4f4f5;min-width:160px;">
            <div style="font-weight:700;color:${esc(color)};margin-bottom:3px;">${esc(s.provider)}</div>
            <div>${esc(s.lat.toFixed(5))}, ${esc(s.lon.toFixed(5))}</div>
            ${loc ? `<div style="color:#a1a1aa;font-size:10px;">${esc(loc)}</div>` : ""}
            ${s.isp ? `<div style="color:#71717a;font-size:10px;">${esc(s.isp)}</div>` : ""}
          </div>
        `);
        pin.addTo(map);
        layersRef.current.push(pin);
        viewPoints.push([s.lat, s.lon]);
      });
    }

    // ── Per-contact GPS trails + accuracy rings ──────────────────────────────
    result.contacts.forEach((c) => {
      if (!c.hasGpsfix || c.latitude == null || c.longitude == null) return;

      const pinColor = c.source === "gps" ? "#00ff88" : c.source === "fused" ? "#10b981" : "#60a5fa";
      const trail = c.locationHistory.filter((h) => isFinite(h.lat) && isFinite(h.lng));

      // History dots (oldest → newest)
      trail.slice(1).forEach((h) => {
        const dot = L.marker([h.lat, h.lng], { icon: makeHistoryDot(pinColor, 4) });
        dot.bindPopup(`
          <div style="font-family:ui-monospace,monospace;font-size:10px;color:#a1a1aa;">
            ${esc(h.lat.toFixed(6))}, ${esc(h.lng.toFixed(6))}<br/>
            ${h.accuracy != null ? `±${esc(Math.round(h.accuracy))}m` : ""} · ${esc(h.source ?? "?")}
            <br/>${esc(formatDistanceToNow(new Date(h.ts), { addSuffix: true }))}
          </div>`);
        dot.addTo(map);
        layersRef.current.push(dot);
      });

      // Trail polyline
      if (trail.length >= 2) {
        const line = L.polyline(
          trail.map((h) => [h.lat, h.lng] as [number, number]),
          { color: pinColor, weight: 2, opacity: 0.45, dashArray: "4 3" },
        ).addTo(map);
        layersRef.current.push(line);
      }

      // Accuracy circle on latest fix
      if (c.accuracy != null && c.accuracy < 5000) {
        const ring = L.circle([c.latitude, c.longitude], {
          radius: Math.max(c.accuracy, 5),
          color: pinColor, fillColor: pinColor, fillOpacity: 0.08, weight: 1.5,
        }).addTo(map);
        layersRef.current.push(ring);
      }

      // GPS pin (pulsing if recent)
      const ageMin = c.lastUpdate
        ? (Date.now() - new Date(c.lastUpdate).getTime()) / 60000 : 9999;
      const pin = L.marker([c.latitude, c.longitude], {
        icon: makeGpsPin(pinColor, initials(c.toName, c.toPhone), ageMin < 10),
        zIndexOffset: 500,
      });
      const actStr = c.activityType ? `${ACTIVITY[c.activityType]?.icon} ${ACTIVITY[c.activityType]?.label}` : "";
      const batStr = c.batteryLevel != null ? `${c.batteryCharging ? "⚡" : "🔋"} ${c.batteryLevel}%` : "";
      const mv = c.movementVector;
      pin.bindPopup(`
        <div style="font-family:system-ui,sans-serif;color:#f4f4f5;min-width:200px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${esc(c.toName || c.toPhone)}</div>
          ${c.toName ? `<div style="font-size:10px;color:#71717a;font-family:ui-monospace,monospace;margin-bottom:6px;">${esc(c.toPhone)}</div>` : ""}
          <div style="font-size:11px;font-family:ui-monospace,monospace;font-weight:700;color:${esc(pinColor)};">${esc(c.latitude.toFixed(7))}, ${esc(c.longitude.toFixed(7))}</div>
          ${c.address ? `<div style="font-size:10px;color:#71717a;margin-top:2px;">${esc(c.address.slice(0, 85))}</div>` : ""}
          <div style="font-size:10px;color:#a1a1aa;margin-top:3px;">🛰 ${esc(c.source ?? "?")} · ${c.accuracy != null ? `±${esc(Math.round(c.accuracy))}m` : "?"} · ${esc(formatDistanceToNow(new Date(c.lastUpdate ?? ""), { addSuffix: true }))}</div>
          ${actStr ? `<div style="font-size:10px;margin-top:2px;">${esc(actStr)}${batStr ? ` · ${esc(batStr)}` : ""}</div>` : ""}
          ${mv ? `<div style="font-size:10px;color:#fcd34d;margin-top:3px;">➤ ${esc(mv.bearingDeg.toFixed(0))}° · ${esc(mv.speedKmh)} km/h · ${esc(mv.distanceM)}m travelled</div>` : ""}
          <div style="font-size:10px;color:#f59e0b;margin-top:4px;">📌 ${esc(c.locationHistory.length)} fixes on record</div>
        </div>
      `);
      pin.addTo(map);
      layersRef.current.push(pin);
      viewPoints.push([c.latitude, c.longitude]);
    });

    // ── LAN device marker ────────────────────────────────────────────────────
    const lan = result.lanEntry;
    if (lan?.latitude != null && lan?.longitude != null) {
      const lanIcon = L.divIcon({
        className: "",
        html: `<div style="position:relative;filter:drop-shadow(0 0 10px #a78bfaaa);">
          <div style="width:36px;height:36px;background:#a78bfa;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
            <span style="transform:rotate(45deg);font-size:16px;">🏠</span>
          </div>
        </div>`,
        iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
      });
      const lanPin = L.marker([lan.latitude, lan.longitude], { icon: lanIcon, zIndexOffset: 900 });
      lanPin.bindPopup(`
        <div style="font-family:ui-monospace,monospace;color:#f4f4f5;min-width:180px;">
          <div style="font-weight:800;font-size:13px;color:#a78bfa;margin-bottom:3px;">🏠 ${esc(lan.label)}</div>
          <div style="font-size:11px;font-family:ui-monospace;color:#a78bfa;">${esc(lan.ip)}</div>
          ${lan.address ? `<div style="font-size:10px;color:#a1a1aa;margin-top:2px;">${esc(lan.address)}</div>` : ""}
          <div style="font-size:10px;color:#71717a;margin-top:2px;">${esc(lan.latitude.toFixed(6))}, ${esc(lan.longitude.toFixed(6))}</div>
        </div>
      `);
      lanPin.addTo(map);
      layersRef.current.push(lanPin);
      viewPoints.push([lan.latitude, lan.longitude]);
    }

    // ── Best-estimate reticle ────────────────────────────────────────────────
    const be = result.bestEstimate;
    if (be) {
      const reticle = L.marker([be.lat, be.lon], { icon: makeReticle(be.tier), zIndexOffset: 1000 });
      const tier = TIER_CONFIG[be.tier];
      reticle.bindPopup(`
        <div style="font-family:ui-monospace,monospace;color:#f4f4f5;min-width:210px;">
          <div style="font-weight:800;font-size:13px;color:${esc(tier.color)};letter-spacing:.05em;margin-bottom:4px;">◎ BEST ESTIMATE — ${esc(be.tier)}</div>
          <div style="font-size:11px;font-weight:700;">${esc(be.lat.toFixed(7))}, ${esc(be.lon.toFixed(7))}</div>
          <div style="font-size:10px;color:#a1a1aa;margin-top:3px;">${esc(be.method)}</div>
          <div style="font-size:10px;color:${esc(tier.color)};margin-top:2px;">Confidence: ${esc(be.confidencePct)}%</div>
        </div>
      `);
      reticle.addTo(map);
      layersRef.current.push(reticle);
      if (!viewPoints.some(([la, ln]) => haversineKm(la, ln, be.lat, be.lon) < 0.1)) {
        viewPoints.push([be.lat, be.lon]);
      }
    }

    // Fit view
    if (viewPoints.length === 1) {
      const hasGps = result.contacts.some((c) => c.hasGpsfix);
      map.setView(viewPoints[0], hasGps ? 16 : 10);
    } else if (viewPoints.length > 1) {
      map.fitBounds(L.latLngBounds(viewPoints).pad(0.18), { maxZoom: 17 });
    }
  }, [result]);

  const handleSearch = async (overrideIp?: string) => {
    const target = (overrideIp ?? ip).trim();
    if (!target || !userId) return;
    setLoading(true);
    setPhase("acquiring");
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/ip-lookup?ip=${encodeURIComponent(target)}&userId=${userId}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${r.status}`);
      }
      const data: LookupResult = await r.json();
      setResult(data);
      setPhase("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setPhase("idle");
    } finally {
      setLoading(false);
    }
  };

  const [myIpLoading, setMyIpLoading] = useState(false);
  const handleUseMyIp = async () => {
    setMyIpLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/ip-lookup/my-ip`);
      if (!r.ok) throw new Error("Could not detect your IP");
      const { ip: detected } = await r.json() as { ip: string };
      setIp(detected);
      await handleSearch(detected);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not detect IP");
    } finally {
      setMyIpLoading(false);
    }
  };

  // ── LAN IP registry ─────────────────────────────────────────────────────────
  const [lanIps, setLanIps]         = useState<LanIpEntry[]>([]);
  const [lanForm, setLanForm]       = useState({ ip: "", label: "", address: "", lat: "", lon: "" });
  const [lanSaving, setLanSaving]   = useState(false);
  const [lanError, setLanError]     = useState<string | null>(null);
  const [lanOpen, setLanOpen]       = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API_BASE}/api/ip-lookup/lan?userId=${userId}`)
      .then(r => r.json()).then(setLanIps).catch(() => {});
  }, [userId]);

  const handleAddLan = async () => {
    if (!lanForm.ip.trim() || !lanForm.label.trim()) {
      setLanError("IP and label are required"); return;
    }
    setLanSaving(true); setLanError(null);
    try {
      const body: Record<string, unknown> = {
        userId, ip: lanForm.ip.trim(), label: lanForm.label.trim(),
      };
      if (lanForm.address.trim()) body.address = lanForm.address.trim();
      if (lanForm.lat.trim() && isFinite(Number(lanForm.lat))) body.latitude = Number(lanForm.lat);
      if (lanForm.lon.trim() && isFinite(Number(lanForm.lon))) body.longitude = Number(lanForm.lon);
      const r = await fetch(`${API_BASE}/api/ip-lookup/lan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as Record<string,string>).error || "Save failed"); }
      const entry: LanIpEntry = await r.json();
      setLanIps(prev => [...prev, entry]);
      setLanForm({ ip: "", label: "", address: "", lat: "", lon: "" });
    } catch (e: unknown) {
      setLanError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLanSaving(false);
    }
  };

  const handleDeleteLan = async (id: number) => {
    await fetch(`${API_BASE}/api/ip-lookup/lan/${id}?userId=${userId}`, { method: "DELETE" });
    setLanIps(prev => prev.filter(e => e.id !== id));
  };

  const be   = result?.bestEstimate;
  const tier = be ? TIER_CONFIG[be.tier] : null;
  const ipIntel = result?.ipIntel;
  const hasConsensus = ipIntel && "consensus" in ipIntel;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-400">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">IP Target Locator</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            4-source triangulation · GPS trail analysis · movement vector · confidence scoring
          </p>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs pointer-events-none select-none">IP›</span>
          <input
            type="text" value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="41.58.73.12 or 2a02:26f0:..."
            className="w-full pl-10 pr-4 py-3 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-green-300 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 font-mono tracking-wide"
          />
        </div>
        <button
          onClick={handleUseMyIp}
          disabled={loading || myIpLoading}
          title="Auto-detect and search your current public IP"
          className="flex items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed border border-zinc-600 hover:border-zinc-400 text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 shrink-0"
        >
          {myIpLoading
            ? <span className="w-3.5 h-3.5 border-2 border-zinc-500/30 border-t-zinc-300 rounded-full animate-spin"/>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
          }
          My IP
        </button>
        <button
          onClick={() => handleSearch()}
          disabled={loading || !ip.trim()}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: loading ? "rgba(245,158,11,.2)" : "#f59e0b",
            color: loading ? "#f59e0b" : "#000",
            border: loading ? "1px solid rgba(245,158,11,.4)" : "none",
            boxShadow: loading ? "none" : "0 0 20px rgba(245,158,11,.35)",
          }}
        >
          {loading
            ? <><span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/><span className="text-xs">Acquiring…</span></>
            : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Lock On</>
          }
        </button>
      </div>

      {/* ── Acquiring animation ────────────────────────────────────────────── */}
      {phase === "acquiring" && (
        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center gap-3">
          <div className="flex gap-1">
            {[0,1,2,3].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: `${i * 0.12}s` }}/>
            ))}
          </div>
          <span className="text-xs font-bold text-amber-400 tracking-widest uppercase">
            Querying 4 geolocation sources · analysing GPS history · computing triangulation…
          </span>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* ── Best estimate banner ───────────────────────────────────────────── */}
      {be && tier && (
        <div className="p-4 rounded-2xl" style={{ background: tier.bg, border: `1px solid ${tier.border}` }}>
          <div className="flex items-center gap-4 flex-wrap">
            <ConfidenceGauge pct={be.confidencePct} tier={be.tier} accuracyM={be.accuracyM} />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">Best estimate · {be.source === "gps" ? "GPS" : "IP Triangulation"}</div>
              <div className="font-mono text-sm font-bold" style={{ color: tier.color }}>
                {be.lat.toFixed(7)}, {be.lon.toFixed(7)}
              </div>
              <div className="text-xs text-zinc-400">{be.method}</div>
              {be.contactName && <div className="text-xs text-zinc-500">Contact: {be.contactName} · {be.contactPhone}</div>}
            </div>
            <a
              href={`https://www.google.com/maps?q=${be.lat},${be.lon}`}
              target="_blank" rel="noreferrer"
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: `${tier.color}20`, border: `1px solid ${tier.color}40`, color: tier.color }}
            >
              Open in Maps ↗
            </a>
          </div>
        </div>
      )}

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <div
        ref={mapRef}
        className="w-full rounded-2xl overflow-hidden"
        style={{
          height: 500,
          border: `1px solid ${tier ? tier.border : "rgba(63,63,70,.5)"}`,
          boxShadow: tier ? `0 0 30px ${tier.glow}` : undefined,
        }}
      />

      {/* Map legend */}
      {result && (result.contacts.some(c => c.hasGpsfix) || hasConsensus || result.lanEntry) && (
        <div className="flex flex-wrap gap-3 text-[10px] text-zinc-500 font-mono px-1">
          <span><span style={{ color: "#00ff88" }}>◉</span> GPS fix (precise)</span>
          <span><span className="opacity-40">●</span> History trail dot</span>
          <span><span style={{ color: "#f59e0b" }}>◎</span> Reticle = best estimate</span>
          {hasConsensus && <span><span style={{ color: "#38bdf8" }}>①</span> IP source pin</span>}
          {hasConsensus && <span>Dashed ring = IP uncertainty radius</span>}
          {result.lanEntry && <span><span style={{ color: "#a78bfa" }}>🏠</span> LAN device (registered)</span>}
        </div>
      )}

      {/* ── Results grid ───────────────────────────────────────────────────── */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* IP Intelligence panel */}
          <div className="p-4 bg-zinc-900/80 border border-zinc-700 rounded-2xl space-y-3">
            {hasConsensus ? (
              <>
                {/* Carrier gateway warning */}
                {(ipIntel as IpIntel).flags.mobile && (
                  <div className="p-3 rounded-xl bg-orange-500/8 border border-orange-500/25 flex gap-2 items-start">
                    <span className="text-base shrink-0">📶</span>
                    <div>
                      <div className="text-[11px] font-bold text-orange-400 mb-0.5">Mobile Carrier Gateway</div>
                      <div className="text-[10px] text-orange-300/70 leading-relaxed">
                        All mobile IPs on this carrier route through the same central gateway — the pin shows the carrier's infrastructure location, not the physical device. This is a network-level limitation, not a bug.
                      </div>
                    </div>
                  </div>
                )}
                <SourceTable intel={ipIntel as IpIntel} searchedIp={result.searchedIp} />
              </>
            ) : result.lanEntry ? (
              <div className="space-y-2">
                <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">LAN Device</div>
                <div className="p-3 rounded-xl bg-violet-500/8 border border-violet-500/25">
                  <div className="font-bold text-sm text-violet-300">🏠 {result.lanEntry.label}</div>
                  <div className="font-mono text-xs text-violet-400 mt-0.5">{result.lanEntry.ip}</div>
                  {result.lanEntry.address && <div className="text-xs text-zinc-400 mt-1">{result.lanEntry.address}</div>}
                  {result.lanEntry.latitude != null && (
                    <div className="font-mono text-[10px] text-zinc-500 mt-1">
                      {result.lanEntry.latitude.toFixed(6)}, {result.lanEntry.longitude?.toFixed(6)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-400 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {(ipIntel as { note: string }).note}
              </div>
            )}
          </div>

          {/* Contact matches panel */}
          <div className="space-y-3">
            {result.contacts.length === 0 ? (
              <div className="p-5 bg-zinc-900 border border-zinc-700 rounded-2xl text-center space-y-2">
                <div className="text-zinc-600 text-2xl">🔍</div>
                <p className="text-sm text-zinc-400">No contacts matched this IP.</p>
                <p className="text-xs text-zinc-600">IP was geolocated and shown on the map.</p>
              </div>
            ) : (
              result.contacts.map((c) => {
                const pinColor = c.source === "gps" ? "#00ff88" : c.source === "fused" ? "#10b981" : "#60a5fa";
                const lastSeen = c.lastUpdate ? formatDistanceToNow(new Date(c.lastUpdate), { addSuffix: true }) : null;
                const openedAgo = c.openedAt ? formatDistanceToNow(new Date(c.openedAt), { addSuffix: true }) : null;
                const mv = c.movementVector;
                const totalFixes = c.locationHistory.length;
                const gpsFixes = c.locationHistory.filter(h => h.source === "gps" || h.source === "fused").length;
                const qualityPct = totalFixes > 0 ? Math.round(gpsFixes / totalFixes * 100) : 0;

                // Staleness badge
                const ageMs = c.lastUpdate ? Date.now() - new Date(c.lastUpdate).getTime() : null;
                const stalenessColor = ageMs == null ? "#71717a"
                  : ageMs < 10 * 60_000 ? "#22c55e"
                  : ageMs < 60 * 60_000 ? "#f59e0b"
                  : "#ef4444";
                const stalenessBg = ageMs == null ? "rgba(113,113,122,.1)"
                  : ageMs < 10 * 60_000 ? "rgba(34,197,94,.1)"
                  : ageMs < 60 * 60_000 ? "rgba(245,158,11,.1)"
                  : "rgba(239,68,68,.1)";

                return (
                  <div key={c.inviteId} className="p-4 bg-zinc-900 border border-zinc-700 rounded-2xl space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                        style={{ background: `${pinColor}18`, border: `1.5px solid ${pinColor}40`, color: pinColor }}>
                        {initials(c.toName, c.toPhone)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-zinc-100 truncate">{c.toName || c.toPhone}</div>
                        {c.toName && <div className="text-xs text-zinc-500 font-mono">{c.toPhone}</div>}
                        {/* Staleness badge */}
                        {lastSeen && (
                          <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: stalenessBg, color: stalenessColor, border: `1px solid ${stalenessColor}30` }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: stalenessColor, display: "inline-block" }}/>
                            {lastSeen}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          c.status === "accepted" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        }`}>{c.status.toUpperCase()}</span>
                        {c.hasGpsfix
                          ? <span className="text-[10px] font-bold" style={{ color: pinColor }}>🛰 GPS {c.source?.toUpperCase()}</span>
                          : <span className="text-[10px] text-amber-400">🌐 IP ONLY</span>
                        }
                      </div>
                    </div>

                    {/* Coordinates */}
                    {c.latitude != null && c.longitude != null && (
                      <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 font-mono">
                        <div className="text-xs font-bold" style={{ color: pinColor }}>
                          {c.latitude.toFixed(7)}, {c.longitude.toFixed(7)}
                        </div>
                        {c.address && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{c.address}</div>}
                        <div className="flex gap-3 mt-1 text-[10px] text-zinc-600">
                          {c.accuracy != null && <span>±{Math.round(c.accuracy)}m</span>}
                          {lastSeen && <span>🕒 {lastSeen}</span>}
                          {c.batteryLevel != null && <span>{c.batteryCharging ? "⚡" : "🔋"}{c.batteryLevel}%</span>}
                        </div>
                      </div>
                    )}

                    {/* Movement vector */}
                    {mv && (
                      <div className="p-2.5 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                        <div className="text-[10px] text-amber-400/60 uppercase tracking-widest font-bold mb-1">Movement Vector</div>
                        <div className="flex gap-4 text-xs font-mono">
                          <span className="text-amber-300">⬆ {mv.bearingDeg.toFixed(1)}°</span>
                          <span className="text-zinc-300">{mv.speedKmh} km/h</span>
                          <span className="text-zinc-400">{mv.distanceM}m displaced</span>
                          <span className="text-zinc-600">{mv.ageSecs < 60 ? `${mv.ageSecs}s ago` : `${Math.round(mv.ageSecs/60)}m ago`}</span>
                        </div>
                      </div>
                    )}

                    {/* Fix stats */}
                    <div className="flex gap-3 text-[10px] font-mono text-zinc-500">
                      <span>{totalFixes} location fixes</span>
                      <span style={{ color: pinColor }}>{gpsFixes} GPS-quality</span>
                      {totalFixes > 0 && <span>{qualityPct}% precision</span>}
                    </div>

                    {/* IP match */}
                    <div className="border-t border-zinc-800 pt-2.5 text-[10px] space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        {c.openedIp && (
                          <span className="font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400">
                            OPEN: {c.openedIp}
                          </span>
                        )}
                        {c.grantedIp && c.grantedIp !== c.openedIp && (
                          <span className="font-mono px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-300">
                            GRANT: {c.grantedIp}
                          </span>
                        )}
                        {c.grantedIp && c.grantedIp === c.openedIp && (
                          <span className="text-zinc-600">Same IP at open &amp; grant</span>
                        )}
                      </div>
                      {openedAgo && <div className="text-zinc-600">🔗 Link opened {openedAgo}</div>}
                    </div>

                    {/* Location history mini-timeline */}
                    {totalFixes > 1 && (
                      <details className="text-[10px]">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 font-mono select-none">
                          ▸ History ({totalFixes} fixes)
                        </summary>
                        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                          {c.locationHistory.slice(0, 30).map((h, i) => (
                            <div key={i} className="flex gap-2 items-center font-mono text-zinc-600">
                              <span className="shrink-0" style={{ color: h.source === "gps" || h.source === "fused" ? pinColor : "#71717a" }}>●</span>
                              <span className="text-zinc-400">{h.lat.toFixed(5)}, {h.lng.toFixed(5)}</span>
                              {h.accuracy != null && <span>±{Math.round(h.accuracy)}m</span>}
                              <span className="text-zinc-700 shrink-0">{format(new Date(h.ts), "MM/dd HH:mm")}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── LAN IP Registry manager ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-700 overflow-hidden">
        <button
          onClick={() => setLanOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900 hover:bg-zinc-800/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">🏠</span>
            <span className="text-sm font-bold text-zinc-200">LAN / Local IP Registry</span>
            {lanIps.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-400">
                {lanIps.length} saved
              </span>
            )}
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-zinc-500 transition-transform ${lanOpen ? "rotate-180" : ""}`}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {lanOpen && (
          <div className="p-4 bg-zinc-950 space-y-4">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Register private / local network IPs (e.g. 192.168.x.x, 10.x.x.x) with a label and optional coordinates. Once saved, searching that IP will show the device on the map.
            </p>

            {/* Saved entries */}
            {lanIps.length > 0 && (
              <div className="space-y-2">
                {lanIps.map(e => (
                  <div key={e.id} className="flex items-center gap-3 p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-violet-300">{e.label}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{e.ip}</span>
                      </div>
                      {e.address && <div className="text-[10px] text-zinc-600 truncate">{e.address}</div>}
                      {e.latitude != null && (
                        <div className="font-mono text-[10px] text-zinc-700">{e.latitude.toFixed(5)}, {e.longitude?.toFixed(5)}</div>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => { setIp(e.ip); handleSearch(e.ip); }}
                        className="px-2 py-1 text-[10px] font-bold rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-colors"
                      >
                        Locate
                      </button>
                      <button
                        onClick={() => handleDeleteLan(e.id)}
                        className="px-2 py-1 text-[10px] font-bold rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Add New Device</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={lanForm.ip} onChange={e => setLanForm(f => ({ ...f, ip: e.target.value }))}
                  placeholder="192.168.1.5"
                  className="col-span-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-green-300 placeholder:text-zinc-600 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
                <input
                  value={lanForm.label} onChange={e => setLanForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Label (e.g. Home Router)"
                  className="col-span-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
              </div>
              <input
                value={lanForm.address} onChange={e => setLanForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Address / description (optional)"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={lanForm.lat} onChange={e => setLanForm(f => ({ ...f, lat: e.target.value }))}
                  placeholder="Latitude (optional)"
                  className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-300 placeholder:text-zinc-600 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
                <input
                  value={lanForm.lon} onChange={e => setLanForm(f => ({ ...f, lon: e.target.value }))}
                  placeholder="Longitude (optional)"
                  className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-300 placeholder:text-zinc-600 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
              </div>
              {lanError && <p className="text-[10px] text-red-400">{lanError}</p>}
              <button
                onClick={handleAddLan}
                disabled={lanSaving || !lanForm.ip.trim() || !lanForm.label.trim()}
                className="w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-40 bg-violet-600 hover:bg-violet-500 text-white"
              >
                {lanSaving ? "Saving…" : "+ Save Device"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!result && !loading && (
        <div className="p-10 bg-zinc-950 border border-zinc-800 border-dashed rounded-2xl text-center space-y-3">
          <div className="text-5xl opacity-20">◎</div>
          <p className="text-sm text-zinc-500 font-mono">AWAITING TARGET IP</p>
          <p className="text-xs text-zinc-700 max-w-sm mx-auto leading-relaxed">
            Queries 4 independent geolocation sources simultaneously, cross-references GPS history,
            computes a triangulated consensus with confidence score.
          </p>
        </div>
      )}

      {/* CSS for pulsing pin */}
      <style>{`
        @keyframes pl-pulse {
          0%   { transform: scale(1); opacity: 0.6; }
          70%  { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
