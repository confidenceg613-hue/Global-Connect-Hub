import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, useRef } from "react";
import {
  useListInvites,
  useCreateInvite,
  getListInvitesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, Users, Shield, Copy, MapPin, ExternalLink, CheckCircle, RefreshCw, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import type { Invite } from "@workspace/api-client-react";
import { ConnectingKitty } from "@/components/invites/ConnectingKitty";

export default function Invites() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [kittyFor, setKittyFor] = useState<string | null>(null);
  const seenAcceptedIdsRef = useRef<Set<number> | null>(null);

  // Listen for AI prefill events (e.g. "send invite to John +234...")
  useEffect(() => {
    const handler = (e: Event) => {
      const { phone: p, name: n } = (e as CustomEvent<{ phone: string; name: string }>).detail;
      if (p) setPhone(p);
      if (n) setName(n);
    };
    window.addEventListener("phonelink:prefill-invite", handler);
    return () => window.removeEventListener("phonelink:prefill-invite", handler);
  }, []);

  const [message, setMessage] = useState(
    "Yo, you gotta check this out… PhoneLink just added a new location thing. I tried it and it's actually really useful. Can I send you the invite real quick?",
  );
  const [consentType, setConsentType] = useState<string>("location");
  const [optIn, setOptIn] = useState(false);
  const [lastCreated, setLastCreated] = useState<Invite | null>(null);

  const { data: invites, isLoading } = useListInvites(
    { userId: userId! },
    {
      query: {
        enabled: !!userId,
        queryKey: getListInvitesQueryKey({ userId: userId! }),
        refetchInterval: 4000, // poll so newly-accepted invites (auto-accept flow) surface quickly
      },
    },
  );

  // Detect an invite flipping to "accepted" and pop the kitty for it.
  useEffect(() => {
    if (!invites) return;
    if (seenAcceptedIdsRef.current === null) {
      // First load: seed with whatever is already accepted so we don't kitty-spam old invites.
      seenAcceptedIdsRef.current = new Set(invites.filter((i) => i.status === "accepted").map((i) => i.id));
      return;
    }
    for (const invite of invites) {
      if (invite.status === "accepted" && !seenAcceptedIdsRef.current.has(invite.id)) {
        seenAcceptedIdsRef.current.add(invite.id);
        setKittyFor(invite.toName || invite.toPhone);
        break; // one at a time
      }
    }
  }, [invites]);

  const createInvite = useCreateInvite();

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phone || !optIn) {
      toast({ title: "Fill all required fields and confirm opt-in", variant: "destructive" });
      return;
    }

    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }

    // Pass the current origin + base path so the server builds a fully-qualified consent URL
    const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const baseUrl = window.location.origin + basePath;

    try {
      const created = await createInvite.mutateAsync({
        data: {
          fromUserId: userId!,
          toPhone: parsedPhone.number,
          toName: name || undefined,
          message,
          consentType: consentType !== "none" ? (consentType as "location" | "notification" | "messaging") : undefined,
          baseUrl,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey({ userId: userId! }) });
      setLastCreated(created);
      // Open WhatsApp with the pre-filled message that already contains the link
      window.open(created.whatsappLink, "_blank");
      toast({ title: "Invite created — WhatsApp opened!" });
      setPhone("");
      setName("");
      setOptIn(false);
    } catch (err: any) {
      // Log for debugging
      console.error("createInvite failed:", err);

      // Try to extract a helpful message from common error shapes
      const serverMessage =
        err?.response?.data?.error || err?.response?.data || err?.message || (err?.data && typeof err.data === 'string' ? err.data : undefined);

      toast({ title: serverMessage ?? "Failed to create invite", variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    const doWrite = () => {
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback for HTTP / older browsers
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
    doWrite().then(() => toast({ title: `${label} copied to clipboard` })).catch(() => {});
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">WhatsApp Invites</h1>
        <p className="text-muted-foreground mt-1">
          Send a trackable link — when your contact clicks it, their location is shared with you.
        </p>
      </div>

      {/* Success banner after creating invite */}
      {lastCreated?.consentPageUrl && (
        <Card className="border-emerald-500/30 bg-emerald-500/10 shadow-none">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-400 mb-1">
                  Invite sent — WhatsApp opened with this consent link:
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background border border-emerald-500/30 rounded px-2 py-1 truncate flex-1 text-emerald-400">
                    {lastCreated.consentPageUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 h-7 text-xs"
                    onClick={() => copyToClipboard(lastCreated.consentPageUrl!, "Link")}
                    data-testid="button-copy-consent-link"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-1">
          <Card className="border-border/60 shadow-sm sticky top-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SiWhatsapp className="text-[#25D366]" />
                New Location Request
              </CardTitle>
              <CardDescription>
                A unique tracking link is embedded in the WhatsApp message.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="toName">Recipient Name (Optional)</Label>
                  <Input
                    id="toName"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-recipient-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">WhatsApp Number *</Label>
                  <PhoneInput
                    international
                    defaultCountry="US"
                    value={phone}
                    onChange={(val) => setPhone(val || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none"
                    data-testid="input-recipient-phone"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consentType">Permission to Request</Label>
                  <Select value={consentType} onValueChange={setConsentType}>
                    <SelectTrigger data-testid="select-consent-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="location">Location</SelectItem>
                      <SelectItem value="notification">Notification</SelectItem>
                      <SelectItem value="messaging">Messaging</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="resize-none"
                    data-testid="textarea-message"
                  />
                  <p className="text-xs text-muted-foreground">
                    The consent link will be appended automatically.
                  </p>
                </div>

                <div className="flex items-start space-x-2 bg-muted/50 p-3 rounded-md">
                  <Checkbox
                    id="optin"
                    checked={optIn}
                    onCheckedChange={(c) => setOptIn(!!c)}
                    data-testid="checkbox-optin"
                  />
                  <label
                    htmlFor="optin"
                    className="text-xs leading-tight text-muted-foreground cursor-pointer"
                  >
                    I confirm the recipient has opted in to receive WhatsApp messages.
                  </label>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white"
                  disabled={createInvite.isPending}
                  data-testid="button-send-invite"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {createInvite.isPending ? "Creating…" : "Send via WhatsApp"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* List */}
        <div className="lg:col-span-2">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={20} />
                Sent Invites
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : invites && invites.length > 0 ? (
                <div className="space-y-4">
                  {invites.map((invite) => (
                    <InviteCard
                      key={invite.id}
                      invite={invite}
                      onCopy={copyToClipboard}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground flex flex-col items-center">
                  <div className="bg-muted p-4 rounded-full mb-4">
                    <Users size={32} className="opacity-50" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-1">No invites yet</h3>
                  <p className="max-w-xs text-sm">
                    Use the form to send your first WhatsApp location request.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {kittyFor && (
        <ConnectingKitty name={kittyFor} onClose={() => setKittyFor(null)} />
      )}
    </div>
  );
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InviteSessionData {
  id: number;
  inviteToken: string;
  sessionToken: string;
  grantedAt?: string | null;
  grantedLatitude?: number | null;
  grantedLongitude?: number | null;
  grantedAddress?: string | null;
  status: "active" | "ended";
  createdAt: string;
}

function InviteCard({
  invite,
  onCopy,
}: {
  invite: Invite;
  onCopy: (text: string, label: string) => void;
}) {
  const [sessionsExpanded, setSessionsExpanded] = useState(false);

  const { data: sessions = [] } = useQuery<InviteSessionData[]>({
    queryKey: ["invite-sessions", invite.token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/invites/by-token/${invite.token}/sessions`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 8000, // poll so new sessions surface while the dashboard is open
  });

  const sessionCount = sessions.length;
  const latestSession = sessions[0] ?? null; // sessions are ordered desc

  // First-session snapshot for the map (the invite's own grantedLatitude/Longitude)
  const hasFirstLocation = invite.grantedLatitude != null && invite.grantedLongitude != null;

  return (
    <div
      className="p-4 border border-border rounded-xl transition-colors hover:bg-muted/10"
      data-testid={`card-invite-${invite.id}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {invite.toName || "Unknown"}
            </span>
            <span className="text-muted-foreground text-sm">{invite.toPhone}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5 items-center">
            <span>{format(new Date(invite.sentAt), "MMM d, yyyy 'at' h:mm a")}</span>
            {invite.consentType && (
              <>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="flex items-center gap-1 text-primary font-medium">
                  <Shield size={11} />
                  {invite.consentType} permission
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Permanent link indicator */}
          <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary">
            <RefreshCw className="h-2.5 w-2.5" />
            Permanent link
          </Badge>
          {/* Session count */}
          {sessionCount > 0 && (
            <Badge className="bg-emerald-600 text-white text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />
              {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
            </Badge>
          )}
        </div>
      </div>

      {/* Consent link row */}
      {invite.consentPageUrl && (
        <div className="flex items-center gap-2 mb-3">
          <code className="text-xs bg-background border rounded px-2 py-1 truncate flex-1 text-muted-foreground">
            {invite.consentPageUrl}
          </code>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 flex-shrink-0"
            onClick={() => onCopy(invite.consentPageUrl!, "Consent link")}
            data-testid={`button-copy-link-${invite.id}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 flex-shrink-0"
            onClick={() => window.open(invite.whatsappLink, "_blank")}
            data-testid={`button-open-wa-${invite.id}`}
          >
            <SiWhatsapp className="text-[#25D366] h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* First-grant location map (always shown if available) */}
      {hasFirstLocation && (
        <div className="border border-emerald-500/20 rounded-xl overflow-hidden mt-2 mb-3">
          <div className="relative w-full" style={{ height: 160 }}>
            <iframe
              title={`First location for invite #${invite.id}`}
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${invite.grantedLongitude! - 0.01},${invite.grantedLatitude! - 0.01},${invite.grantedLongitude! + 0.01},${invite.grantedLatitude! + 0.01}&layer=mapnik&marker=${invite.grantedLatitude},${invite.grantedLongitude}`}
              className="w-full h-full border-0"
              loading="lazy"
              data-testid={`map-invite-${invite.id}`}
            />
          </div>
          <div className="bg-muted/40 px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-mono text-foreground leading-tight">
                  {invite.grantedLatitude!.toFixed(5)}, {invite.grantedLongitude!.toFixed(5)}
                </p>
                {invite.grantedAddress && (
                  <p className="text-xs text-muted-foreground truncate">{invite.grantedAddress}</p>
                )}
                {invite.grantedAt && (
                  <p className="text-xs text-muted-foreground">
                    First session {format(new Date(invite.grantedAt), "MMM d, yyyy")}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 text-xs h-7 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => window.open(`https://www.google.com/maps?q=${invite.grantedLatitude},${invite.grantedLongitude}`, "_blank")}
              data-testid={`button-maps-${invite.id}`}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Maps
            </Button>
          </div>
        </div>
      )}

      {/* Sessions history collapsible */}
      {sessionCount > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setSessionsExpanded((e) => !e)}
          >
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Session history ({sessionCount})
            </span>
            {sessionsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {sessionsExpanded && (
            <div className="divide-y divide-border/40">
              {sessions.map((session, idx) => (
                <div key={session.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${session.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        Session #{sessionCount - idx}
                        {idx === 0 && <span className="ml-1.5 text-emerald-400 font-normal">(latest)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(session.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {session.grantedLatitude != null && session.grantedLongitude != null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-emerald-400"
                        onClick={() => window.open(`https://www.google.com/maps?q=${session.grantedLatitude},${session.grantedLongitude}`, "_blank")}
                      >
                        <MapPin className="h-3 w-3 mr-1" />
                        Map
                      </Button>
                    )}
                    <Badge variant="outline" className={`text-xs h-5 ${session.status === "active" ? "border-emerald-500/30 text-emerald-400" : "text-muted-foreground"}`}>
                      {session.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
