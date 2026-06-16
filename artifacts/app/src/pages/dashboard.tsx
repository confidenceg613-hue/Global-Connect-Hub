import { useAuth } from "@/hooks/use-auth";
import { useGetUser, useGetConsentSummary, useListInvites, getGetUserQueryKey, getGetConsentSummaryQueryKey, getListInvitesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert, ShieldCheck, MapPin, Bell, MessageSquare, Send } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { userId } = useAuth();
  
  const { data: user, isLoading: userLoading } = useGetUser(userId!, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId!) }
  });
  
  const { data: summary, isLoading: summaryLoading } = useGetConsentSummary({
    query: { queryKey: getGetConsentSummaryQueryKey() }
  });

  const { data: invites, isLoading: invitesLoading } = useListInvites({ userId: userId! }, {
    query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) }
  });

  if (userLoading || summaryLoading || invitesLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl"></div>)}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Location",
      icon: MapPin,
      stat: summary?.location,
      color: "text-blue-500",
      bg: "bg-blue-50 dark:bg-blue-950"
    },
    {
      title: "Notifications",
      icon: Bell,
      stat: summary?.notification,
      color: "text-purple-500",
      bg: "bg-purple-50 dark:bg-purple-950"
    },
    {
      title: "Messaging",
      icon: MessageSquare,
      stat: summary?.messaging,
      color: "text-green-500",
      bg: "bg-green-50 dark:bg-green-950"
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-muted-foreground mt-1">Here is the overview of your consent infrastructure.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((card, idx) => (
          <Card key={idx} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title} Consent
              </CardTitle>
              <div className={`${card.bg} ${card.color} p-2 rounded-md`}>
                <card.icon size={16} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.stat?.granted || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Active grants out of {card.stat?.total || 0} total requests
              </p>
              
              <div className="mt-4 flex gap-2">
                {card.stat?.revoked ? (
                  <Badge variant="secondary" className="text-xs font-normal">
                    <ShieldAlert size={12} className="mr-1 text-destructive" />
                    {card.stat.revoked} revoked
                  </Badge>
                ) : null}
                {card.stat?.denied ? (
                  <Badge variant="secondary" className="text-xs font-normal">
                    <Shield size={12} className="mr-1 text-muted-foreground" />
                    {card.stat.denied} denied
                  </Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Invites</CardTitle>
            <CardDescription>Latest WhatsApp invitations sent</CardDescription>
          </CardHeader>
          <CardContent>
            {invites && invites.length > 0 ? (
              <div className="space-y-4">
                {invites.slice(0, 5).map(invite => (
                  <div key={invite.id} className="flex items-center justify-between border-b border-border/50 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 text-primary p-2 rounded-full">
                        <Send size={16} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{invite.toName || invite.toPhone}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(invite.sentAt), 'MMM d, yyyy')}</p>
                      </div>
                    </div>
                    <Badge variant={
                      invite.status === 'accepted' ? 'default' : 
                      invite.status === 'declined' ? 'destructive' : 'secondary'
                    }>
                      {invite.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Send size={32} className="mx-auto mb-3 opacity-20" />
                <p>No invites sent yet</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card className="border-border/60 shadow-sm bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <CardTitle>Identity Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Full Name</p>
                <p className="font-semibold text-foreground">{user?.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Registered Phone</p>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{user?.fullPhone}</p>
                  <Badge variant="outline" className="bg-white/50">{user?.countryIso}</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Member Since</p>
                <p className="font-semibold text-foreground">
                  {user?.createdAt ? format(new Date(user.createdAt), 'MMMM d, yyyy') : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
