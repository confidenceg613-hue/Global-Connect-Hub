import { useAuth } from "@/hooks/use-auth";
import { useGetUser, useGetConsentSummary, getGetUserQueryKey, getGetConsentSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Bell, MessageSquare, Map, Users, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { CSSProperties, ComponentType } from "react";
import { Dove, FeatherShape, Frond } from "@/components/golden-bird";

type ActionIcon = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string; style?: CSSProperties }>;

// TODO(dashboard-redesign): visual theme per the approved mock — static art, no animations.

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── (Feather backdrop moved to golden-bird.tsx — rendered app-wide by AppLayout)

// ── Sky action card (doves + clouds + fronds behind the icon/label) ──────────
function SkyActionCard({ href, label, icon: Icon, flip }: {
  href: string;
  label: string;
  icon: ActionIcon;
  flip?: boolean;
}) {
  return (
    <Link href={href} className="block">
      <div
        className="relative h-32 overflow-hidden rounded-2xl border border-amber-200/80"
        style={{
          background: "linear-gradient(180deg, #7fb0d8 0%, #a7c4e0 42%, #e8c9a2 78%, #f3dcae 100%)",
          boxShadow: "0 0 18px rgba(247,199,111,0.55), 0 0 42px rgba(247,199,111,0.28), inset 0 0 22px rgba(255,240,210,0.35)",
        }}
      >
        {/* soft cloud bands */}
        <div className="absolute left-0 right-0" style={{
          bottom: "18%",
          height: "34%",
          background: "radial-gradient(ellipse 62% 62% at 22% 72%, rgba(255,248,235,0.85) 0%, rgba(255,248,235,0) 70%), radial-gradient(ellipse 55% 58% at 74% 66%, rgba(255,244,224,0.8) 0%, rgba(255,244,224,0) 72%), radial-gradient(ellipse 70% 60% at 48% 86%, rgba(255,250,238,0.9) 0%, rgba(255,250,238,0) 70%)",
        }} />
        <div className="absolute left-0 right-0" style={{
          top: "12%",
          height: "22%",
          background: "radial-gradient(ellipse 55% 70% at 70% 45%, rgba(255,250,240,0.5) 0%, rgba(255,250,240,0) 70%)",
        }} />

        {/* pampas fronds in the lower corners */}
        <Frond className="absolute" style={{ left: "-7%", bottom: "-12%", width: "42%", height: "72%", opacity: 0.65 }} />
        <Frond className="absolute" style={{ right: "-6%", bottom: "-14%", width: "38%", height: "66%", opacity: 0.55 }} flip />

        {/* doves */}
        <Dove className="absolute" style={{ left: "8%", bottom: "22%", width: "26%", height: "30%" }} />
        <Dove className="absolute" style={{ right: "16%", top: "12%", width: "13%", height: "15%", opacity: 0.9 }} flip />
        <Dove className="absolute" style={{ left: "44%", top: "16%", width: "9%", height: "10%", opacity: 0.75 }} />
        {!flip && <Dove className="absolute" style={{ right: "4%", bottom: "30%", width: "12%", height: "14%", opacity: 0.85 }} flip />}

        {/* label + icon, centered */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5">
          <Icon size={26} strokeWidth={1.6} className="text-amber-50" style={{ filter: "drop-shadow(0 1px 6px rgba(60,35,5,0.55))" }} />
          <span
            className="px-2 text-center text-[15px] font-bold tracking-tight text-amber-50"
            style={{ textShadow: "0 1px 8px rgba(60,35,5,0.65), 0 0 2px rgba(60,35,5,0.4)" }}
          >
            {label}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Stat card (LOCATION CONSENT / NOTIFICATIONS / MESSAGING) ─────────────────
function StatCard({ title, icon: Icon, stat }: {
  title: string;
  icon: ActionIcon;
  stat?: { granted: number; total: number; revoked?: number | null; denied?: number | null };
}) {
  const granted = stat?.granted ?? 0;
  const total = stat?.total ?? 0;
  const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
  return (
    <Card
      className="relative overflow-hidden rounded-2xl border-amber-200/15"
      style={{
        background: "linear-gradient(150deg, rgba(96,66,28,0.5) 0%, rgba(70,48,20,0.42) 45%, rgba(48,34,16,0.5) 100%)",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,220,160,0.14)",
        backdropFilter: "blur(4px)",
      }}
    >
      <FeatherShape left={62} top={8} size={110} rotate={-50} opacity={0.13} flip />
      <FeatherShape left={8} top={55} size={80} rotate={35} opacity={0.09} blur={1} />
      <CardHeader className="relative z-10 flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-[13px] font-semibold uppercase tracking-[0.14em] text-amber-100/70">
          {title}
        </CardTitle>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/50"
          style={{ background: "linear-gradient(150deg, rgba(255,214,140,0.16), rgba(120,80,30,0.25))", boxShadow: "0 0 10px rgba(247,199,111,0.35)" }}
        >
          <Icon size={15} className="text-amber-300" />
        </div>
      </CardHeader>
      <CardContent className="relative z-10 pt-0">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold leading-none text-amber-50" style={{ textShadow: "0 0 14px rgba(247,199,111,0.35)" }}>
            {granted}
          </span>
          <span className="text-sm text-amber-100/60">/ {total} active</span>
        </div>
        <div className="mb-3 mt-3 h-1.5 overflow-hidden rounded-full bg-black/30">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: "linear-gradient(90deg, #f6c56f, #fbe4ae)", boxShadow: "0 0 8px rgba(247,199,111,0.6)" }}
          />
        </div>
        {stat?.revoked || stat?.denied ? (
          <div className="flex flex-wrap gap-2">
            {stat?.revoked ? (
              <Badge variant="secondary" className="border-amber-200/20 bg-black/25 text-[10px] font-normal text-amber-100/80">
                {stat.revoked} revoked
              </Badge>
            ) : null}
            {stat?.denied ? (
              <Badge variant="secondary" className="border-amber-200/20 bg-black/25 text-[10px] font-normal text-amber-100/80">
                {stat.denied} denied
              </Badge>
            ) : null}
          </div>
        ) : (
          <Badge variant="secondary" className="border-emerald-300/25 bg-emerald-950/40 text-[11px] font-normal text-emerald-300">
            All clear
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { userId } = useAuth();
  const { data: user } = useGetUser(userId!, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId!) }
  });
  const { data: summary } = useGetConsentSummary({
    query: { queryKey: getGetConsentSummaryQueryKey() }
  });

  const statCards = [
    { title: "Location Consent", icon: MapPin,       stat: summary?.location },
    { title: "Notifications",    icon: Bell,          stat: summary?.notification },
    { title: "Messaging",        icon: MessageSquare, stat: summary?.messaging },
  ];

  const quickActions = [
    { label: "Live Map",       icon: Map,          href: "/live-map",    flip: false },
    { label: "Send Invite",    icon: Users,        href: "/invites",     flip: true },
    { label: "Guardian Brief", icon: Sparkles,     href: "/guardian",    flip: false },
    { label: "Permissions",    icon: ShieldCheck,  href: "/permissions", flip: true },
  ];

  const totalGrants = (summary?.location?.granted ?? 0) + (summary?.notification?.granted ?? 0) + (summary?.messaging?.granted ?? 0);
  const totalRequests = (summary?.location?.total ?? 0) + (summary?.notification?.total ?? 0) + (summary?.messaging?.total ?? 0);

  return (
    <div className="relative mobile-screen-enter">

      <div className="relative z-10 space-y-7 pb-6">
        {/* Header — the golden bird in the corner is the menu (rendered by AppLayout) */}
        <div>
          <p className="text-[15px] font-medium text-amber-100/70">{getGreeting()}</p>
          <h1 className="mt-1 text-[34px] font-extrabold leading-tight tracking-tight text-amber-50">
            {user?.name?.split(" ")[0] ?? "Welcome"} 👋
          </h1>
          <p className="mt-0.5 text-[15px] text-amber-100/60">
            {totalGrants} active consents across {totalRequests} total requests
          </p>
        </div>

        {/* Quick actions — sky cards */}
        <div className="grid grid-cols-2 gap-3.5">
          {quickActions.map(action => (
            <SkyActionCard key={action.href} href={action.href} label={action.label} icon={action.icon} flip={action.flip} />
          ))}
        </div>

        {/* Stat cards */}
        <div className="space-y-4">
          {statCards.map(card => (
            <StatCard key={card.title} title={card.title} icon={card.icon} stat={card.stat} />
          ))}
        </div>
      </div>
    </div>
  );
}
