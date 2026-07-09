import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, MapPin, RefreshCw, Radio, Users } from "lucide-react";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Session {
  inviteId: number;
  token: string;
  toName: string | null;
  toPhone: string;
  consentType: string | null;
  grantedAt: string | null;
  consentPageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  status: "active" | "offline";
  lastUpdate: string | null;
  googleMapsLiveLink: string | null;
}

async function fetchSessions(userId: number): Promise<Session[]> {
  const r = await fetch(`${API_BASE}/api/sessions?userId=${userId}`);
  if (!r.ok) throw new Error("Failed to load sessions");
  return r.json();
}

function copyToClipboard(text: string, label: string, onDone: (msg: string) => void) {
  const doWrite = () => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  };
  doWrite().then(() => onDone(`${label} copied to clipboard`)).catch(() => {});
}

export default function Sessions() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: sessions, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sessions", userId],
    queryFn: () => fetchSessions(userId!),
    enabled: !!userId,
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const notify = (msg: string) => toast({ title: msg });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Active Sessions</h1>
          <p className="text-muted-foreground mt-1">
            Every contact who has granted consent — copy their share link or a Google Maps live location link.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoRefresh ? "default" : "outline"}
            className="gap-2 text-xs"
            onClick={() => setAutoRefresh((v) => !v)}
            data-testid="button-toggle-autorefresh"
          >
            <Radio className={`h-3.5 w-3.5 ${autoRefresh ? "animate-pulse" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-sessions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={18} />
            {sessions?.length ?? 0} active session{sessions?.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>Consented contacts with a live or last-known position.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((s) => (
                <SessionRow key={s.inviteId} session={s} onCopy={(t, l) => copyToClipboard(t, l, notify)} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground flex flex-col items-center">
              <div className="bg-muted p-4 rounded-full mb-4">
                <Users size={32} className="opacity-50" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">No active sessions yet</h3>
              <p className="max-w-xs text-sm">
                Sessions appear here as soon as a contact grants consent to your invite.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SessionRow({
  session,
  onCopy,
}: {
  session: Session;
  onCopy: (text: string, label: string) => void;
}) {
  const isOnline = session.status === "active";

  return (
    <div
      className="p-4 border border-border rounded-xl hover:bg-muted/20 transition-colors"
      data-testid={`row-session-${session.inviteId}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{session.toName || "Unknown"}</span>
            <span className="text-muted-foreground text-sm">{session.toPhone}</span>
            <Badge
              variant={isOnline ? "default" : "secondary"}
              className={`text-[10px] ${isOnline ? "bg-emerald-600 text-white" : ""}`}
            >
              {isOnline ? "Live" : "Offline"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1 items-center">
            {session.grantedAt && (
              <span>Granted {format(new Date(session.grantedAt), "MMM d, yyyy 'at' h:mm a")}</span>
            )}
            {session.lastUpdate && (
              <>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span>Last update {format(new Date(session.lastUpdate), "MMM d, h:mm a")}</span>
              </>
            )}
          </div>
          {session.address && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="h-3 w-3 flex-shrink-0" /> {session.address}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {session.consentPageUrl && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => onCopy(session.consentPageUrl!, "Share link")}
            data-testid={`button-copy-share-${session.inviteId}`}
          >
            <Copy className="h-3 w-3" /> Copy Share Link
          </Button>
        )}
        {session.googleMapsLiveLink && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => onCopy(session.googleMapsLiveLink!, "Google Maps live location link")}
              data-testid={`button-copy-maps-${session.inviteId}`}
            >
              <Copy className="h-3 w-3" /> Copy Google Maps Link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => window.open(session.googleMapsLiveLink!, "_blank")}
              data-testid={`button-open-maps-${session.inviteId}`}
            >
              <ExternalLink className="h-3 w-3" /> Open
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
