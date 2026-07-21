import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ShieldAlert, Camera, Siren, AlertTriangle, Archive,
  WifiOff, ChevronRight, Clock, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NotifType =
  | "geofence_enter" | "geofence_exit"
  | "location_offline" | "location_online"
  | "sos" | "grant" | "location_stale"
  | "location_type_report" | "admin_message";

interface NotifEntry {
  id: number;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
  pinned: boolean;
  createdAt: string;
  data: Record<string, unknown> | null;
}

interface GeoPhoto {
  id: number;
  takenAt: string;
  toName: string | null;
  toPhone: string;
}

interface GeoVideo {
  id: number;
  takenAt: string;
  toName: string | null;
  toPhone: string;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  sos:                  { label: "SOS Alert",        color: "bg-red-500/10 text-red-400 border-red-500/20",      icon: Siren },
  geofence_enter:       { label: "Zone Enter",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: AlertTriangle },
  geofence_exit:        { label: "Zone Exit",         color: "bg-amber-500/10 text-amber-400 border-amber-500/20",  icon: AlertTriangle },
  location_offline:     { label: "Went Offline",      color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",     icon: WifiOff },
  location_online:      { label: "Came Online",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20",     icon: Activity },
  location_stale:       { label: "Location Stale",    color: "bg-orange-500/10 text-orange-400 border-orange-500/20", icon: Clock },
  location_type_report: { label: "Location Report",   color: "bg-violet-500/10 text-violet-400 border-violet-500/20", icon: Activity },
  grant:                { label: "Grant",              color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20", icon: ShieldAlert },
};

export default function SecurityCenter() {
  const { userId } = useAuth();
  const [, navigate] = useLocation();

  const { data: notifs = [] } = useQuery<NotifEntry[]>({
    queryKey: ["security-notifs", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/notifications/${userId}?limit=100`)
        .then((r) => r.json()),
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const { data: photos = [] } = useQuery<GeoPhoto[]>({
    queryKey: ["geo-photos-meta", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`)
        .then((r) => r.json()),
    enabled: !!userId,
  });

  const { data: videos = [] } = useQuery<GeoVideo[]>({
    queryKey: ["geo-videos-meta", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/geo-videos/by-user/${userId}`)
        .then((r) => r.json()),
    enabled: !!userId,
  });

  const securityNotifs = notifs.filter((n) =>
    ["sos", "geofence_enter", "geofence_exit", "location_offline", "location_stale"].includes(n.type),
  );

  const sosCount       = notifs.filter((n) => n.type === "sos").length;
  const breachCount    = notifs.filter((n) => n.type === "geofence_enter" || n.type === "geofence_exit").length;
  const offlineCount   = notifs.filter((n) => n.type === "location_offline").length;
  const captureCount   = photos.length + videos.length;

  const stats = [
    {
      label: "Media Captures",
      value: captureCount,
      icon: Camera,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      href: "/geoboard",
    },
    {
      label: "SOS Alerts",
      value: sosCount,
      icon: Siren,
      color: sosCount > 0 ? "text-red-400" : "text-muted-foreground",
      bg: sosCount > 0 ? "bg-red-500/10" : "bg-muted/20",
      href: "/panic-log",
    },
    {
      label: "Zone Breaches",
      value: breachCount,
      icon: AlertTriangle,
      color: breachCount > 0 ? "text-amber-400" : "text-muted-foreground",
      bg: breachCount > 0 ? "bg-amber-500/10" : "bg-muted/20",
      href: "/surveillance",
    },
    {
      label: "Offline Events",
      value: offlineCount,
      icon: WifiOff,
      color: offlineCount > 0 ? "text-zinc-400" : "text-muted-foreground",
      bg: "bg-muted/20",
      href: "/sessions",
    },
  ];

  const quickActions = [
    { label: "GeoBoard", icon: Camera,       href: "/geoboard",       desc: "View captured media" },
    { label: "Surveillance", icon: Activity, href: "/surveillance",   desc: "Live tracking + CCTV" },
    { label: "Panic Log",   icon: Siren,     href: "/panic-log",      desc: "SOS alert history" },
    { label: "Evidence Vault", icon: Archive, href: "/evidence-vault", desc: "Download media files" },
  ];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-red-500/10">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Security Center</h1>
          <p className="text-sm text-muted-foreground">Unified view of all security activity</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <button
            key={s.label}
            onClick={() => navigate(s.href)}
            className="text-left rounded-xl border border-border p-4 hover:bg-secondary/40 transition-colors"
          >
            <div className={`inline-flex p-2 rounded-lg ${s.bg} mb-2`}>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Quick Access</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          {quickActions.map((a) => (
            <Button
              key={a.label}
              variant="outline"
              className="h-auto flex-col items-start gap-1 p-3 text-left"
              onClick={() => navigate(a.href)}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <a.icon className="w-3.5 h-3.5" />
                {a.label}
              </div>
              <span className="text-[10px] text-muted-foreground font-normal">{a.desc}</span>
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Recent security events timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            Recent Security Events
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => navigate("/panic-log")}
            >
              SOS only <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {securityNotifs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ShieldAlert className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No security events recorded yet</p>
              <p className="text-xs text-muted-foreground">Geofence breaches, SOS alerts, and offline events will appear here</p>
            </div>
          ) : (
            securityNotifs.slice(0, 25).map((n) => {
              const meta = TYPE_META[n.type] ?? TYPE_META["grant"];
              const Icon = meta.icon;
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 rounded-lg p-2.5 border ${meta.color} ${n.read ? "opacity-60" : ""}`}
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-tight truncate">{n.title}</p>
                    <p className="text-[11px] opacity-80 truncate">{n.body}</p>
                  </div>
                  <span className="text-[10px] opacity-60 shrink-0">{fmt(n.createdAt)}</span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Recent captures thumbnail strip */}
      {photos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              Recent GeoBoard Captures
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate("/geoboard")}>
                View all <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate("/geoboard")}
                  className="shrink-0 w-16 h-16 rounded-lg bg-muted/40 border border-border flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-secondary/40 transition-colors"
                >
                  <Camera className="w-5 h-5 text-violet-400" />
                  <span className="text-[9px] text-muted-foreground font-medium">
                    {p.toName?.split(" ")[0] ?? p.toPhone.slice(-4)}
                  </span>
                </div>
              ))}
              {photos.length > 8 && (
                <div
                  onClick={() => navigate("/geoboard")}
                  className="shrink-0 w-16 h-16 rounded-lg bg-muted/20 border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-secondary/40 transition-colors"
                >
                  <span className="text-xs text-muted-foreground font-bold">+{photos.length - 8}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
