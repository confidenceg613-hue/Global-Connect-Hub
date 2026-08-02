import { useAuth } from "@/hooks/use-auth";
import { useGetUser, useGetConsentSummary, useListInvites, getGetUserQueryKey, getGetConsentSummaryQueryKey, getListInvitesQueryKey } from "@workspace/api-client-react";
import type { Invite } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ShieldAlert, ShieldCheck, MapPin, Bell, MessageSquare, Send, Map, Users, Clock, ArrowRight, Activity, Sparkles, Radio, TrendingUp } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useEffect, useState, useCallback, useRef } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Floating feathers animation ───────────────────────────────────────────────
const FEATHER_PATHS = [
  "M12 2 C10 6 6 8 4 12 C6 14 8 16 12 22 C16 16 18 14 20 12 C18 8 14 6 12 2 Z",
  "M12 1 C9 5 5 9 4 14 C6 16 9 18 12 23 C15 18 18 16 20 14 C19 9 15 5 12 1 Z",
  "M12 0 C8 4 4 7 3 13 C5 15 8 17 12 22 C16 17 19 15 21 13 C20 7 16 4 12 0 Z",
];

function FeatherDrift() {
  const feathers = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 12,
    duration: 10 + Math.random() * 14,
    size: 10 + Math.random() * 16,
    opacity: 0.06 + Math.random() * 0.12,
    rotate: Math.random() * 360,
    path: FEATHER_PATHS[i % FEATHER_PATHS.length],
    drift: (Math.random() - 0.5) * 60,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      <style>{`
        @keyframes featherFall {
          0%   { transform: translateY(-40px) translateX(0) rotate(var(--fr)); opacity: 0; }
          10%  { opacity: var(--fo); }
          90%  { opacity: var(--fo); }
          100% { transform: translateY(calc(100% + 40px)) translateX(var(--fd)) rotate(calc(var(--fr) + 180deg)); opacity: 0; }
        }
      `}</style>
      {feathers.map(f => (
        <svg
          key={f.id}
          viewBox="0 0 24 24"
          width={f.size}
          height={f.size}
          style={{
            position: "absolute",
            left: `${f.x}%`,
            top: "-40px",
            ["--fr" as string]: `${f.rotate}deg`,
            ["--fo" as string]: f.opacity,
            ["--fd" as string]: `${f.drift}px`,
            animation: `featherFall ${f.duration}s ${f.delay}s linear infinite`,
            fill: "rgb(245 158 11 / 0.7)",
          }}
        >
          <path d={f.path} />
          <line x1="12" y1="2" x2="12" y2="22" stroke="rgb(245 158 11 / 0.4)" strokeWidth="0.5" />
        </svg>
      ))}
    </div>
  );
}

// ── Per-contact location stats ────────────────────────────────────────────────
interface ContactStats {
  inviteId: number;
  latestPing: { lat: number; lng: number; address?: string | null; createdAt: string } | null;
  totalPings: number;
  loading: boolean;
}

