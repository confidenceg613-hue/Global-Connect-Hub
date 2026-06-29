import { useAuth } from "@/hooks/use-auth";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { MapPin, Clock, User, BarChart3, ExternalLink, Copy, TrendingUp, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

interface ContactSummary {
  toPhone: string;
  toName: string | undefined;
  grants: Invite[];
  firstGrant: string;
  lastGrant: string;
}

export default function LocationHistory() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const { data: invites, isLoading } = useListInvites(
    { userId: userId! },
    {
      query: {
        enabled: !!userId,
        queryKey: getListInvitesQueryKey({ userId: userId! }),
        refetchInterval: 15000,
      },
    },
  );

  const granted = (invites ?? []).filter(
    (inv: Invite) =>
      inv.status === "accepted" &&
      inv.grantedLatitude != null &&
      inv.grantedLongitude != null,
  );

  // Sort all grants by grantedAt descending
  const timeline = [...granted].sort((a: Invite, b: Invite) => {
    const aTime = a.grantedAt ? new Date(a.grantedAt).getTime() : 0;
    const bTime = b.grantedAt ? new Date(b.grantedAt).getTime() : 0;
    return bTime - aTime;
  });

  // Group by contact phone for frequency stats
  const byContact = granted.reduce<Record<string, ContactSummary>>((acc: Record<string, ContactSummary>, inv: Invite) => {
    const key = inv.toPhone;
    if (!acc[key]) {
      acc[key] = {
        toPhone: inv.toPhone,
        toName: inv.toName ?? undefined,
        grants: [],
        firstGrant: inv.grantedAt ?? inv.sentAt,
        lastGrant: inv.grantedAt ?? inv.sentAt,
      };
    }
    acc[key].grants.push(inv);
    const t = inv.grantedAt ?? inv.sentAt;
    if (t < acc[key].firstGrant) acc[key].firstGrant = t;
    if (t > acc[key].lastGrant) acc[key].lastGrant = t;
    return acc;
  }, {});

  const contacts: ContactSummary[] = Object.values(byContact).sort(
    (a: ContactSummary, b: ContactSummary) => b.grants.length - a.grants.length,
  );

  const copyCoords = (inv: Invite) => {
    navigator.clipboard
      .writeText(`${inv.grantedLatitude?.toFixed(6)}, ${inv.grantedLongitude?.toFixed(6)}`)
      .then(() => toast({ title: "Coordinates copied" }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Clock className="h-7 w-7 text-primary" />
          Location History
        </h1>
        <p className="text-muted-foreground mt-1">
          Full audit trail of every consented location grant — stored permanently.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/60">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 text-primary p-3 rounded-xl">
              <MapPin size={22} />
            </div>
            <div>
              <p className="text-2xl font-bold">{granted.length}</p>
              <p className="text-sm text-muted-foreground">Total grants</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-emerald-500/10 text-emerald-500 p-3 rounded-xl">
              <User size={22} />
            </div>
            <div>
              <p className="text-2xl font-bold">{contacts.length}</p>
              <p className="text-sm text-muted-foreground">Unique contacts</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-purple-500/10 text-purple-500 p-3 rounded-xl">
              <TrendingUp size={22} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {contacts.length > 0 ? contacts[0].grants.length : 0}
              </p>
              <p className="text-sm text-muted-foreground">Most grants by one contact</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {granted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="bg-muted p-5 rounded-full mb-5">
            <Clock size={36} className="text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No history yet</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Once contacts accept your invites and share their location, a permanent record appears here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Timeline — left 2/3 */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Calendar size={18} className="text-primary" />
              Timeline
            </h2>

            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

              <div className="space-y-4">
                {timeline.map((inv, idx) => (
                  <TimelineEntry
                    key={inv.id}
                    invite={inv}
                    isFirst={idx === 0}
                    onCopy={copyCoords}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Contact frequency — right 1/3 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <BarChart3 size={18} className="text-primary" />
              By Contact
            </h2>

            <div className="space-y-3">
              {contacts.map((contact) => (
                <ContactCard key={contact.toPhone} contact={contact} total={granted.length} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEntry({
  invite,
  isFirst,
  onCopy,
}: {
  invite: Invite;
  isFirst: boolean;
  onCopy: (inv: Invite) => void;
}) {
  const lat = invite.grantedLatitude!;
  const lng = invite.grantedLongitude!;
  const delta = 0.01;
  const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta},${lat - delta},${lng + delta},${lat + delta}&layer=mapnik&marker=${lat},${lng}`;
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

  return (
    <div className="relative pl-14">
      {/* Dot */}
      <div
        className={`absolute left-3.5 top-4 w-3 h-3 rounded-full border-2 border-background ${
          isFirst ? "bg-primary" : "bg-muted-foreground/40"
        }`}
      />

      <Card className={`border-border/60 overflow-hidden ${isFirst ? "border-primary/30 shadow-md" : ""}`}>
        {/* Map strip */}
        <div className="relative w-full" style={{ height: 150 }}>
          <iframe
            title={`Grant #${invite.id}`}
            src={osmUrl}
            className="w-full h-full border-0"
            loading="lazy"
          />
          {isFirst && (
            <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Most recent
            </div>
          )}
          <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-mono px-2 py-0.5 rounded-full backdrop-blur-sm">
            #{invite.id}
          </div>
        </div>

        <CardContent className="p-4 space-y-2">
          {/* Contact row */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground leading-tight">
                {invite.toName ?? "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground">{invite.toPhone}</p>
            </div>
            {invite.grantedAt && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-foreground font-medium">
                  {format(new Date(invite.grantedAt), "MMM d, yyyy")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(invite.grantedAt), { addSuffix: true })}
                </p>
              </div>
            )}
          </div>

          {/* Coords */}
          <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-mono font-semibold text-foreground leading-tight">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </p>
              {invite.grantedAddress && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {invite.grantedAddress}
                </p>
              )}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => onCopy(invite)}
                title="Copy coordinates"
              >
                <Copy className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => window.open(mapsUrl, "_blank")}
                title="Open in Google Maps"
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContactCard({
  contact,
  total,
}: {
  contact: ContactSummary;
  total: number;
}) {
  const pct = total > 0 ? Math.round((contact.grants.length / total) * 100) : 0;

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">
              {contact.toName ?? "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground truncate">{contact.toPhone}</p>
          </div>
          <Badge variant="secondary" className="flex-shrink-0 text-xs font-bold">
            {contact.grants.length}×
          </Badge>
        </div>

        {/* Bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <p>First: {format(new Date(contact.firstGrant), "MMM d, yyyy")}</p>
          <p>Last: {format(new Date(contact.lastGrant), "MMM d, yyyy")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
