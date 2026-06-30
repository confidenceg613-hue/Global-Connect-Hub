import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flag, MapPin, User, Clock, MessageSquare } from "lucide-react";
import { TYPE_CONFIG, type LocationType } from "@/lib/location-intelligence";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LocationTypeReport {
  id: number;
  latitude: number;
  longitude: number;
  reportedType: string;
  suggestedType: string;
  comment: string | null;
  createdAt: string;
  inviteToken: string;
  toName: string | null;
  toPhone: string;
  grantedAddress: string | null;
}

function typeBadge(type: string) {
  const cfg = TYPE_CONFIG[type as LocationType];
  if (!cfg) return <Badge variant="outline">{type}</Badge>;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold"
      style={{ background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}55` }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function LocationReports() {
  const { userId } = useAuth();

  const { data: reports = [], isLoading } = useQuery<LocationTypeReport[]>({
    queryKey: ["location-reports", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/location-reports/by-user/${userId}`);
      if (!r.ok) throw new Error("Failed to load location reports");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Flag className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Location Type Reports</h1>
          <p className="text-muted-foreground text-sm">
            Flags submitted when a contact disagrees with an auto-detected location type.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Loading reports…
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No reports yet. They'll show up here when a contact flags an incorrect type on the map.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {r.toName ?? "Unknown"}
                    <span className="text-xs text-muted-foreground font-mono font-normal">{r.toPhone}</span>
                  </CardTitle>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatTime(r.createdAt)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {typeBadge(r.reportedType)}
                  <span className="text-muted-foreground text-xs">flagged as wrong →</span>
                  {typeBadge(r.suggestedType)}
                </div>

                <div className="flex items-start gap-1.5 text-xs text-muted-foreground font-mono">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    {r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}
                    {r.grantedAddress && <div className="text-muted-foreground/80 mt-0.5">{r.grantedAddress}</div>}
                  </div>
                </div>

                {r.comment && (
                  <div className="flex items-start gap-1.5 text-xs bg-muted/40 rounded-md p-2.5">
                    <MessageSquare className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <span>{r.comment}</span>
                  </div>
                )}

                <a
                  href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-medium text-primary hover:underline"
                >
                  View on Google Maps ↗
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
