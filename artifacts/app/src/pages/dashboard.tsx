import { useAuth } from "@/hooks/use-auth";
import { useGetUser, useGetConsentSummary, useListInvites, getGetUserQueryKey, getGetConsentSummaryQueryKey, getListInvitesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ShieldAlert, ShieldCheck, MapPin, Bell, MessageSquare, Send, Map, Users, Clock, ArrowRight, Activity } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

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
      <div className="space-y-8 animate-in fade-in duration-300">
        <div className="space-y-2">
          <div className="h-8 w-56 bg-muted animate-pulse rounded-lg" />
          <div className="h-4 w-72 bg-muted/60 animate-pulse rounded-md" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-28 bg-muted animate-pulse rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-muted animate-pulse rounded-2xl" />
          <div className="h-64 bg-muted animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Location Consent",
      icon: MapPin,
      stat: summary?.location,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
    {
      title: "Notifications",
      icon: Bell,
      stat: summary?.notification,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      border: "border-violet-500/20",
    },
    {
      title: "Messaging",
      icon: MessageSquare,
      stat: summary?.messaging,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
    },
  ];

  const quickActions = [
    { label: "Live Map",     icon: Map,    href: "/live-map",   color: "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border-indigo-500/20" },
    { label: "Send Invite",  icon: Users,  href: "/invites",    color: "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20" },
    { label: "Activity",     icon: Activity, href: "/activity", color: "bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border-violet-500/20" },
    { label: "Permissions",  icon: ShieldCheck, href: "/permissions", color: "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20" },
  ];

  const totalGrants = (summary?.location?.granted ?? 0) + (summary?.notification?.granted ?? 0) + (summary?.messaging?.granted ?? 0);
  const totalRequests = (summary?.location?.total ?? 0) + (summary?.notification?.total ?? 0) + (summary?.messaging?.total ?? 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-400">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium mb-1">{getGreeting()}</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {user?.name?.split(" ")[0] ?? "Welcome"} 👋
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalGrants} active consent{totalGrants !== 1 ? "s" : ""} across {totalRequests} total requests
          </p>
        </div>
        <Link href="/live-map">
          <Button size="sm" className="hidden sm:flex gap-2 bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20">
            <Map size={15} />
            Live Map
          </Button>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {quickActions.map(action => (
          <Link key={action.href} href={action.href}>
            <div className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all cursor-pointer ${action.color}`}>
              <action.icon size={20} />
              <span className="text-xs font-semibold">{action.label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Consent stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((card, idx) => {
          const granted = card.stat?.granted ?? 0;
          const total = card.stat?.total ?? 0;
          const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
          return (
            <Card key={idx} className="border-border/50 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {card.title}
                </CardTitle>
                <div className={`${card.bg} ${card.border} ${card.color} p-2 rounded-lg border`}>
                  <card.icon size={14} />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-bold text-foreground">{granted}</span>
                  <span className="text-sm text-muted-foreground">/ {total} active</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-3">
                  <div className={`h-full rounded-full ${card.color.replace("text-", "bg-")}`}
                    style={{ width: `${pct}%`, transition: "width 0.8s ease" }} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {card.stat?.revoked ? (
                    <Badge variant="secondary" className="text-[10px] font-normal gap-1">
                      <ShieldAlert size={10} className="text-destructive" />{card.stat.revoked} revoked
                    </Badge>
                  ) : null}
                  {card.stat?.denied ? (
                    <Badge variant="secondary" className="text-[10px] font-normal gap-1">
                      <Shield size={10} className="text-muted-foreground" />{card.stat.denied} denied
                    </Badge>
                  ) : null}
                  {!card.stat?.revoked && !card.stat?.denied && (
                    <Badge variant="secondary" className="text-[10px] font-normal text-emerald-400">
                      All clear
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invites */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Invites</CardTitle>
              <CardDescription>Latest WhatsApp invitations sent</CardDescription>
            </div>
            <Link href="/invites">
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
                View all <ArrowRight size={12} />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {invites && invites.length > 0 ? (
              <div className="space-y-1">
                {invites.slice(0, 5).map(invite => (
                  <div key={invite.id} className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                        <Send size={13} className="text-indigo-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{invite.toName || invite.toPhone}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock size={10} />
                          {format(new Date(invite.sentAt), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <Badge variant={
                      invite.status === "accepted" ? "default" :
                      invite.status === "declined" ? "destructive" : "secondary"
                    } className="text-[10px]">
                      {invite.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <Send size={20} className="opacity-30" />
                </div>
                <p className="text-sm font-medium">No invites yet</p>
                <p className="text-xs mt-1 text-muted-foreground/70">Send a location invite via WhatsApp</p>
                <Link href="/invites">
                  <Button size="sm" variant="outline" className="mt-4 text-xs">Send First Invite</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Identity */}
        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-indigo-500/5 to-transparent">
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>Your registered account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-background/60 border border-border/40">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {user?.name?.charAt(0).toUpperCase() ?? "?"}
                </div>
                <div>
                  <p className="font-semibold text-foreground">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.fullPhone}</p>
                </div>
                <Badge variant="outline" className="ml-auto text-xs">{user?.countryIso}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-background/60 border border-border/40">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Member Since</p>
                  <p className="text-sm font-semibold text-foreground">
                    {user?.createdAt ? format(new Date(user.createdAt), "MMM yyyy") : "—"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-background/60 border border-border/40">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Total Invites</p>
                  <p className="text-sm font-semibold text-foreground">{invites?.length ?? 0}</p>
                </div>
              </div>
              <Link href="/profile">
                <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                  Manage Profile <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
