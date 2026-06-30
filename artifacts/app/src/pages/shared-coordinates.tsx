import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { MapPin, Navigation, ExternalLink, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

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
    (inv) =>
      inv.status === "accepted" &&
      inv.grantedLatitude != null &&
      inv.grantedLongitude != null,
  );

  const copyCoords = (inv: Invite) => {
    navigator.clipboard
      .writeText(`${inv.grantedLatitude}, ${inv.grantedLongitude}`)
      .then(() => toast({ title: "Coordinates copied" }));
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
            <div key={i} className="rounded-2xl border bg-muted animate-pulse h-72" />
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
            Once someone accepts your WhatsApp invite and grants their location, it will
            appear here permanently.
          </p>
        </div>
      )}

      {/* Grid of coordinate cards */}
      {!isLoading && granted.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {granted.map((inv) => (
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
  const delta = 0.012;

  const osmEmbedUrl = `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&output=embed`;
  const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

  return (
    <div className="rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-card">
      {/* Map */}
      <div className="relative w-full" style={{ height: 220 }}>
        <iframe
          title={`Location from ${invite.toName ?? invite.toPhone}`}
          src={osmEmbedUrl}
          className="w-full h-full border-0"
          loading="lazy"
        />
        {/* Invite ID badge over the map */}
        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-mono px-2 py-0.5 rounded-full backdrop-blur-sm">
          Invite #{invite.id}
        </div>
      </div>

      {/* Info */}
      <div className="p-4 space-y-3">
        {/* Person */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground leading-tight">
              {invite.toName ?? "Unknown"}
            </p>
            <p className="text-sm text-muted-foreground">{invite.toPhone}</p>
          </div>
          <Badge className="bg-emerald-600 text-white text-xs capitalize flex-shrink-0 border-0">
            Granted
          </Badge>
        </div>

        {/* Coordinates box */}
        <div className="bg-muted/50 border border-border rounded-xl p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
            <MapPin size={10} />
            Coordinates Shared
          </p>
          <p className="text-lg font-mono font-bold text-foreground leading-tight">
            {lat.toFixed(6)},&nbsp;{lng.toFixed(6)}
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
              className="h-7 px-2 text-xs text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
              onClick={() => window.open(googleMapsUrl, "_blank")}
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
