import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { MapPin, Navigation, ExternalLink, Copy, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import { fetchStreetView, googleTileImageUrl, streetViewUrl, mapillaryViewerUrl, type StreetViewResult } from "@/lib/maps-config";

/** Convert decimal degrees to DMS string, e.g. 8°56′59.8″N */
function toDMS(dd: number, isLat: boolean): string {
  const dir = isLat ? (dd >= 0 ? "N" : "S") : (dd >= 0 ? "E" : "W");
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(1);
  return `${deg}°${min}′${sec}″${dir}`;
}
function formatDMS(lat: number, lng: number): string {
  return `${toDMS(lat, true)} ${toDMS(lng, false)}`;
}

export default function SharedCoordinates() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const { data: invites, isLoading } = useListInvites(
    { userId: userId! },
    {
      query: {
        enabled: !!userId,
        queryKey: getListInvitesQueryKey({ userId: userId! }),
        refetchInterval: 10000,
      },
    },
  );

  const granted = (invites ?? []).filter(
    (inv: Invite) =>
      inv.status === "accepted" &&
      inv.grantedLatitude != null &&
      inv.grantedLongitude != null,
  );

  const copyCoords = (inv: Invite) => {
    const dms = formatDMS(inv.grantedLatitude!, inv.grantedLongitude!);
    const decimal = `${inv.grantedLatitude}, ${inv.grantedLongitude}`;
    navigator.clipboard
      .writeText(`${dms}\n${decimal}`)
      .then(() => toast({ title: "Coordinates copied", description: dms }))
      .catch(() => {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = `${dms}\n${decimal}`;
        ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast({ title: "Coordinates copied" });
      });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Navigation className="h-7 w-7 text-primary" />
            Shared Coordinates
          </h1>
          <p className="text-muted-foreground mt-1">
            Every location shared with you — saved permanently.
          </p>
        </div>
        {granted.length > 0 && (
          <Badge variant="secondary" className="text-sm px-3 py-1 mt-1">
            {granted.length} location{granted.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border bg-muted animate-pulse h-80" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && granted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="bg-muted p-5 rounded-full mb-5">
            <MapPin size={36} className="text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No coordinates yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Once someone accepts your invite and grants their location, it will appear here permanently.
          </p>
        </div>
      )}

      {/* Grid of coordinate cards */}
      {!isLoading && granted.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {granted.map((inv: Invite) => (
            <CoordinateCard key={inv.id} invite={inv} onCopy={copyCoords} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoordinateCard({
  invite,
  onCopy,
}: {
  invite: Invite;
  onCopy: (inv: Invite) => void;
}) {
  const lat = invite.grantedLatitude!;
  const lng = invite.grantedLongitude!;
  const [showStreetView, setShowStreetView] = useState(false);
  const [svResult, setSvResult] = useState<StreetViewResult | null>(null);
  const [svLoading, setSvLoading] = useState(false);

  const satSrc = googleTileImageUrl(lat, lng);

  // Resolve nearest street-level photo lazily (only once the toggle is opened)
  useEffect(() => {
    if (!showStreetView || svResult !== null) return;
    setSvLoading(true);
    fetchStreetView(lat, lng).then(setSvResult).finally(() => setSvLoading(false));
  }, [showStreetView, lat, lng, svResult]);

  const mapsUrl = streetViewUrl(lat, lng); // Google Maps satellite link
  const svExtUrl = streetViewUrl(lat, lng);
  const dms = formatDMS(lat, lng);

  return (
    <div className="rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-card">
      {/* Map/Street View toggle */}
      <div className="relative w-full" style={{ height: 220 }}>
        {showStreetView ? (
          svLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-muted/40 text-xs text-muted-foreground">
              Looking for nearby street-level photos…
            </div>
          ) : svResult?.available && svResult.imageUrl ? (
            <div key="sv" className="relative w-full h-full overflow-hidden">
              <img
                src={svResult.imageUrl}
                alt={`Street-level view near location shared by ${invite.toName ?? invite.toPhone}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <a
                href={svResult.imageId ? mapillaryViewerUrl(svResult.imageId) : svExtUrl}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 hover:bg-black/90 text-white text-xs font-semibold px-2.5 py-1.5 rounded-full backdrop-blur-sm transition-all"
              >
                View in Mapillary →
              </a>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-muted/40 text-center px-4">
              <span className="text-xs text-muted-foreground">No street-level imagery available near this location.</span>
              <a href={svExtUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-500 hover:text-sky-400 underline">
                View satellite map instead
              </a>
            </div>
          )
        ) : (
          <img
            key="sat"
            alt={`Google map view of location shared by ${invite.toName ?? invite.toPhone}`}
            src={satSrc}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
        {/* Map type badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <div className="bg-black/60 text-white text-xs font-mono px-2 py-0.5 rounded-full backdrop-blur-sm">
            Invite #{invite.id}
          </div>
          <div className={`text-xs font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm ${showStreetView ? "bg-sky-500/80 text-white" : "bg-black/60 text-white"}`}>
            {showStreetView ? "🛣 Street View" : "🛰 Satellite"}
          </div>
        </div>
        {/* View toggle button */}
        <button
          onClick={() => setShowStreetView((v) => !v)}
          className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-xs font-semibold px-2.5 py-1.5 rounded-full backdrop-blur-sm transition-all"
        >
          <Eye className="h-3 w-3" />
          {showStreetView ? "Satellite" : "Street View"}
        </button>
      </div>

      {/* Info */}
      <div className="p-4 space-y-3">
        {/* Person */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground leading-tight">{invite.toName ?? "Unknown"}</p>
            <p className="text-sm text-muted-foreground">{invite.toPhone}</p>
          </div>
          <Badge className="bg-emerald-600 text-white text-xs capitalize flex-shrink-0 border-0">Granted</Badge>
        </div>

        {/* Coordinates box */}
        <div className="bg-muted/50 border border-border rounded-xl p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
            <MapPin size={10} /> Coordinates Shared
          </p>
          {/* DMS — primary display */}
          <p className="text-sm font-mono font-bold text-foreground leading-tight">
            {dms}
          </p>
          {/* Decimal — secondary */}
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </p>
          {invite.grantedAddress && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{invite.grantedAddress}</p>
          )}
        </div>

        {/* Timestamp + actions */}
        <div className="flex items-center justify-between gap-2">
          {invite.grantedAt ? (
            <p className="text-xs text-muted-foreground">
              {format(new Date(invite.grantedAt), "MMM d, yyyy · h:mm a")}
            </p>
          ) : (
            <span />
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onCopy(invite)}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-sky-400 border-sky-500/40 hover:bg-sky-500/10"
              onClick={() => window.open(svExtUrl, "_blank")}
            >
              <Eye className="h-3 w-3 mr-1" />
              Street
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
              onClick={() => window.open(mapsUrl, "_blank")}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Maps
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
