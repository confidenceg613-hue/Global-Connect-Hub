import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Camera, MapPin, Clock, User, ChevronDown, ChevronUp, ImageOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

interface ContactGroup {
  name: string;
  phone: string;
  token: string;
  photos: GeoPhoto[];
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function ContactPhotoGroup({ group }: { group: ContactGroup }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<GeoPhoto | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
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
            {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0">
          {/* Photo grid */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
            {group.photos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => setSelected(photo === selected ? null : photo)}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                  selected?.id === photo.id ? "border-primary shadow-lg scale-95" : "border-border hover:border-primary/50"
                }`}
              >
                <img
                  src={photo.photoData}
                  alt={`GeoBoard photo ${photo.id}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>

          {/* Selected photo detail */}
          {selected && (
            <div className="bg-muted rounded-xl p-4 space-y-2">
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
                    <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <a
                      href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
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

export default function GeoBoard() {
  const { userId } = useAuth();

  const { data: photos = [], isLoading } = useQuery<GeoPhoto[]>({
    queryKey: ["geo-photos", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`);
      if (!r.ok) throw new Error("Failed to load GeoBoard photos");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  // Group by invite token
  const groups: ContactGroup[] = [];
  const seen = new Map<string, ContactGroup>();
  for (const photo of photos) {
    if (!seen.has(photo.inviteToken)) {
      const g: ContactGroup = {
        name: photo.toName ?? "",
        phone: photo.toPhone,
        token: photo.inviteToken,
        photos: [],
      };
      seen.set(photo.inviteToken, g);
      groups.push(g);
    }
    seen.get(photo.inviteToken)!.photos.push(photo);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Camera className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">GeoBoard</h1>
          <p className="text-muted-foreground text-sm">
            Auto-captured snapshots from contact devices when they grant location access.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <ImageOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-1">No GeoBoard photos yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              When your contacts open a location-sharing link and grant camera access, 5 snapshots will appear here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <ContactPhotoGroup key={group.token} group={group} />
        ))}
      </div>
    </div>
  );
}
