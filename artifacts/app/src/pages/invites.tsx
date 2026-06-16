import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { 
  useListInvites, 
  useCreateInvite, 
  useGenerateWhatsappLink,
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
import { Send, Users, Shield, Link as LinkIcon } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";

export default function Invites() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("Hi, I'd like to invite you to connect on PhoneLink securely.");
  const [consentType, setConsentType] = useState<string>("none");
  const [optIn, setOptIn] = useState(false);
  
  const { data: invites, isLoading } = useListInvites({ userId: userId! }, {
    query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) }
  });

  const createInvite = useCreateInvite();
  const generateLink = useGenerateWhatsappLink();

  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phone || !optIn) {
      toast({ title: "Please fill required fields and confirm opt-in", variant: "destructive" });
      return;
    }

    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }

    // Must be digits only for WA
    const digitsOnlyPhone = parsedPhone.number.replace(/\+/g, '');

    createInvite.mutate({
      data: {
        fromUserId: userId!,
        toPhone: parsedPhone.number,
        toName: name,
        message,
        consentType: consentType !== "none" ? (consentType as any) : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey({ userId: userId! }) });
        
        generateLink.mutate({
          data: {
            phoneNumber: digitsOnlyPhone,
            message
          }
        }, {
          onSuccess: (data) => {
            window.open(data.link, '_blank');
            toast({ title: "Invite created and WhatsApp opened!" });
            setPhone("");
            setName("");
            setOptIn(false);
          }
        });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">WhatsApp Invites</h1>
          <p className="text-muted-foreground mt-1">Invite connections securely via WhatsApp.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <Card className="border-border/60 shadow-sm sticky top-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SiWhatsapp className="text-[#25D366]" />
                New Invite
              </CardTitle>
              <CardDescription>Compose a secure WhatsApp invitation.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="toName">Recipient Name (Optional)</Label>
                  <Input 
                    id="toName" 
                    placeholder="John Doe" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number *</Label>
                  <PhoneInput
                    international
                    defaultCountry="US"
                    value={phone}
                    onChange={(val) => setPhone(val || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consentType">Request Permission (Optional)</Label>
                  <Select value={consentType} onValueChange={setConsentType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select permission type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No permission requested</SelectItem>
                      <SelectItem value="location">Location</SelectItem>
                      <SelectItem value="notification">Notification</SelectItem>
                      <SelectItem value="messaging">Messaging</SelectItem>
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
                  />
                </div>

                <div className="flex items-start space-x-2 bg-muted/50 p-3 rounded-md">
                  <Checkbox 
                    id="optin" 
                    checked={optIn}
                    onCheckedChange={(c) => setOptIn(!!c)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor="optin"
                      className="text-xs font-medium leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      I confirm the recipient has opted in to receive WhatsApp messages.
                    </label>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white"
                  disabled={createInvite.isPending || generateLink.isPending}
                >
                  <Send className="mr-2" size={16} />
                  Send on WhatsApp
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="border-border/60 shadow-sm h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={20} />
                Sent Invites
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg"></div>)}
                </div>
              ) : invites && invites.length > 0 ? (
                <div className="space-y-4">
                  {invites.map(invite => (
                    <div key={invite.id} className="p-4 border border-border rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{invite.toName || 'Unknown'}</span>
                          <span className="text-muted-foreground text-sm">{invite.toPhone}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground items-center">
                          <span>Sent {format(new Date(invite.sentAt), 'MMM d, yyyy')}</span>
                          {invite.consentType && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-border"></span>
                              <span className="flex items-center text-primary font-medium">
                                <Shield size={12} className="mr-1" />
                                Requested: {invite.consentType}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto border-t md:border-0 pt-3 md:pt-0 border-border">
                        <Badge 
                          variant={
                            invite.status === 'accepted' ? 'default' : 
                            invite.status === 'declined' ? 'destructive' : 'secondary'
                          }
                          className="capitalize"
                        >
                          {invite.status}
                        </Badge>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => window.open(invite.whatsappLink, '_blank')}
                          className="text-xs"
                        >
                          <LinkIcon size={14} className="mr-1.5" />
                          View Link
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground flex flex-col items-center justify-center">
                  <div className="bg-muted p-4 rounded-full mb-4">
                    <Users size={32} className="opacity-50" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-1">No invites yet</h3>
                  <p className="max-w-xs">You haven't sent any WhatsApp invitations yet. Use the form to invite your first connection.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
