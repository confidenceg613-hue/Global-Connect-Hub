import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
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
import { Send, Users, Shield, Copy, MapPin, ExternalLink, CheckCircle } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import type { Invite } from "@workspace/api-client-react";

export default function Invites() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState(
    "Hi, I'd like you to grant me location access via PhoneLink.",
  );
  const [consentType, setConsentType] = useState<string>("location");
  const [optIn, setOptIn] = useState(false);
  const [lastCreated, setLastCreated] = useState<Invite | null>(null);

  const { data: invites, isLoading } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) } },
  );

  const createInvite = useCreateInvite();

  const handleSendInvite = (e: React.FormEvent) => {
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

    // Pass the current origin so the server builds a fully-qualified consent URL
    const baseUrl = window.location.origin;

    createInvite.mutate(
      {
        data: {
          fromUserId: userId!,
          toPhone: parsedPhone.number,
          toName: name || undefined,
          message,
          consentType: consentType !== "none" ? (consentType as "location" | "notification" | "messaging") : undefined,
          baseUrl,
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey({ userId: userId! }) });
          setLastCreated(created);
          // Open WhatsApp with the pre-filled message that already contains the link
          window.open(created.whatsappLink, "_blank");
          toast({ title: "Invite created — WhatsApp opened!" });
          setPhone("");
          setName("");
          setOptIn(false);
        },
        onError: () => {
          toast({ title: "Failed to create invite", variant: "destructive" });
        },
      },
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: `${label} copied to clipboard` }),
    );
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
        <Card className="border-emerald-200 bg-emerald-50 shadow-none">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-800 mb-1">
                  Invite sent — WhatsApp opened with this consent link:
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-white border border-emerald-200 rounded px-2 py-1 truncate flex-1 text-emerald-700">
                    {lastCreated.consentPageUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-100 h-7 text-xs"
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
                    className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
    </div>
  );
}

function InviteCard({
  invite,
  onCopy,
}: {
  invite: Invite;
  onCopy: (text: string, label: string) => void;
}) {
  const accepted = invite.status === "accepted";

  return (
    <div
      className={`p-4 border rounded-xl transition-colors ${
        accepted ? "border-emerald-200 bg-emerald-50/40" : "border-border hover:bg-muted/20"
      }`}
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
        <Badge
          variant={
            accepted ? "default" : invite.status === "declined" ? "destructive" : "secondary"
          }
          className={`capitalize flex-shrink-0 ${accepted ? "bg-emerald-600" : ""}`}
        >
          {accepted ? (
            <><CheckCircle className="h-3 w-3 mr-1" /> Granted</>
          ) : (
            invite.status
          )}
        </Badge>
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

      {/* Location granted */}
      {accepted && invite.grantedLatitude != null && invite.grantedLongitude != null && (
        <div className="border border-emerald-200 rounded-xl overflow-hidden mt-2">
          {/* Map embed */}
          <div className="relative w-full" style={{ height: 200 }}>
            <iframe
              title={`Location for invite #${invite.id}`}
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${invite.grantedLongitude - 0.01},${invite.grantedLatitude - 0.01},${invite.grantedLongitude + 0.01},${invite.grantedLatitude + 0.01}&layer=mapnik&marker=${invite.grantedLatitude},${invite.grantedLongitude}`}
              className="w-full h-full border-0"
              loading="lazy"
              data-testid={`map-invite-${invite.id}`}
            />
          </div>

          {/* Coords + actions bar */}
          <div className="bg-white px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-mono font-semibold text-slate-700 leading-tight">
                  {invite.grantedLatitude.toFixed(5)}, {invite.grantedLongitude.toFixed(5)}
                </p>
                {invite.grantedAddress && (
                  <p className="text-xs text-slate-500 truncate">
                    {invite.grantedAddress}
                  </p>
                )}
                {invite.grantedAt && (
                  <p className="text-xs text-muted-foreground">
                    Granted {format(new Date(invite.grantedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 text-xs h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              onClick={() =>
                window.open(
                  `https://www.google.com/maps?q=${invite.grantedLatitude},${invite.grantedLongitude}`,
                  "_blank",
                )
              }
              data-testid={`button-maps-${invite.id}`}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in Maps
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
