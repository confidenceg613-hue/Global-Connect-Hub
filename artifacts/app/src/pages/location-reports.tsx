import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flag, MapPin, User, Clock, MessageSquare, Check, X } from "lucide-react";
import { TYPE_CONFIG, type LocationType } from "@/lib/location-intelligence";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LocationTypeReport {
  id: number;
  latitude: number;
  longitude: number;
  reportedType: string;
  suggestedType: string;
  comment: string | null;
  status: "pending" | "resolved" | "dismissed";
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

function statusBadge(status: LocationTypeReport["status"]) {
  if (status === "resolved") {
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Resolved</Badge>;
  }
  if (status === "dismissed") {
    return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15">Dismissed</Badge>;
  }
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">Pending</Badge>;
}

export default function LocationReports() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actingOn, setActingOn] = useState<number | null>(null);

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

  async function handleAction(id: number, action: "resolve" | "dismiss") {
    setActingOn(id);
    try {
      const r = await fetch(`${API_BASE}/api/location-reports/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error("Request failed");
      queryClient.setQueryData<LocationTypeReport[]>(["location-reports", userId], (old) =>
        (old ?? []).map((rep) => (rep.id === id ? { ...rep, status: action === "resolve" ? "resolved" : "dismissed" } : rep)),
      );
      toast({
        title: action === "resolve" ? "Type updated on the map" : "Report dismissed",
        description:
          action === "resolve"
            ? "Future map views for this spot will use the corrected type."
            : "No changes were made to the location type.",
      });
    } catch {
      toast({ title: "Couldn't update report", description: "Please try again.", variant: "destructive" });
    } finally {
      setActingOn(null);
    }
  }

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
                  <div className="flex items-center gap-2">
                    {statusBadge(r.status)}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatTime(r.createdAt)}
                    </span>
                  </div>
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

                <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                  <a
                    href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-medium text-primary hover:underline"
                  >
                    View on Google Maps ↗
                  </a>

                  {r.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs gap-1 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                        disabled={actingOn === r.id}
                        onClick={() => handleAction(r.id, "dismiss")}
                      >
                        <X className="h-3 w-3" /> Dismiss
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                        disabled={actingOn === r.id}
                        onClick={() => handleAction(r.id, "resolve")}
                      >
                        <Check className="h-3 w-3" /> Accept & update map
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