function useTrackingStats(invites: Invite[]) {
  const [stats, setStats] = useState<Record<number, ContactStats>>({});
  const fetchedRef = useRef<Set<number>>(new Set());

  const fetchContact = useCallback(async (invite: Invite) => {
    if (fetchedRef.current.has(invite.id)) return;
    fetchedRef.current.add(invite.id);

    setStats(prev => ({ ...prev, [invite.id]: { inviteId: invite.id, latestPing: null, totalPings: 0, loading: true } }));

    try {
      const token = invite.token;
      const [latestRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/api/location/latest/${token}`),
        fetch(`${API_BASE}/api/location/history/${token}?limit=5000`),
      ]);

      const latest = latestRes.ok ? await latestRes.json() : null;
      const history = historyRes.ok ? await historyRes.json() : [];

      setStats(prev => ({
        ...prev,
        [invite.id]: {
          inviteId: invite.id,
          latestPing: latest,
          totalPings: Array.isArray(history) ? history.length : 0,
          loading: false,
        },
      }));
    } catch {
      setStats(prev => ({ ...prev, [invite.id]: { inviteId: invite.id, latestPing: null, totalPings: 0, loading: false } }));
    }
  }, []);

  useEffect(() => {
    const accepted = invites.filter(i => i.status === "accepted" && i.consentType === "location");
    accepted.forEach(fetchContact);
  }, [invites, fetchContact]);

  return stats;
}

// ── Tracking board ────────────────────────────────────────────────────────────
function TrackingBoard({ invites }: { invites: Invite[] }) {
  const tracked = invites.filter(i => i.status === "accepted" && i.consentType === "location");
  const stats = useTrackingStats(tracked);

  // frequency badge colour
  const freqColor = (n: number) =>
    n >= 500 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : n >= 100 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : n >= 20  ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
    : "text-muted-foreground bg-muted/40 border-border/40";

  return (
    <Card className="relative border-amber-500/20 shadow-lg shadow-amber-500/5 overflow-hidden">
      <FeatherDrift />

      {/* Header */}
      <CardHeader className="relative z-10 pb-3 border-b border-amber-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <TrendingUp size={16} className="text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base text-foreground">Field Intelligence Board</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Live tracking analytics for all consented contacts
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-emerald-400 font-semibold uppercase tracking-wider">Live</span>
          </div>
        </div>

        {/* Summary row */}
        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users size={12} className="text-amber-400" />
            <span><strong className="text-foreground">{tracked.length}</strong> tracked</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity size={12} className="text-amber-400" />
            <span>
              <strong className="text-foreground">
                {Object.values(stats).reduce((s, c) => s + c.totalPings, 0).toLocaleString()}
              </strong> total pings
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative z-10 p-0">
        {tracked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
              <MapPin size={22} className="text-amber-400/50" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No tracked contacts yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
              Send a location invite and wait for the contact to grant access.
            </p>
            <Link href="/invites">
              <Button size="sm" variant="outline" className="mt-4 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                Send Invite
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="grid grid-cols-[2fr_1.4fr_1fr_0.7fr] gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/20">
              {["CONTACT", "LAST SEEN", "FREQUENCY", "STATUS"].map(h => (
                <span key={h} className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">{h}</span>
              ))}
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/20">
              {tracked.map((invite, idx) => {
                const s = stats[invite.id];
                const name = invite.toName || invite.toPhone;
                const initial = (invite.toName?.[0] ?? invite.toPhone?.[0] ?? "?").toUpperCase();
                const isLive = s?.latestPing != null;
                const lastSeen = s?.latestPing?.createdAt;
                const isRecent = lastSeen ? Date.now() - new Date(lastSeen).getTime() < 10 * 60 * 1000 : false;

                const avatarColors = [
                  "from-amber-500 to-amber-700",
                  "from-yellow-500 to-amber-600",
                  "from-orange-500 to-amber-600",
                  "from-amber-600 to-yellow-700",
                ][idx % 4];

                return (
                  <div key={invite.id} className="grid grid-cols-[2fr_1.4fr_1fr_0.7fr] gap-2 items-center px-4 py-3 hover:bg-amber-500/5 transition-colors group">
                    {/* Contact */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarColors} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{name}</p>
                        {s?.latestPing?.address && (
                          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                            <MapPin size={8} className="shrink-0" />
                            {s.latestPing.address}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Last seen */}
                    <div className="min-w-0">
                      {s?.loading ? (
                        <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                      ) : lastSeen ? (
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {format(new Date(lastSeen), "MMM d, yyyy")}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock size={8} className="shrink-0" />
                            {format(new Date(lastSeen), "HH:mm:ss")}
                            <span className="text-muted-foreground/50 ml-1">
                              ({formatDistanceToNow(new Date(lastSeen), { addSuffix: true })})
                            </span>
                          </p>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/50">No data yet</span>
                      )}
                    </div>

                    {/* Frequency */}
                    <div>
                      {s?.loading ? (
                        <div className="h-5 w-14 bg-muted animate-pulse rounded-full" />
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border w-fit ${freqColor(s?.totalPings ?? 0)}`}>
                            <Radio size={9} />
                            {(s?.totalPings ?? 0).toLocaleString()} pings
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      {s?.loading ? (
                        <div className="h-4 w-12 bg-muted animate-pulse rounded-full" />
                      ) : isRecent ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-[11px] text-emerald-400 font-semibold">Live</span>
                        </div>
                      ) : isLive ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <span className="text-[11px] text-amber-400 font-semibold">Active</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                          <span className="text-[11px] text-muted-foreground/50">Dark</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-border/20 flex justify-end">
              <Link href="/location-history">
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground hover:text-amber-400">
                  Full History <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────
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
        <div className="h-72 bg-muted animate-pulse rounded-2xl" />
      </div>
    );
  }

  const statCards = [
    {
      title: "Location Consent",
      icon: MapPin,
      stat: summary?.location,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
    {
      title: "Notifications",
      icon: Bell,
      stat: summary?.notification,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
    },
    {
      title: "Messaging",
      icon: MessageSquare,
      stat: summary?.messaging,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
    },
  ];

  const quickActions = [
    { label: "Live Map",       icon: Map,         href: "/live-map",   color: "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20" },
    { label: "Send Invite",    icon: Users,        href: "/invites",    color: "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border-yellow-500/20" },
    { label: "Guardian Brief", icon: Sparkles,     href: "/guardian",   color: "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/20" },
    { label: "Permissions",    icon: ShieldCheck,  href: "/permissions",color: "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border-amber-400/30" },
  ];

  const totalGrants = (summary?.location?.granted ?? 0) + (summary?.notification?.granted ?? 0) + (summary?.messaging?.granted ?? 0);
  const totalRequests = (summary?.location?.total ?? 0) + (summary?.notification?.total ?? 0) + (summary?.messaging?.total ?? 0);

  return (
    <div className="space-y-8 mobile-screen-enter">
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
      <div className="dashboard-action-grid grid grid-cols-2 sm:grid-cols-4 gap-3">
        {quickActions.map(action => (
          <Link key={action.href} href={action.href} className="block">
            <div className={`dashboard-action flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-colors cursor-pointer ${action.color}`}>
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
              <CardDescription>Latest SMS invitations sent</CardDescription>
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
                <p className="text-xs mt-1 text-muted-foreground/70">Send a location invite via SMS</p>
                <Link href="/invites">
                  <Button size="sm" variant="outline" className="mt-4 text-xs">Send First Invite</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Identity */}
        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-amber-500/5 to-transparent">
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>Your registered account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-background/60 border border-border/40">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
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

      {/* Field Intelligence Board */}
      <TrackingBoard invites={invites ?? []} />
    </div>
  );
}
