import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, MapPin, RefreshCw, Radio, Users, Battery, BatteryCharging, ChevronDown, ChevronUp, Smartphone, Wifi, Cpu, FlaskConical, Settings2, Fingerprint, ShieldCheck, Gauge, Compass, Phone, Navigation, MountainSnow, Signal, Globe, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ActivityType = "stationary" | "walking" | "running" | "driving";

const ACTIVITY_INFO: Record<ActivityType, { icon: string; label: string; color: string }> = {
  stationary: { icon: "⏸️", label: "Stationary", color: "#94a3b8" },
  walking: { icon: "🚶", label: "Walking", color: "#60a5fa" },
  running: { icon: "🏃", label: "Running", color: "#fb923c" },
  driving: { icon: "🚗", label: "Driving", color: "#34d399" },
};

interface Session {
  inviteId: number;
  token: string;
  toName: string | null;
  toPhone: string;
  consentType: string | null;
  grantedAt: string | null;
  consentPageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  status: "active" | "offline";
  lastUpdate: string | null;
  googleMapsLiveLink: string | null;
  // GPS fix quality — owner-only
  accuracy: number | null;
  source: "gps" | "network" | "fused" | null;
  // Device telemetry — only ever returned by this owner-scoped /api/sessions
  // endpoint (never by any token-based/public route), so only the account
  // owner viewing this page can see a contact's battery and activity.
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  activityType: ActivityType | null;
  deviceInfo: Record<string, any> | null;
  // IP intelligence — captured when the contact opens the consent page
  openedIp: string | null;
  openedAt: string | null;
  openedUserAgent: string | null;
  ipInfo: Record<string, any> | null;
  grantedIp: string | null;
}

async function fetchSessions(userId: number): Promise<Session[]> {
  const r = await fetch(`${API_BASE}/api/sessions?userId=${userId}`);
  if (!r.ok) throw new Error("Failed to load sessions");
  return r.json();
}

function copyToClipboard(text: string, label: string, onDone: (msg: string) => void) {
  const doWrite = () => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  };
  doWrite().then(() => onDone(`${label} copied to clipboard`)).catch(() => {});
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

