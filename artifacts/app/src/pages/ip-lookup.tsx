import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, Wifi, MapPin, User, Clock, Shield, AlertTriangle, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ActivityType = "stationary" | "walking" | "running" | "driving";
const ACTIVITY_INFO: Record<ActivityType, { icon: string; label: string }> = {
  stationary: { icon: "⏸️", label: "Stationary" },
  walking:    { icon: "🚶", label: "Walking" },
  running:    { icon: "🏃", label: "Running" },
  driving:    { icon: "🚗", label: "Driving" },
};

interface Contact {
  inviteId: number;
  token: string;
  toName: string | null;
  toPhone: string;
  status: string;
  grantedAt: string | null;
  openedAt: string | null;
  openedIp: string | null;
  grantedIp: string | null;
  ipInfo: Record<string, unknown> | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  lastUpdate: string | null;
  accuracy: number | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  activityType: ActivityType | null;
  source: string | null;
  hasGpsfix: boolean;
  matchedOn: string[];
}

interface IpGeo {
  lat?: number;
  lon?: number;
  city?: string;
  regionName?: string;
  country?: string;
  isp?: string;
  org?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  query?: string;
  note?: string;
}

interface LookupResult {
  contacts: Contact[];
  ipGeo: IpGeo | null;
  searchedIp: string;
}

function initials(name: string | null | undefined, phone?: string | null) {
  if (name) return name.split(" ").map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-2) : "?";
}

function makePin(color: string, label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:38px;height:50px;filter:drop-shadow(0 4px 12px ${color}88);">
      <div style="width:38px;height:38px;background:${color};clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;letter-spacing:-0.5px;">${label}</div>
      <div style="width:4px;height:12px;background:${color};margin:0 auto;border-radius:0 0 2px 2px;"></div>
    </div>`,
    iconSize: [38, 50],
    iconAnchor: [19, 50],
    popupAnchor: [0, -52],
  });
}

function makeIpPin() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:38px;height:50px;filter:drop-shadow(0 4px 12px #f59e0b88);">
      <div style="width:38px;height:38px;background:#f59e0b;clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);display:flex;align-items:center;justify-content:center;font-size:18px;">🌐</div>
      <div style="width:4px;height:12px;background:#f59e0b;margin:0 auto;border-radius:0 0 2px 2px;"></div>
    </div>`,
    iconSize: [38, 50],
    iconAnchor: [19, 50],
    popupAnchor: [0, -52],
  });
}

