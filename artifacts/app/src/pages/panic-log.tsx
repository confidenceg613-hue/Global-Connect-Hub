import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapCloudReveal } from "@/components/map-cloud-reveal";
import { Siren, MapPin, Clock, Trash2, CheckCheck, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PanicEntry {
  id: number;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data: {
    latitude?: number;
    longitude?: number;
    address?: string | null;
    fromUserId?: number;
  } | null;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function enc(s: string) { return `data:image/svg+xml,${encodeURIComponent(s)}`; }

const sosPin = (idx: number) => L.icon({
  iconUrl: enc(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
    <defs><filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(220,38,38,0.6)"/></filter></defs>
    <path d="M22 2C13.2 2 6 9.2 6 18c0 12 16 36 16 36s16-24 16-36C38 9.2 30.8 2 22 2z" fill="#dc2626" filter="url(#s)" stroke="white" stroke-width="2.5"/>
    <circle cx="22" cy="18" r="9" fill="rgba(255,255,255,0.2)"/>
    <text x="22" y="22" text-anchor="middle" font-size="12" fill="white" font-weight="900">${idx}</text>
  </svg>`),
  iconSize: [44, 56], iconAnchor: [22, 56], popupAnchor: [0, -58],
});

function PanicMap({ entries }: { entries: PanicEntry[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const withCoords = entries.filter(
    (e) => e.data?.latitude != null && e.data?.longitude != null,
  );

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, {
      center: [20, 0], zoom: 2, zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(leafletMap.current);
  }, []);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map || withCoords.length === 0) return;

    // Clear old markers
    map.eachLayer((layer) => { if (layer instanceof L.Marker) map.removeLayer(layer); });

    const bounds: [number, number][] = [];
    withCoords.forEach((e, i) => {
      const lat = e.data!.latitude!;
      const lng = e.data!.longitude!;
      bounds.push([lat, lng]);
      L.marker([lat, lng], { icon: sosPin(i + 1) })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:sans-serif;min-width:160px">
            <div style="font-weight:800;color:#dc2626;font-size:13px">🆘 SOS #${i + 1}</div>
            <div style="font-size:11px;margin-top:4px;color:#666">${e.data?.address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`}</div>
            <div style="font-size:10px;color:#999;margin-top:2px">${fmt(e.createdAt)}</div>
          </div>`,
        );
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    }
  }, [withCoords.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (withCoords.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4 text-red-400" />
          SOS Locations Map
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={mapRef} className="w-full rounded-b-xl" style={{ height: 260 }} />
      </CardContent>
    </Card>
  );
}

export default function PanicLog() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: entries = [], isLoading } = useQuery<PanicEntry[]>({
    queryKey: ["panic-log", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/notifications/${userId}?type=sos`)
        .then((r) => r.json()),
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  // SSE: live SOS alerts pop in immediately
  useEffect(() => {
    if (!userId) return;
    const es = new EventSource(`${API_BASE}/api/notifications/${userId}/stream`);
    es.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data);
        if (n.type === "sos") {
          qc.invalidateQueries({ queryKey: ["panic-log", userId] });
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [userId, qc]);

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API_BASE}/api/notifications/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panic-log", userId] });
      toast({ title: "Alert dismissed" });
    },
  });

  const clearMut = useMutation({
    mutationFn: () =>
      fetch(`${API_BASE}/api/notifications/clear/${userId}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panic-log", userId] });
      toast({ title: "All SOS alerts cleared" });
    },
  });

  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <MapCloudReveal />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500/10">
            <Siren className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Panic Log</h1>
            <p className="text-sm text-muted-foreground">SOS alert history from all contacts</p>
          </div>
        </div>
        {entries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-red-400 hover:text-red-300"
            onClick={() => clearMut.mutate()}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear all
          </Button>
        )}
      </div>

      {/* Map */}
      <PanicMap entries={entries} />

      {/* Alert list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="p-4 rounded-full bg-red-500/10">
              <Siren className="w-8 h-8 text-red-400/50" />
            </div>
            <p className="font-semibold">No SOS alerts on record</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              When a contact triggers an SOS, it will appear here with their exact GPS coordinates and address.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((e, i) => {
            const isNew = !e.read;
            const hasCords = e.data?.latitude != null;
            return (
              <div
                key={e.id}
                onClick={() => toggleSelect(e.id)}
                className={`relative rounded-xl border p-4 cursor-pointer transition-colors ${
                  selected.has(e.id)
                    ? "border-red-500/50 bg-red-500/8"
                    : isNew
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-border bg-card"
                }`}
              >
                {isNew && (
                  <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 ring-2 ring-background animate-pulse" />
                )}
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-black text-sm
                    ${isNew ? "bg-red-500 text-white" : "bg-red-500/10 text-red-400"}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{e.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{e.body}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {fmt(e.createdAt)}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        {timeAgo(e.createdAt)}
                      </Badge>
                      {hasCords && (
                        <a
                          href={`https://www.google.com/maps?q=${e.data!.latitude},${e.data!.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] text-blue-400 hover:underline"
                        >
                          <MapPin className="w-3 h-3" /> Open in Maps
                        </a>
                      )}
                    </div>
                    {hasCords && (
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                        {e.data?.address ?? `${e.data!.latitude!.toFixed(6)}, ${e.data!.longitude!.toFixed(6)}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {hasCords && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="w-7 h-7 text-blue-400 hover:text-blue-300 hover:border-blue-400/40"
                        title="View on map"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          window.open(
                            `https://www.google.com/maps?q=${e.data!.latitude},${e.data!.longitude}`,
                            "_blank",
                          );
                        }}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-7 h-7 text-red-400 hover:text-red-300 hover:border-red-400/40"
                      title="Dismiss alert"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        deleteMut.mutate(e.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          <p className="text-center text-xs text-muted-foreground pt-2">
            <CheckCheck className="w-3.5 h-3.5 inline mr-1" />
            {entries.length} SOS alert{entries.length !== 1 ? "s" : ""} on record
          </p>
        </div>
      )}
    </div>
  );
}
