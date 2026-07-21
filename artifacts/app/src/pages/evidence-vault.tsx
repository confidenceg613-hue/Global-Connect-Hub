import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Archive, Camera, Video, MapPin, Clock, Download,
  Filter, User, ChevronDown, ImageOff, FileDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface GeoPhoto {
  id: number;
  photoData: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  cameraFacing?: "environment" | "user";
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
  cameraFacing?: "environment" | "user";
  takenAt: string;
  inviteToken: string;
  toName: string | null;
  toPhone: string;
}

type MediaItem =
  | ({ kind: "photo" } & GeoPhoto)
  | ({ kind: "video" } & GeoVideo);

function fmt(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function contactLabel(item: GeoPhoto | GeoVideo) {
  return item.toName ?? item.toPhone;
}

// Download a base64 data-URL as a file
function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// Export a JSON archive file
function exportJson(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function MediaCard({ item }: { item: MediaItem }) {
  const { toast } = useToast();

  const handleDownload = () => {
    const ts = new Date(item.takenAt).toISOString().replace(/[:.]/g, "-");
    const contact = contactLabel(item).replace(/\s+/g, "_");
    if (item.kind === "photo") {
      downloadDataUrl(
        item.photoData,
        `geoboard_photo_${contact}_${ts}.jpg`,
      );
    } else {
      const ext = item.mimeType.includes("mp4") ? "mp4" : "webm";
      downloadDataUrl(
        item.videoData,
        `geoboard_video_${contact}_${ts}.${ext}`,
      );
    }
    toast({ title: "Download started" });
  };

  const hasCords = item.latitude != null && item.longitude != null;

  return (
    <Card className="overflow-hidden group relative">
      {/* Thumbnail */}
      <div className="relative bg-muted/30" style={{ aspectRatio: "4/3" }}>
        {item.kind === "photo" ? (
          <img
            src={item.photoData}
            alt="GeoBoard capture"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Video className="w-8 h-8 text-violet-400" />
            {item.durationMs != null && (
              <span className="text-xs text-muted-foreground font-mono">
                {(item.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {/* Overlay badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge
            variant="secondary"
            className={`text-[9px] px-1.5 py-0 font-bold ${
              item.kind === "video" ? "bg-violet-500/80 text-white" : "bg-zinc-800/80 text-white"
            }`}
          >
            {item.kind === "video" ? "📹 Video" : "📸 Photo"}
          </Badge>
          {item.cameraFacing === "user" && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-pink-500/80 text-white">
              Selfie
            </Badge>
          )}
        </div>

        {/* Download overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs gap-1.5"
            onClick={handleDownload}
          >
            <Download className="w-3.5 h-3.5" /> Download
          </Button>
        </div>
      </div>

      {/* Metadata */}
      <CardContent className="p-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <User className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="truncate">{contactLabel(item)}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          {fmt(item.takenAt)}
        </div>
        {hasCords && (
          <a
            href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:underline"
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{item.address ?? `${item.latitude!.toFixed(4)}, ${item.longitude!.toFixed(4)}`}</span>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function EvidenceVault() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [contactFilter, setContactFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "photo" | "video">("all");

  const { data: photos = [], isLoading: loadingPhotos } = useQuery<GeoPhoto[]>({
    queryKey: ["geo-photos", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`).then((r) => r.json()),
    enabled: !!userId,
  });

  const { data: videos = [], isLoading: loadingVideos } = useQuery<GeoVideo[]>({
    queryKey: ["geo-videos", userId],
    queryFn: () =>
      fetch(`${API_BASE}/api/geo-videos/by-user/${userId}`).then((r) => r.json()),
    enabled: !!userId,
  });

  const isLoading = loadingPhotos || loadingVideos;

  const allItems: MediaItem[] = useMemo(() => {
    const p: MediaItem[] = photos.map((ph) => ({ kind: "photo" as const, ...ph }));
    const v: MediaItem[] = videos.map((vi) => ({ kind: "video" as const, ...vi }));
    return [...p, ...v].sort(
      (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
    );
  }, [photos, videos]);

  const contacts = useMemo(() => {
    const seen = new Map<string, string>();
    allItems.forEach((item) => {
      seen.set(item.inviteToken, contactLabel(item));
    });
    return [...seen.entries()];
  }, [allItems]);

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (contactFilter !== "all" && item.inviteToken !== contactFilter) return false;
      if (typeFilter === "photo" && item.kind !== "photo") return false;
      if (typeFilter === "video" && item.kind !== "video") return false;
      return true;
    });
  }, [allItems, contactFilter, typeFilter]);

  const handleExportJson = () => {
    const exportData = filtered.map((item) => ({
      id: item.id,
      kind: item.kind,
      contact: contactLabel(item),
      inviteToken: item.inviteToken,
      takenAt: item.takenAt,
      cameraFacing: item.cameraFacing,
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.address,
      // Omit raw media data to keep file size manageable
      mediaDataLength: item.kind === "photo" ? item.photoData.length : item.videoData.length,
    }));
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    exportJson({ exportedAt: new Date().toISOString(), count: exportData.length, items: exportData }, `evidence_vault_${ts}.json`);
    toast({ title: `Exported metadata for ${exportData.length} item${exportData.length !== 1 ? "s" : ""}` });
  };

  const handleExportAll = async () => {
    toast({ title: "Downloading…", description: `Starting ${filtered.length} file download(s)` });
    for (const item of filtered) {
      const ts = new Date(item.takenAt).toISOString().replace(/[:.]/g, "-");
      const contact = contactLabel(item).replace(/\s+/g, "_");
      if (item.kind === "photo") {
        downloadDataUrl(item.photoData, `geoboard_photo_${contact}_${ts}.jpg`);
      } else {
        const ext = item.mimeType?.includes("mp4") ? "mp4" : "webm";
        downloadDataUrl(item.videoData, `geoboard_video_${contact}_${ts}.${ext}`);
      }
      // Small delay to avoid overwhelming browser download queue
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10">
            <Archive className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Evidence Vault</h1>
            <p className="text-sm text-muted-foreground">All GeoBoard captures — browse, filter, and download</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 hidden sm:flex"
            onClick={handleExportJson}
            disabled={filtered.length === 0}
          >
            <FileDown className="w-3.5 h-3.5" /> Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={handleExportAll}
            disabled={filtered.length === 0}
          >
            <Download className="w-3.5 h-3.5" /> Download all
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex gap-3 overflow-x-auto pb-0.5">
        {[
          { label: "Photos",  value: photos.length,  icon: Camera, color: "text-violet-400" },
          { label: "Videos",  value: videos.length,  icon: Video,  color: "text-blue-400" },
          { label: "Contacts", value: contacts.length, icon: User,  color: "text-emerald-400" },
        ].map((s) => (
          <div key={s.label} className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card">
            <s.icon className={`w-4 h-4 ${s.color}`} />
            <span className="font-black text-sm">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

        {/* Contact filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <User className="w-3.5 h-3.5" />
              {contactFilter === "all" ? "All contacts" : (contacts.find(([t]) => t === contactFilter)?.[1] ?? "Contact")}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setContactFilter("all")}>All contacts</DropdownMenuItem>
            <DropdownMenuSeparator />
            {contacts.map(([token, name]) => (
              <DropdownMenuItem key={token} onClick={() => setContactFilter(token)}>
                {name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Type filter */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(["all", "photo", "video"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 transition-colors ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-secondary/60"
              }`}
            >
              {t === "all" ? "All" : t === "photo" ? "📸 Photos" : "📹 Videos"}
            </button>
          ))}
        </div>

        {(contactFilter !== "all" || typeFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setContactFilter("all"); setTypeFilter("all"); }}
          >
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} item{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="p-4 rounded-full bg-muted/30">
              <ImageOff className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="font-semibold">
              {allItems.length === 0 ? "No captures yet" : "No items match your filters"}
            </p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {allItems.length === 0
                ? "Photos and videos are captured automatically when a contact grants location consent. They'll appear here once collected."
                : "Try adjusting the contact or type filter above."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((item) => (
            <MediaCard key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
