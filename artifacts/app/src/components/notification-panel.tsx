import { useEffect, useRef, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bell, BellRing, BellOff, X, CheckCheck, MapPin, AlertTriangle,
  Clock, Shield, Wifi, WifiOff, Siren, Pin, KeyRound, Trash2,
  Filter, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NotifEntry {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  pinned: boolean;
  createdAt: string;
}

function typeIcon(type: string) {
  switch (type) {
    case "geofence_enter":      return <MapPin   size={14} className="text-emerald-400" />;
    case "geofence_exit":       return <MapPin   size={14} className="text-amber-400"  />;
    case "location_offline":    return <WifiOff  size={14} className="text-red-400"    />;
    case "location_online":     return <Wifi     size={14} className="text-emerald-400"/>;
    case "location_stale":      return <Clock    size={14} className="text-amber-400"  />;
    case "location_update":     return <MapPin   size={14} className="text-sky-400"    />;
    case "sos":                 return <Siren    size={14} className="text-red-500"    />;
    case "grant":               return <Shield   size={14} className="text-blue-400"   />;
    case "admin_message":       return <KeyRound size={14} className="text-amber-400"  />;
    default:                    return <Bell     size={14} className="text-zinc-400"   />;
  }
}

const TYPE_LABELS: Record<string, string> = {
  geofence_enter:   "Geofence",
  geofence_exit:    "Geofence",
  location_offline: "Offline",
  location_online:  "Online",
  location_stale:   "Stale",
  location_update:  "Update",
  sos:              "SOS",
  grant:            "Grant",
  admin_message:    "Admin",
};

const ALL_FILTER_TYPES = [
  { value: "", label: "All" },
  { value: "grant", label: "Grants" },
  { value: "sos", label: "SOS" },
  { value: "geofence_enter", label: "Geofence" },
  { value: "location_offline", label: "Offline" },
  { value: "location_update", label: "Updates" },
];

// ── SSE-backed unread count ───────────────────────────────────────────────────
// Opens a single EventSource for the user and increments the count on each
// incoming notification. Falls back gracefully if EventSource is unavailable.
export function useNotificationCount(userId: number | null) {
  const [count, setCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!userId) { setCount(0); return; }

    // Fetch initial count via REST
    fetch(`${API_BASE}/api/notifications/${userId}/unread-count`)
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? 0))
      .catch(() => {});

    // Open SSE stream — increment on each new notification arriving
    const es = new EventSource(`${API_BASE}/api/notifications/${userId}/stream`);
    esRef.current = es;

    es.onmessage = () => {
      // Each SSE message is a new unread notification
      setCount((c) => c + 1);
    };

    es.onerror = () => {
      // EventSource will auto-reconnect; silence the error
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [userId]);

  return { count, setCount };
}

// ── Notification panel (slide-in drawer) ──────────────────────────────────────
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { userId } = useAuth();
  const [notifs, setNotifs]   = useState<NotifEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const esRef    = useRef<EventSource | null>(null);

  const fetchNotifs = useCallback((type?: string) => {
    if (!userId) return;
    setLoading(true);
    const url = type
      ? `${API_BASE}/api/notifications/${userId}?type=${encodeURIComponent(type)}`
      : `${API_BASE}/api/notifications/${userId}`;
    fetch(url)
      .then((r) => r.json())
      .then((d: NotifEntry[]) => {
        setNotifs(
          [...d].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          }),
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  // Initial load + mark-all-read
  useEffect(() => {
    if (!userId) return;
    fetchNotifs(typeFilter || undefined);

    fetch(`${API_BASE}/api/notifications/read-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
  }, [userId, typeFilter, fetchNotifs]);

  // SSE: prepend new notifications as they arrive
  useEffect(() => {
    if (!userId) return;

    const es = new EventSource(`${API_BASE}/api/notifications/${userId}/stream`);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const entry: NotifEntry = JSON.parse(ev.data);
        // Apply the active type filter
        if (typeFilter && entry.type !== typeFilter) return;
        setNotifs((prev) => {
          // Deduplicate by id
          if (prev.some((n) => n.id === entry.id)) return prev;
          // Pinned items stay at top, new non-pinned items go after pinned ones
          const pinned    = prev.filter((n) => n.pinned);
          const unpinned  = prev.filter((n) => !n.pinned);
          return entry.pinned
            ? [entry, ...pinned, ...unpinned]
            : [...pinned, entry, ...unpinned];
        });
        // Auto-mark as read since the panel is open
        fetch(`${API_BASE}/api/notifications/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [entry.id] }),
        }).catch(() => {});
      } catch { /* malformed */ }
    };

    return () => { es.close(); esRef.current = null; };
  }, [userId, typeFilter]);

  // Keyboard & outside-click dismissal
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

  const handleDelete = async (id: number) => {
    if (!userId) return;
    setDeleting((s) => new Set([...s, id]));
    await fetch(`${API_BASE}/api/notifications/${id}?userId=${userId}`, { method: "DELETE" })
      .catch(() => {});
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    setDeleting((s) => { const next = new Set(s); next.delete(id); return next; });
  };

  const handleClearAll = async () => {
    if (!userId) return;
    await fetch(`${API_BASE}/api/notifications/clear/${userId}`, { method: "DELETE" })
      .catch(() => {});
    setNotifs([]);
  };

  const displayed = typeFilter
    ? notifs.filter((n) => n.type === typeFilter)
    : notifs;

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        className="relative ml-auto h-full w-full max-w-sm bg-sidebar border-l border-border shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BellRing size={18} className="text-primary" />
            <span className="font-semibold text-foreground">Notifications</span>
            {displayed.length > 0 && (
              <span className="text-xs text-muted-foreground">({displayed.length})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchNotifs(typeFilter || undefined)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
            {displayed.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-red-400 transition-colors"
                title="Clear all"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Type filter tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 shrink-0 overflow-x-auto scrollbar-hide">
          <Filter size={12} className="text-muted-foreground shrink-0 mr-1" />
          {ALL_FILTER_TYPES.map((ft) => (
            <button
              key={ft.value}
              onClick={() => setTypeFilter(ft.value)}
              className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors border ${
                typeFilter === ft.value
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-muted-foreground border-border/40 hover:bg-secondary"
              }`}
            >
              {ft.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading…
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <CheckCheck size={32} className="opacity-30" />
              <p className="text-sm">No notifications{typeFilter ? " for this filter" : " yet"}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {displayed.map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 transition-colors group ${
                    n.pinned ? "bg-amber-500/10" : n.read ? "opacity-60" : "bg-primary/5"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">{typeIcon(n.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                        {n.pinned && <Pin size={11} className="text-amber-400 shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-muted-foreground/60">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                        {TYPE_LABELS[n.type] && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wide">
                            {TYPE_LABELS[n.type]}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(n.id)}
                      disabled={deleting.has(n.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"
                      title="Delete"
                    >
                      <X size={13} />
                    </button>
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
          <span className="text-[11px] text-muted-foreground/50">
            Showing last 50 notifications · real-time via SSE
          </span>
        </div>
      </div>
    </div>
  );
}