export default function IpLookupPage() {
  const { userId } = useAuth();
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Init Leaflet map once
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
    });
    L.tileLayer("https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      subdomains: ["0", "1", "2", "3"],
      attribution: "Google Maps",
      maxZoom: 20,
    }).addTo(map);
    mapInst.current = map;
    return () => {
      map.remove();
      mapInst.current = null;
    };
  }, []);

  // Re-render pins whenever result changes
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;

    // Clear old layers
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /**/ } });
    layersRef.current = [];

    if (!result) return;

    const points: [number, number][] = [];

    // Pin for each matched contact (GPS fix)
    result.contacts.forEach((c, idx) => {
      if (c.latitude != null && c.longitude != null) {
        const color = c.status === "accepted" ? "#10b981" : "#6366f1";
        const label = initials(c.toName, c.toPhone);
        const marker = L.marker([c.latitude, c.longitude], { icon: makePin(color, label) });
        const name = c.toName || c.toPhone;
        const lastSeen = c.lastUpdate ? formatDistanceToNow(new Date(c.lastUpdate), { addSuffix: true }) : "—";
        const actLabel = c.activityType ? `${ACTIVITY_INFO[c.activityType]?.icon} ${ACTIVITY_INFO[c.activityType]?.label}` : "";
        const bat = c.batteryLevel != null ? `${c.batteryCharging ? "⚡" : "🔋"} ${c.batteryLevel}%` : "";
        marker.bindPopup(`
          <div style="font-family:system-ui,sans-serif;color:#f4f4f5;min-width:200px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${esc(name)}</div>
            <div style="font-size:10px;color:#71717a;font-family:ui-monospace,monospace;margin-bottom:8px;">${esc(c.toPhone)}</div>
            <div style="font-size:10px;color:#a1a1aa;">📍 GPS fix · ${esc(c.source ?? "unknown")} source</div>
            ${c.address ? `<div style="font-size:10px;color:#71717a;margin-top:2px;">${esc(c.address.slice(0, 80))}</div>` : ""}
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">🕒 ${esc(lastSeen)}</div>
            ${actLabel ? `<div style="font-size:10px;margin-top:2px;">${esc(actLabel)}${bat ? ` · ${esc(bat)}` : ""}</div>` : ""}
            ${c.accuracy != null ? `<div style="font-size:10px;color:#a1a1aa;margin-top:2px;">🎯 ±${esc(Math.round(c.accuracy))}m accuracy</div>` : ""}
            <div style="font-size:10px;color:#f59e0b;margin-top:4px;">Matched on: ${esc(c.matchedOn.join(", "))}</div>
          </div>
        `);
        marker.addTo(map);
        layersRef.current.push(marker);
        points.push([c.latitude, c.longitude]);
      }
    });

    // Pin for IP geolocation (even if no GPS fix exists)
    const geo = result.ipGeo;
    if (geo && geo.lat != null && geo.lon != null && !geo.note) {
      const ipMarker = L.marker([geo.lat, geo.lon], { icon: makeIpPin() });
      const locStr = [geo.city, geo.regionName, geo.country].filter(Boolean).join(", ");
      ipMarker.bindPopup(`
        <div style="font-family:system-ui,sans-serif;color:#f4f4f5;min-width:180px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">🌐 IP Geolocation</div>
          <div style="font-size:10px;font-family:ui-monospace,monospace;color:#fcd34d;">${esc(result.searchedIp)}</div>
          ${locStr ? `<div style="font-size:10px;color:#a1a1aa;margin-top:4px;">📍 ${esc(locStr)}</div>` : ""}
          ${geo.isp ? `<div style="font-size:10px;color:#a1a1aa;margin-top:2px;">🏢 ${esc(geo.isp)}</div>` : ""}
          ${geo.mobile ? `<div style="font-size:10px;color:#60a5fa;margin-top:2px;">📶 Mobile network</div>` : ""}
          ${geo.proxy ? `<div style="font-size:10px;color:#f87171;margin-top:2px;">🔀 Proxy / VPN detected</div>` : ""}
          ${geo.hosting ? `<div style="font-size:10px;color:#f87171;margin-top:2px;">🖥 Datacenter / hosting</div>` : ""}
          <div style="font-size:9px;color:#52525b;margin-top:6px;">⚠ Approximate — not GPS</div>
        </div>
      `);
      ipMarker.addTo(map);
      layersRef.current.push(ipMarker);
      points.push([geo.lat, geo.lon]);
    }

    // Fit map to all points
    if (points.length === 1) {
      map.setView(points[0], 13);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 15 });
    } else {
      map.setView([20, 0], 2);
    }
  }, [result]);

  const handleSearch = async () => {
    if (!ip.trim() || !userId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/ip-lookup?ip=${encodeURIComponent(ip.trim())}&userId=${userId}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const data: LookupResult = await r.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const geo = result?.ipGeo;
  const geoLocStr = geo ? [geo.city, geo.regionName, geo.country].filter(Boolean).join(", ") : null;
  const hasGpsContacts = result?.contacts.some((c) => c.hasGpsfix);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-400">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Wifi className="w-5 h-5 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">IP Lookup</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-14">
          Find a contact by their IP address — shows their last known GPS location and network identity.
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Enter IP address, e.g. 41.58.73.12"
            className="w-full pl-9 pr-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/60 font-mono"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !ip.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm rounded-xl transition-all shadow-lg shadow-amber-500/20"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Map */}
      <div
        ref={mapRef}
        className="w-full rounded-2xl border border-zinc-700 overflow-hidden"
        style={{ height: 400 }}
      />

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* IP geo summary */}
          {geo && (
            <div className="p-4 bg-amber-500/6 border border-amber-500/20 rounded-2xl space-y-3">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">IP Intelligence</span>
                <span className="ml-auto font-mono text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">{result.searchedIp}</span>
              </div>
              {geo.note ? (
                <p className="text-xs text-zinc-400 flex items-center gap-1.5"><Info className="w-3 h-3" />{geo.note}</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  {geoLocStr && <div className="col-span-2"><span className="text-zinc-500">Location</span> <span className="text-zinc-200">{geoLocStr}</span></div>}
                  {geo.isp && <div><span className="text-zinc-500">ISP</span> <span className="text-zinc-200">{geo.isp}</span></div>}
                  {geo.org && geo.org !== geo.isp && <div><span className="text-zinc-500">Org</span> <span className="text-zinc-200">{geo.org}</span></div>}
                  <div className="col-span-2 flex gap-3 mt-1">
                    {geo.mobile && <span className="text-blue-400 flex items-center gap-1"><span>📶</span> Mobile network</span>}
                    {geo.proxy && <span className="text-red-400 flex items-center gap-1"><span>🔀</span> Proxy/VPN</span>}
                    {geo.hosting && <span className="text-red-400 flex items-center gap-1"><span>🖥</span> Datacenter</span>}
                    {!geo.mobile && !geo.proxy && !geo.hosting && <span className="text-zinc-500">No anomaly flags</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Contact matches */}
          {result.contacts.length === 0 ? (
            <div className="p-6 bg-zinc-900 border border-zinc-700 rounded-2xl text-center space-y-2">
              <Shield className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm text-zinc-400">No contacts matched this IP address.</p>
              <p className="text-xs text-zinc-600">
                {geo && !geo.note ? "The IP was geolocated and shown on the map, but it doesn't match any invite." : "Try a different address."}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">
                  {result.contacts.length} contact{result.contacts.length !== 1 ? "s" : ""} matched
                </span>
                {hasGpsContacts && <span className="text-xs text-zinc-500 ml-auto">Green pin = GPS fix · Yellow pin = IP only</span>}
              </div>
              <div className="space-y-3">
                {result.contacts.map((c) => {
                  const name = c.toName || c.toPhone;
                  const lastSeen = c.lastUpdate ? formatDistanceToNow(new Date(c.lastUpdate), { addSuffix: true }) : null;
                  const openedAgo = c.openedAt ? formatDistanceToNow(new Date(c.openedAt), { addSuffix: true }) : null;
                  const act = c.activityType ? ACTIVITY_INFO[c.activityType] : null;
                  const ipMatchIsp = (c.ipInfo as Record<string, unknown> | null)?.isp as string | undefined;
                  const ipMatchCity = (c.ipInfo as Record<string, unknown> | null)?.city as string | undefined;
                  const ipMatchCountry = (c.ipInfo as Record<string, unknown> | null)?.country as string | undefined;

                  return (
                    <div
                      key={c.inviteId}
                      className="p-4 bg-zinc-900 border border-zinc-700 rounded-2xl space-y-3"
                    >
                      {/* Contact header */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-sm text-emerald-400">
                          {initials(c.toName, c.toPhone)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-zinc-100 truncate">{name}</div>
                          {c.toName && <div className="text-xs text-zinc-500 font-mono">{c.toPhone}</div>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                            c.status === "accepted"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : c.status === "pending"
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                              : "bg-zinc-700 border-zinc-600 text-zinc-400"
                          }`}>
                            {c.status}
                          </span>
                          {c.hasGpsfix
                            ? <span className="text-xs text-emerald-500 flex items-center gap-1"><MapPin className="w-3 h-3" />GPS fix</span>
                            : <span className="text-xs text-amber-500 flex items-center gap-1"><Wifi className="w-3 h-3" />IP only</span>
                          }
                        </div>
                      </div>

                      {/* Location info */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-zinc-800 pt-3">
                        {c.latitude != null && c.longitude != null && (
                          <div className="col-span-2">
                            <span className="text-zinc-500">Coordinates</span>{" "}
                            <span className="text-zinc-200 font-mono">{c.latitude.toFixed(6)}, {c.longitude.toFixed(6)}</span>
                          </div>
                        )}
                        {c.address && (
                          <div className="col-span-2">
                            <span className="text-zinc-500">Address</span>{" "}
                            <span className="text-zinc-300">{c.address.slice(0, 90)}</span>
                          </div>
                        )}
                        {lastSeen && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-zinc-600" />
                            <span className="text-zinc-500">Last seen</span>{" "}
                            <span className="text-zinc-300">{lastSeen}</span>
                          </div>
                        )}
                        {c.source && (
                          <div><span className="text-zinc-500">GPS source</span> <span className="text-zinc-300">{c.source}</span></div>
                        )}
                        {c.accuracy != null && (
                          <div><span className="text-zinc-500">Accuracy</span> <span className="text-zinc-300">±{Math.round(c.accuracy)}m</span></div>
                        )}
                        {act && (
                          <div>{act.icon} <span className="text-zinc-300">{act.label}</span>
                            {c.batteryLevel != null && <span className="text-zinc-500"> · {c.batteryCharging ? "⚡" : "🔋"} {c.batteryLevel}%</span>}
                          </div>
                        )}
                      </div>

                      {/* IP match details */}
                      <div className="border-t border-zinc-800 pt-3 text-xs space-y-1">
                        <div className="text-zinc-500 font-semibold uppercase tracking-wider text-[10px] mb-1.5">IP Match Details</div>
                        <div className="flex flex-wrap gap-2">
                          {c.openedIp && (
                            <span className="font-mono px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                              Open: {c.openedIp}
                            </span>
                          )}
                          {c.grantedIp && c.grantedIp !== c.openedIp && (
                            <span className="font-mono px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-300">
                              Grant: {c.grantedIp}
                            </span>
                          )}
                          {c.grantedIp && c.grantedIp === c.openedIp && (
                            <span className="text-zinc-500 text-[10px]">Same IP at open &amp; grant</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1 text-zinc-400">
                          {openedAgo && <span>🔗 Link opened {openedAgo}</span>}
                          {ipMatchIsp && <span>🏢 {ipMatchIsp}{ipMatchCity ? ` · ${ipMatchCity}` : ""}{ipMatchCountry ? `, ${ipMatchCountry}` : ""}</span>}
                        </div>
                        {c.matchedOn.length > 0 && (
                          <div className="text-amber-500/70 text-[10px] mt-1">
                            Matched on: {c.matchedOn.join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="p-8 bg-zinc-900/50 border border-zinc-800 border-dashed rounded-2xl text-center space-y-2">
          <Wifi className="w-10 h-10 text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-400">Enter an IP address above and click Search.</p>
          <p className="text-xs text-zinc-600 max-w-sm mx-auto">
            Works with any IP captured when a contact opened or granted your invite link — online or offline.
          </p>
        </div>
      )}
    </div>
  );
}
