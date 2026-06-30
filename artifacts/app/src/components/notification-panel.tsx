import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, BellOff, X, CheckCheck, MapPin, AlertTriangle, Clock, Shield, Wifi, WifiOff, Siren } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NotifEntry {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

function typeIcon(type: string) {
  switch (type) {
    case "geofence_enter": return <MapPin size={14} className="text-emerald-400" />;
    case "geofence_exit":  return <MapPin size={14} className="text-amber-400" />;
    case "location_offline": return <WifiOff size={14} className="text-red-400" />;
    case "location_online":  return <Wifi size={14} className="text-emerald-400" />;
    case "location_stale":   return <Clock size={14} className="text-amber-400" />;
    case "sos":              return <Siren size={14} className="text-red-500" />;
    case "grant":            return <Shield size={14} className="text-blue-400" />;
    default:                 return <Bell size={14} className="text-zinc-400" />;
  }
}

export function useNotificationCount(userId: number | null) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) { setCount(0); return; }

    const fetch_ = () =>
      fetch(`${API_BASE}/api/notifications/${userId}/unread-count`)
        .then((r) => r.json())
        .then((d) => setCount(d.count ?? 0))
        .catch(() => {});

    fetch_();
    timerRef.current = setInterval(fetch_, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [userId]);

  return { count, setCount };
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { userId } = useAuth();
  const [notifs, setNotifs] = useState<NotifEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/notifications/${userId}`)
      .then((r) => r.json())
      .then((d) => { setNotifs(d); setLoading(false); })
      .catch(() => setLoading(false));

    fetch(`${API_BASE}/api/notifications/read-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        className="relative ml-auto h-full w-full max-w-sm bg-sidebar border-l border-border shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BellRing size={18} className="text-primary" />
            <span className="font-semibold text-foreground">Notifications</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
          ) : notifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <CheckCheck size={32} className="opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifs.map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 transition-colors ${n.read ? "opacity-60" : "bg-primary/5"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">{typeIcon(n.type)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="mt-1 shrink-0 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t border-border shrink-0 text-center">
          <span className="text-[11px] text-muted-foreground/50">Showing last 50 notifications</span>
        </div>
      </div>
    </div>
  );
}
