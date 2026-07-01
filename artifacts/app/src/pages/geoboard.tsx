import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Camera, MapPin, Clock, User, ChevronDown, ChevronUp,
  ImageOff, LayoutGrid, Map as MapIcon, X, Video,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Contact colours — cycles for each unique contact
const CONTACT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16",
];

interface GeoPhoto {
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

interface GeoVideo {
  id: number;
  videoData: string;
  mimeType: string;
  durationMs: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  takenAt: string;
  inviteToken: string;
  toName: string | null;
  toPhone: string;
}

interface ContactGroup {
  name: string;
  phone: string;
  token: string;
  color: string;
  photos: GeoPhoto[];
  videos: GeoVideo[];
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Photo map pin icon ──────────────────────────────────────────────────────
function makeCameraPin(color: string, idx: number) {
  return L.divIcon({
    className: "",
    iconSize: [44, 54],
    iconAnchor: [22, 54],
    popupAnchor: [0, -54],
    html: `<div style="position:relative;width:44px;height:54px;filter:drop-shadow(0 4px 12px ${color}88);">
      <div style="width:44px;height:44px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,.85);font-size:11px;font-weight:800;color:#fff;font-family:ui-monospace,monospace;">
        📸${idx + 1}
      </div>
      <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:12px solid ${color};"></div>
    </div>`,
  });
}

// ── Map View ────────────────────────────────────────────────────────────────
function GeoMapView({
  photos,
  groups,
}: {
  photos: GeoPhoto[];
  groups: ContactGroup[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [selected, setSelected] = useState<GeoPhoto | null>(null);

  const colorByToken = new Map(groups.map((g) => [g.token, g.color]));
  const nameByToken = new Map(groups.map((g) => [g.token, g.name || g.phone]));

  const geoPhotos = photos.filter((p) => p.latitude != null && p.longitude != null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Init map
    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: false,
    });
    leafletRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const bounds: [number, number][] = [];

    // Group photos by token to assign sequential index per contact
    const indexByToken = new Map<string, number>();

    geoPhotos.forEach((photo) => {
      const lat = photo.latitude!;
      const lng = photo.longitude!;
      bounds.push([lat, lng]);

      const color = colorByToken.get(photo.inviteToken) ?? "#6366f1";
      const idx = indexByToken.get(photo.inviteToken) ?? 0;
      indexByToken.set(photo.inviteToken, idx + 1);

      const pin = makeCameraPin(color, idx);
      const contactName = nameByToken.get(photo.inviteToken) ?? "Contact";
      const timeStr = formatTime(photo.takenAt);

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;width:200px;">
          <img src="${photo.photoData}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block;" />
          <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">📍 ${contactName}</div>
          <div style="font-size:11px;color:#94a3b8;">🕐 ${timeStr}</div>
          ${photo.address ? `<div style="font-size:10px;color:#64748b;margin-top:4px;line-height:1.4;">${photo.address.slice(0, 80)}${photo.address.length > 80 ? "…" : ""}</div>` : ""}
          <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener noreferrer"
            style="display:block;margin-top:8px;text-align:center;background:${color};color:#fff;border-radius:5px;padding:4px 0;font-size:11px;font-weight:600;text-decoration:none;">
            Open in Maps
          </a>
        </div>`;

      const marker = L.marker([lat, lng], { icon: pin }).addTo(map);
      marker.bindPopup(popupHtml, { maxWidth: 220 });
      marker.on("click", () => setSelected(photo));
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [48, 48], maxZoom: 16 });
    } else {
      map.setView([20, 0], 2);
    }

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <div key={g.token} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: g.color }} />
            <span>{g.name || g.phone}</span>
            <span className="text-muted-foreground/60">({g.photos.filter((p) => p.latitude).length} pins)</span>
          </div>
        ))}
      </div>

      {/* Map container */}
      <div
        ref={mapRef}
        className="w-full rounded-xl overflow-hidden border border-border"
        style={{ height: "480px" }}
      />

      {geoPhotos.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 rounded-xl">
          <div className="text-center">
            <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No photos with GPS data yet</p>
          </div>
        </div>
      )}

      {/* Selected photo side-panel */}
      {selected && (
        <div className="mt-3 bg-muted rounded-xl p-4">
          <div className="flex items-start gap-3">
            <img
              src={selected.photoData}
              alt="Selected GeoBoard photo"
              className="w-24 h-24 object-cover rounded-lg flex-shrink-0 bg-black/20"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">
                  {nameByToken.get(selected.inviteToken) ?? "Contact"}
                </span>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Clock className="h-3 w-3" />
                {formatTime(selected.takenAt)}
              </div>
              {selected.latitude && selected.longitude && (
                <div className="flex items-center gap-1 text-xs text-primary mb-1">
                  <MapPin className="h-3 w-3" />
                  {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
                </div>
              )}
              {selected.address && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {selected.address}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-7 text-xs w-full"
                onClick={() => selected.latitude && window.open(
                  `https://maps.google.com/?q=${selected.latitude},${selected.longitude}`, "_blank",
                )}
              >
                <MapPin className="h-3 w-3 mr-1" /> Open in Google Maps
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Grid / contact group view ───────────────────────────────────────────────
function ContactPhotoGroup({ group }: { group: ContactGroup }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<GeoPhoto | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: `${group.color}22`, border: `2px solid ${group.color}55` }}
            >
              <User className="h-4 w-4" style={{ color: group.color }} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                {group.name || group.phone}
              </CardTitle>
              {group.name && (
                <p className="text-xs text-muted-foreground">{group.phone}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              <Camera className="h-3 w-3 mr-1" />
              {group.photos.length} photo{group.photos.length !== 1 ? "s" : ""}
            </Badge>
            {group.videos.length > 0 && (
              <Badge variant="secondary" className="text-xs bg-rose-500/10 text-rose-400 border-rose-500/20">
                <Video className="h-3 w-3 mr-1" />
                {group.videos.length} clip{group.videos.length !== 1 ? "s" : ""}
              </Badge>
            )}
            {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0">
          {/* Photos grid */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
            {group.photos.map((photo, idx) => (
              <button
                key={photo.id}
                onClick={() => setSelected(photo === selected ? null : photo)}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                  selected?.id === photo.id
                    ? "shadow-lg scale-95"
                    : "border-border hover:border-primary/50"
                }`}
                style={selected?.id === photo.id ? { borderColor: group.color } : {}}
              >
                <img
                  src={photo.photoData}
                  alt={`GeoBoard photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute top-1 left-1 bg-black/60 rounded-full w-5 h-5 flex items-center justify-center">
                  <span className="text-white text-[9px] font-bold">{idx + 1}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Videos */}
          {group.videos.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-rose-400 flex items-center gap-1.5 mb-2">
                <Video className="h-3.5 w-3.5" /> 5-Second Clips
              </p>
              {group.videos.map((video, idx) => (
                <div key={video.id} className="bg-muted rounded-xl p-3 space-y-2">
                  <video
                    src={video.videoData}
                    controls
                    playsInline
                    className="w-full rounded-lg max-h-48 bg-black"
                    style={{ aspectRatio: "16/9" }}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(video.takenAt)}
                    </div>
                    <span className="text-rose-400/70">Clip {idx + 1}</span>
                  </div>
                  {video.latitude && video.longitude && (
                    <a
                      href={`https://maps.google.com/?q=${video.latitude},${video.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs underline underline-offset-2"
                      style={{ color: group.color }}
                    >
                      <MapPin className="h-3 w-3" />
                      {video.latitude.toFixed(5)}, {video.longitude.toFixed(5)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="bg-muted rounded-xl p-4 space-y-2 mt-3">
              <img
                src={selected.photoData}
                alt="GeoBoard photo detail"
                className="w-full max-h-64 object-contain rounded-lg bg-black/30 mb-3"
              />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex items-start gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-muted-foreground">{formatTime(selected.takenAt)}</span>
                </div>
                {selected.latitude && selected.longitude && (
                  <div className="flex items-start gap-1.5">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" style={{ color: group.color }} />
                    <a
                      href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                      style={{ color: group.color }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
                    </a>
                  </div>
                )}
              </div>
              {selected.address && (
                <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                  📍 {selected.address.slice(0, 120)}{selected.address.length > 120 ? "…" : ""}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-2"
                onClick={() => {
                  if (selected.latitude && selected.longitude) {
                    window.open(
                      `https://maps.google.com/?q=${selected.latitude},${selected.longitude}`,
                      "_blank",
                    );
                  }
                }}
              >
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                View on Google Maps
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function GeoBoard() {
  const { userId } = useAuth();
  const [view, setView] = useState<"grid" | "map">("grid");

  const { data: photos = [], isLoading: photosLoading } = useQuery<GeoPhoto[]>({
    queryKey: ["geo-photos", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`);
      if (!r.ok) throw new Error("Failed to load GeoBoard photos");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const { data: videos = [], isLoading: videosLoading } = useQuery<GeoVideo[]>({
    queryKey: ["geo-videos", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo-videos/by-user/${userId}`);
      if (!r.ok) throw new Error("Failed to load GeoBoard videos");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const isLoading = photosLoading || videosLoading;

  // Build contact groups and assign a unique colour per contact
  const groups: ContactGroup[] = [];
  const seen = new Map<string, ContactGroup>();
  let colorIdx = 0;

  const allTokens = Array.from(new Set([
    ...photos.map((p) => p.inviteToken),
    ...videos.map((v) => v.inviteToken),
  ]));

  for (const token of allTokens) {
    const photo = photos.find((p) => p.inviteToken === token);
    const video = videos.find((v) => v.inviteToken === token);
    const sample = photo ?? video!;
    const g: ContactGroup = {
      name: sample.toName ?? "",
      phone: sample.toPhone,
      token,
      color: CONTACT_COLORS[colorIdx % CONTACT_COLORS.length],
      photos: [],
      videos: [],
    };
    colorIdx++;
    seen.set(token, g);
    groups.push(g);
  }

  for (const photo of photos) seen.get(photo.inviteToken)?.photos.push(photo);
  for (const video of videos) seen.get(video.inviteToken)?.videos.push(video);

  const totalPhotos = photos.length;
  const totalVideos = videos.length;
  const withGps = photos.filter((p) => p.latitude).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Camera className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">GeoBoard</h1>
            <p className="text-muted-foreground text-sm">
              Auto-captured snapshots and video clips tied to exact GPS coordinates.
            </p>
          </div>
        </div>

        {/* Stats + view toggle */}
        <div className="flex items-center gap-3">
          {(totalPhotos > 0 || totalVideos > 0) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span><span className="font-semibold text-foreground">{totalPhotos}</span> photos</span>
              {totalVideos > 0 && (
                <span><span className="font-semibold text-rose-400">{totalVideos}</span> clips</span>
              )}
              <span><span className="font-semibold text-foreground">{withGps}</span> pinned</span>
              <span><span className="font-semibold text-foreground">{groups.length}</span> contacts</span>
            </div>
          )}
          {!isLoading && groups.length > 0 && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView("grid")}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  view === "grid"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Media
              </button>
              <button
                onClick={() => setView("map")}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  view === "map"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" /> Map
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && groups.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <ImageOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-1">No GeoBoard media yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              When your contacts open a location-sharing link and grant camera access, 5 snapshots + a 5-second video clip will appear here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Map view */}
      {!isLoading && groups.length > 0 && view === "map" && (
        <GeoMapView photos={photos} groups={groups} />
      )}

      {/* Grid view */}
      {!isLoading && view === "grid" && (
        <div className="space-y-4">
          {groups.map((group) => (
            <ContactPhotoGroup key={group.token} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