function humanizeKey(key: string): string {
  const LABELS: Record<string, string> = {
    name: "Device Name", brand: "Brand", model: "Model", modelId: "Model ID",
    manufacturer: "Manufacturer", type: "Device Type", osVersion: "Android Version",
    osBuildId: "Build ID", platform: "Platform", platformVersion: "OS Version",
    architecture: "Architecture", bitness: "Bitness", mobile: "Mobile Device",
    userAgent: "User Agent",
    connected: "Connected", ipAddress: "IP Address", publicIp: "Public IP",
    carrier: "Carrier", mobileCountryCode: "MCC", mobileNetworkCode: "MNC",
    effectiveType: "Effective Type", downlinkMbps: "Downlink (Mbps)",
    downlinkMaxMbps: "Max Downlink (Mbps)", rttMs: "RTT (ms)",
    measuredRttMs: "Measured RTT (ms)", saveData: "Save-Data Mode", onLine: "Online",
    localIPs: "LAN IPs",
    screenWidth: "Screen Width (px)", screenHeight: "Screen Height (px)",
    availWidth: "Avail Width (px)", availHeight: "Avail Height (px)",
    orientation: "Orientation", pixelRatio: "Pixel Ratio",
    totalMemory: "RAM", totalStorage: "Total Storage", freeStorage: "Free Storage",
    cpuCores: "CPU Cores", deviceMemoryGb: "Device RAM (GB)",
    maxTouchPoints: "Max Touch Points", touchSupport: "Touch Support",
    storageQuotaGb: "Storage Quota", storageUsedGb: "Storage Used",
    gpuVendor: "GPU Vendor", gpuRenderer: "GPU Renderer",
    cameras: "Cameras", microphones: "Microphones", speakers: "Speakers",
    level: "Battery Level", charging: "Charging",
    chargingTimeSecs: "Time to Full (s)", dischargingTimeSecs: "Time to Empty (s)",
    language: "Language", languages: "All Languages", timezone: "Timezone",
    locale: "Locale", calendar: "Calendar", cookiesEnabled: "Cookies",
    doNotTrack: "Do Not Track", pdfViewerEnabled: "PDF Viewer",
    webdriver: "Bot/Webdriver", vendor: "Browser Vendor", appVersion: "App Version",
    plugins: "Plugins",
    accelerometer: "Accelerometer", gyroscope: "Gyroscope",
    barometer: "Barometer", magnetometer: "Magnetometer",
    deviceMotion: "Motion Events", deviceOrientation: "Orientation Events",
    geolocation: "Geolocation", battery: "Battery API", bluetooth: "Bluetooth",
    usb: "USB", nfc: "NFC", vibration: "Vibration", wakeLock: "Wake Lock",
    share: "Web Share", clipboard: "Clipboard", notification: "Notifications",
    canvasFingerprint: "Canvas ID", audioFingerprint: "Audio ID",
    geolocation_perm: "Geolocation", notifications_perm: "Notifications",
    camera_perm: "Camera", microphone_perm: "Microphone",
    clipboard_read_perm: "Clipboard Read",
    dnsMs: "DNS Lookup (ms)", tcpMs: "TCP Handshake (ms)", ttfbMs: "TTFB (ms)",
    domLoadMs: "DOM Load (ms)", pageLoadMs: "Page Load (ms)",
    transferKb: "Transfer (KB)", protocol: "Protocol",
    accelX: "Accel X (m/s²)", accelY: "Accel Y (m/s²)", accelZ: "Accel Z (m/s²)",
    rotAlpha: "Rotation α (°/s)", rotBeta: "Rotation β (°/s)", rotGamma: "Rotation γ (°/s)",
    intervalMs: "Sample Rate (ms)",
  };
  return LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

const SECTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  device:      { label: "Device",        icon: <Smartphone  className="h-3.5 w-3.5" /> },
  network:     { label: "Network",       icon: <Wifi        className="h-3.5 w-3.5" /> },
  hardware:    { label: "Hardware",      icon: <Cpu         className="h-3.5 w-3.5" /> },
  battery:     { label: "Battery",       icon: <Battery     className="h-3.5 w-3.5" /> },
  sensors:     { label: "Sensors",       icon: <FlaskConical className="h-3.5 w-3.5" /> },
  software:    { label: "Software",      icon: <Settings2   className="h-3.5 w-3.5" /> },
  identity:    { label: "Fingerprints",  icon: <Fingerprint className="h-3.5 w-3.5" /> },
  permissions: { label: "Permissions",   icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  timing:      { label: "Performance",   icon: <Gauge       className="h-3.5 w-3.5" /> },
  motion:      { label: "Motion",        icon: <Compass     className="h-3.5 w-3.5" /> },
  contacts:    { label: "Contacts",      icon: <Users       className="h-3.5 w-3.5" /> },
};

// Ordered section keys — known sections first, unknown extras appended
const SECTION_ORDER = ["device", "network", "hardware", "battery", "sensors", "software", "identity", "permissions", "timing", "motion", "contacts"];

function IpIntelPanel({ session }: { session: Session }) {
  const { openedIp, openedAt, openedUserAgent, ipInfo, grantedIp } = session;
  if (!openedIp && !ipInfo) return null;

  const geo = ipInfo as Record<string, any> | null;
  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [];

  if (openedIp) rows.push({ label: "IP Address", value: openedIp, highlight: true });
  if (grantedIp && grantedIp !== openedIp) rows.push({ label: "IP at Grant", value: grantedIp });
  if (geo?.country) rows.push({ label: "Country", value: `${geo.country} (${geo.countryCode ?? ""})` });
  if (geo?.regionName) rows.push({ label: "Region", value: `${geo.regionName}${geo.city ? ` — ${geo.city}` : ""}${geo.zip ? ` ${geo.zip}` : ""}` });
  if (geo?.timezone) rows.push({ label: "Timezone", value: geo.timezone });
  if (geo?.isp) rows.push({ label: "ISP", value: geo.isp });
  if (geo?.org) rows.push({ label: "Organisation", value: geo.org });
  if (geo?.as) rows.push({ label: "ASN", value: geo.as });
  if (geo?.lat != null && geo?.lon != null) rows.push({ label: "IP Location", value: `${Number(geo.lat).toFixed(4)}, ${Number(geo.lon).toFixed(4)}` });
  if (geo?.mobile != null) rows.push({ label: "Mobile Data", value: geo.mobile ? "Yes" : "No" });
  if (geo?.proxy != null) rows.push({ label: "Proxy / VPN", value: geo.proxy ? "⚠️ Yes" : "No" });
  if (geo?.hosting != null) rows.push({ label: "Hosting / DC", value: geo.hosting ? "⚠️ Yes" : "No" });
  if (openedAt) rows.push({ label: "First Opened", value: new Date(openedAt).toLocaleString() });
  if (openedUserAgent) rows.push({ label: "User-Agent", value: openedUserAgent });
  if (geo?.note) rows.push({ label: "Note", value: String(geo.note) });

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-amber-400/80 uppercase tracking-wider">
        <Globe className="h-3.5 w-3.5" />
        Network Intelligence
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 border-b border-border/30 py-1 text-xs">
            <span className="text-muted-foreground shrink-0">{r.label}</span>
            <span className={`font-mono text-right break-all ${r.highlight ? "text-amber-300 font-semibold" : "text-foreground"}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceInfoPanel({ deviceInfo }: { deviceInfo: Record<string, any> }) {
  // Split into structured sections vs. flat legacy keys
  const sections: Array<{ key: string; rows: Array<{ label: string; value: string }> }> = [];

  const orderedKeys = [
    ...SECTION_ORDER.filter((k) => k in deviceInfo),
    ...Object.keys(deviceInfo).filter((k) => !SECTION_ORDER.includes(k)),
  ];

  for (const sectionKey of orderedKeys) {
    const val = deviceInfo[sectionKey];
    if (val === null || val === undefined) continue;

    if (sectionKey === "contacts" && Array.isArray(val)) {
      // Each element is { name, phone, email } — render as one row per contact
      const rows = (val as Array<Record<string, unknown>>).flatMap((c, i) => {
        const label = `Contact ${i + 1}`;
        const parts = [c.name, c.phone, c.email].filter(Boolean);
        return parts.length
          ? [{ label, value: parts.join(" · ") }]
          : [];
      });
      if (rows.length) sections.push({ key: sectionKey, rows });
    } else if (typeof val === "object" && !Array.isArray(val)) {
      const rows = Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => ({ label: humanizeKey(k), value: fmtVal(v) }));
      if (rows.length) sections.push({ key: sectionKey, rows });
    } else {
      // Flat top-level key — treat as a one-row "misc" section
      sections.push({ key: sectionKey, rows: [{ label: humanizeKey(sectionKey), value: fmtVal(val) }] });
    }
  }

  if (!sections.length) return null;

  return (
    <div className="mt-3 space-y-3">
      {sections.map(({ key, rows }) => {
        const meta = SECTION_META[key];
        return (
          <div key={key}>
            <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {meta?.icon}
              {meta?.label ?? humanizeKey(key)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-3 border-b border-border/30 py-1 text-xs">
                  <span className="text-muted-foreground shrink-0">{r.label}</span>
                  <span className="font-mono text-foreground text-right break-all">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Sessions() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: sessions, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sessions", userId],
    queryFn: () => fetchSessions(userId!),
    enabled: !!userId,
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const notify = (msg: string) => toast({ title: msg });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Active Sessions</h1>
          <p className="text-muted-foreground mt-1">
            Every contact who has granted consent — copy their share link or a Google Maps live location link.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoRefresh ? "default" : "outline"}
            className="gap-2 text-xs"
            onClick={() => setAutoRefresh((v) => !v)}
            data-testid="button-toggle-autorefresh"
          >
            <Radio className={`h-3.5 w-3.5 ${autoRefresh ? "animate-pulse" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-sessions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={18} />
            {sessions?.length ?? 0} active session{sessions?.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>Consented contacts with a live or last-known position.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((s) => (
                <SessionRow
                  key={s.inviteId}
                  session={s}
                  onCopy={(t, l) => copyToClipboard(t, l, notify)}
                  expanded={expanded.has(s.inviteId)}
                  onToggleExpanded={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.inviteId)) next.delete(s.inviteId); else next.add(s.inviteId);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground flex flex-col items-center">
              <div className="bg-muted p-4 rounded-full mb-4">
                <Users size={32} className="opacity-50" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">No active sessions yet</h3>
              <p className="max-w-xs text-sm">
                Sessions appear here as soon as a contact grants consent to your invite.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  gps:     { label: "GPS",     color: "#34d399" },
  fused:   { label: "Fused",   color: "#60a5fa" },
  network: { label: "Network", color: "#f59e0b" },
};

function headingLabel(deg: number): string {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function SessionRow({
  session,
  onCopy,
  expanded,
  onToggleExpanded,
}: {
  session: Session;
  onCopy: (text: string, label: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const isOnline = session.status === "active";

  // Pull motion extras out of deviceInfo (stored at top level by the consent page)
  const di = session.deviceInfo as Record<string, any> | null;
  const speedMps: number | null = di?.speedMps ?? null;
  const headingDeg: number | null = di?.headingDeg ?? null;
  const altitudeMeters: number | null = di?.altitudeMeters ?? null;

  const speedKmh = speedMps !== null ? (speedMps * 3.6).toFixed(1) : null;
  const coordStr =
    session.latitude != null && session.longitude != null
      ? `${session.latitude.toFixed(6)}, ${session.longitude.toFixed(6)}`
      : null;

  const hasDeviceInfo = di && Object.keys(di).length > 0;
  const hasIpIntel = !!(session.openedIp || session.ipInfo);

  return (
    <div
      className="p-4 border border-border rounded-xl hover:bg-muted/20 transition-colors"
      data-testid={`row-session-${session.inviteId}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 w-full">
          {/* ── Identity row ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{session.toName || "Unknown"}</span>
            <span className="text-muted-foreground text-sm">{session.toPhone}</span>
            <Badge
              variant={isOnline ? "default" : "secondary"}
              className={`text-[10px] ${isOnline ? "bg-emerald-600 text-white" : ""}`}
            >
              {isOnline ? "Live" : "Offline"}
            </Badge>
            {session.consentType && (
              <span className="text-[10px] text-muted-foreground border border-border/50 rounded-full px-2 py-0.5">
                {session.consentType}
              </span>
            )}
          </div>

          {/* ── Timestamps ── */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1 items-center">
            {session.grantedAt && (
              <span>Granted {format(new Date(session.grantedAt), "MMM d, yyyy 'at' h:mm a")}</span>
            )}
            {session.lastUpdate && (
              <>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span>Last update {format(new Date(session.lastUpdate), "MMM d, h:mm a")}</span>
              </>
            )}
          </div>

          {/* ── Address ── */}
          {session.address && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="h-3 w-3 flex-shrink-0" /> {session.address}
            </p>
          )}

          {/* ── GPS coordinates + fix quality ── */}
          {coordStr && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="flex items-center gap-1 text-[11px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                onClick={() => onCopy(coordStr, "Coordinates")}
                title="Copy coordinates"
                data-testid={`button-copy-coords-${session.inviteId}`}
              >
                <Copy className="h-3 w-3" />
                {coordStr}
              </button>
              {session.accuracy !== null && (
                <span className="text-[11px] text-muted-foreground font-mono">
                  ±{session.accuracy! < 10 ? session.accuracy!.toFixed(1) : Math.round(session.accuracy!)}m
                </span>
              )}
              {session.source && SOURCE_LABEL[session.source] && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                  style={{
                    color: SOURCE_LABEL[session.source].color,
                    borderColor: `${SOURCE_LABEL[session.source].color}40`,
                    background: `${SOURCE_LABEL[session.source].color}12`,
                  }}
                >
                  <Signal className="inline h-2.5 w-2.5 mr-0.5" />
                  {SOURCE_LABEL[session.source].label}
                </span>
              )}
            </div>
          )}

          {/* ── Motion data: speed · heading · altitude ── */}
          {(speedKmh !== null || headingDeg !== null || altitudeMeters !== null) && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground font-mono">
              {speedKmh !== null && (
                <span className="flex items-center gap-1">
                  <Gauge className="h-3 w-3 text-violet-400" />
                  <span className="text-foreground font-semibold">{speedKmh}</span> km/h
                </span>
              )}
              {headingDeg !== null && (
                <span className="flex items-center gap-1">
                  <Navigation className="h-3 w-3 text-amber-400" style={{ transform: `rotate(${headingDeg}deg)` }} />
                  <span className="text-foreground font-semibold">{Math.round(headingDeg)}°</span>
                  <span className="text-muted-foreground">{headingLabel(headingDeg)}</span>
                </span>
              )}
              {altitudeMeters !== null && (
                <span className="flex items-center gap-1">
                  <MountainSnow className="h-3 w-3 text-emerald-400" />
                  <span className="text-foreground font-semibold">{Math.round(altitudeMeters)}</span> m
                </span>
              )}
            </div>
          )}

          {/* ── Telemetry badges: activity · battery · expand button ── */}
          {(session.activityType || session.batteryLevel !== null || hasDeviceInfo || hasIpIntel) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {session.activityType && (() => {
                const info = ACTIVITY_INFO[session.activityType!];
                return (
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                    style={{ color: info.color, borderColor: `${info.color}40`, background: `${info.color}12` }}
                    data-testid={`badge-activity-${session.inviteId}`}
                  >
                    {info.icon} {info.label}
                  </span>
                );
              })()}
              {session.batteryLevel !== null && (
                <span
                  className={`flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                    session.batteryLevel! < 20 ? "text-red-400 border-red-400/30 bg-red-400/10" : "text-muted-foreground border-border bg-muted/40"
                  }`}
                  data-testid={`badge-battery-${session.inviteId}`}
                >
                  {session.batteryCharging ? <BatteryCharging className="w-3 h-3" /> : <Battery className="w-3 h-3" />}
                  {session.batteryLevel}%
                </span>
              )}
              {hasIpIntel && (
                <span className="flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border text-amber-400 border-amber-400/30 bg-amber-400/10">
                  <Globe className="w-3 h-3" />
                  {session.openedIp ?? "IP captured"}
                </span>
              )}
              {(hasDeviceInfo || hasIpIntel) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] gap-1 px-2"
                  onClick={onToggleExpanded}
                  data-testid={`button-toggle-device-info-${session.inviteId}`}
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? "Hide details" : "More data"}
                </Button>
              )}
            </div>
          )}

          {expanded && (
            <>
              {hasIpIntel && <IpIntelPanel session={session} />}
              {session.deviceInfo && <DeviceInfoPanel deviceInfo={session.deviceInfo} />}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {session.consentPageUrl && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => onCopy(session.consentPageUrl!, "Share link")}
            data-testid={`button-copy-share-${session.inviteId}`}
          >
            <Copy className="h-3 w-3" /> Copy Share Link
          </Button>
        )}
        {session.googleMapsLiveLink && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => onCopy(session.googleMapsLiveLink!, "Google Maps live location link")}
              data-testid={`button-copy-maps-${session.inviteId}`}
            >
              <Copy className="h-3 w-3" /> Copy Google Maps Link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => window.open(session.googleMapsLiveLink!, "_blank")}
              data-testid={`button-open-maps-${session.inviteId}`}
            >
              <ExternalLink className="h-3 w-3" /> Open
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
