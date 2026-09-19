import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { AccountSwitcher } from "@/components/layout/AccountSwitcher";
import {
  ShieldCheck, LayoutDashboard, Users, UserCircle, Menu,
  Navigation, Clock, Map, Bell, BellOff, BellRing, Camera, Settings,
  Activity as ActivityIcon, Flag, ChevronRight, Radio, Globe,
  ShieldAlert, Siren, Archive, Info, TrendingUp, Layers, Library, Brain, Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { NotificationPanel, useNotificationCount } from "@/components/notification-panel";
import { FeatherBackdrop } from "@/components/golden-bird";

import { API_BASE as API_BASE_URL } from "@/lib/api-base";
const API_BASE = API_BASE_URL;
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  "BGsFFaTA-uRJu2LqW7spIXSkgaUGCfgy3eckDbxffUJ7N80C5NO0V1jhETymchIu4RWw8MHqgmBYEIogR84yhX0";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

type NotifState = "unsupported" | "default" | "granted" | "denied" | "loading";

function useNotificationBell(userId: number | null) {
  const { toast } = useToast();
  const [state, setState] = useState<NotifState>("default");

  const refreshState = useCallback(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) setState("unsupported");
    else setState(Notification.permission as NotifState);
  }, []);

  useEffect(() => {
    refreshState();
    const onVisibility = () => { if (document.visibilityState === "visible") refreshState(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshState]);

  const subscribe = useCallback(async () => {
    if (!userId) { toast({ title: "Sign in first to enable notifications" }); return; }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast({ title: "Notifications not supported on this device", variant: "destructive" }); return;
    }
    if (Notification.permission === "denied") {
      toast({ title: "Notifications blocked", description: "Open browser settings to allow notifications.", variant: "destructive" }); return;
    }
    if (Notification.permission === "granted") {
      try {
        const base = import.meta.env.BASE_URL;
        const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
        });
        const p256dh = sub.getKey("p256dh"); const auth = sub.getKey("auth");
        if (p256dh && auth) {
          await fetch(`${API_BASE}/api/push/subscribe`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, endpoint: sub.endpoint, keys: {
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            }}),
          });
        }
        toast({ title: "🔔 Notifications active", description: "Push subscription refreshed." });
      } catch { toast({ title: "Could not refresh push subscription", variant: "destructive" }); }
      setState("granted"); return;
    }
    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      setState(permission as NotifState);
      if (permission !== "granted") {
        toast({ title: "Notifications not enabled", description: "You can enable them in browser settings.", variant: "destructive" }); return;
      }
      const base = import.meta.env.BASE_URL;
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
      const p256dh = sub.getKey("p256dh"); const auth = sub.getKey("auth");
      if (p256dh && auth) {
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, endpoint: sub.endpoint, keys: {
            auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
            p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
          }}),
        });
      }
      toast({ title: "🔔 Notifications enabled", description: "You'll get alerts for location updates." });
    } catch {
      setState(Notification.permission as NotifState);
      toast({ title: "Could not enable notifications", variant: "destructive" });
    }
  }, [userId, toast]);

  return { state, subscribe };
}

interface AppLayoutProps { children: React.ReactNode; }

const NAV_SECTIONS = [
  {
    label: "MAIN",
    items: [
      { href: "/dashboard",  label: "Overview",     icon: LayoutDashboard },
      { href: "/live-map",   label: "Live Map",      icon: Map },
      { href: "/activity",   label: "Activity",      icon: ActivityIcon },
      { href: "/library",    label: "Library",       icon: Library },
    ],
  },
  {
    label: "TRACKING",
    items: [
      { href: "/permissions",          label: "Permissions",        icon: ShieldCheck },
      { href: "/invites",              label: "Invites",            icon: Users },
      { href: "/sessions",             label: "Active Sessions",    icon: Radio },
      { href: "/shared-coordinates",   label: "Shared Coordinates", icon: Navigation },
      { href: "/location-history",     label: "Location History",   icon: Clock },
      { href: "/movement-patterns",        label: "Movement Patterns",        icon: TrendingUp },
      { href: "/behavioral-signatures",    label: "Behavioral Signatures",    icon: Brain },
      { href: "/signal-fusion",        label: "Signal Fusion",      icon: Layers },
      { href: "/location-reports",     label: "Location Reports",   icon: Flag },
    ],
  },
  {
    label: "GROUP SHARE",
    items: [
      { href: "/gmap", label: "GMap", icon: Globe },
    ],
  },
  {
    label: "SECURITY",
    items: [
      { href: "/security-center", label: "Security Center", icon: ShieldAlert },
      { href: "/ip-lookup",       label: "IP Lookup",       icon: Wifi },
      { href: "/geoboard",        label: "GeoBoard",        icon: Camera },
      { href: "/surveillance",    label: "Surveillance",    icon: Camera },
      { href: "/panic-log",       label: "Panic Log",       icon: Siren },
      { href: "/evidence-vault",  label: "Evidence Vault",  icon: Archive },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { href: "/profile",  label: "Profile",  icon: UserCircle },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/about",    label: "About",    icon: Info },
    ],
  },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [location, navigate] = useLocation();
  const { userId } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { state: notifState, subscribe } = useNotificationBell(userId);
  const { count: unreadCount, setCount: setUnreadCount } = useNotificationCount(userId);

  // Hides the main navigation button (mobile hamburger → slide-out menu).
  // Flip to true to bring the button back.
  const SHOW_NAV_BUTTON = true;

  const BellIcon = notifState === "granted" ? BellRing : notifState === "denied" ? BellOff : Bell;
  const bellColor =
    notifState === "granted" ? "text-amber-400" :
    notifState === "denied" ? "text-red-400" :
    notifState === "loading" ? "text-amber-300 animate-pulse" :
    "text-muted-foreground";

  const handleBellClick = useCallback(() => {
    // The panel is the source of truth for activity (live-channel grants raise
    // the count even without push permission), so it must always open. Push
    // permission is requested from inside the panel's own enable affordance,
    // not by hijacking this click.
    if (notifState === "unsupported" || notifState === "loading") {
      setPanelOpen(v => !v);
      if (!panelOpen) setUnreadCount(0);
      return;
    }
    if (notifState !== "granted") subscribe();
    setPanelOpen(true);
    setUnreadCount(0);
  }, [notifState, subscribe, panelOpen, setUnreadCount]);

  const bellTitle =
    notifState === "granted" ? (unreadCount > 0 ? `${unreadCount} unread — click to view` : "View notifications") :
    notifState === "denied" ? "Notifications blocked — open browser settings" :
    notifState === "unsupported" ? "Push notifications not supported" :
    "Enable push notifications";

  const notificationButton = (
    <button onClick={handleBellClick}
      disabled={notifState === "unsupported" || notifState === "loading"}
      title={bellTitle} aria-label={bellTitle}
      className={`relative h-9 w-9 flex items-center justify-center rounded-lg transition-all hover:bg-secondary ${bellColor}`}>
      <BellIcon size={18} />
      {/* Badge shows whenever there is unread activity — live GPS grants raise
          the count with or without browser push permission, so the badge must
          not be gated behind notifState === "granted". */}
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1 ring-1 ring-background">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      {unreadCount === 0 && notifState !== "granted" && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-background" />
      )}
    </button>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-sidebar border-r border-border">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/falcon-logo.png" alt="DeepFalcon" className="w-9 h-9 rounded-xl object-cover shadow-md shadow-amber-500/20 ring-1 ring-amber-500/30" />
            <div>
              <span className="font-bold text-base tracking-tight text-foreground" style={{ fontFamily: "Syne, system-ui, sans-serif", letterSpacing: "-0.02em" }}>DeepFalcon</span>
              <div className="text-[10px] text-muted-foreground font-mono leading-none mt-0.5">Intelligence Platform</div>
            </div>
          </div>
          {notificationButton}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 px-3 mb-2">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const isActive = location === item.href;
                return (
                  <div
                    key={item.href}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setMobileMenuOpen(false); navigate(item.href); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { setMobileMenuOpen(false); navigate(item.href); } }}
                    className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer select-none ${
                      isActive
                        ? "bg-amber-500/10 text-amber-400"
                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon size={16} className={isActive ? "text-amber-400" : ""} />
                      <span className={`text-sm ${isActive ? "font-semibold" : "font-medium"}`}>{item.label}</span>
                    </div>
                    {isActive && <ChevronRight size={14} className="text-amber-400" />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer — account switcher */}
      <div className="px-3 py-3 border-t border-border/60">
        <AccountSwitcher />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      {/* App-wide feather/sky theme backdrop (dashboard mock) */}
      <FeatherBackdrop />
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-64 shrink-0">
        <div className="fixed inset-y-0 w-64">{sidebarContent}</div>
      </div>

      {/* Mobile */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top header — DeepFalcon logo + brand, bell, menu */}
        <div
          className="md:hidden fixed inset-x-0 top-0 z-[1010] flex items-center justify-between border-b border-amber-500/15 bg-background/85 px-3 pb-2 backdrop-blur-md"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
        >
          <div className="flex items-center gap-2.5">
            <img src="/falcon-logo.png" alt="DeepFalcon" className="h-9 w-9 rounded-xl object-cover shadow-md shadow-amber-500/20 ring-1 ring-amber-500/30" />
            <span
              className="font-bold text-[15px] tracking-tight text-foreground"
              style={{ fontFamily: "Syne, system-ui, sans-serif", letterSpacing: "-0.02em" }}
            >
              DeepFalcon
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {notificationButton}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              {SHOW_NAV_BUTTON && (
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open menu">
                    <Menu size={20} />
                  </Button>
                </SheetTrigger>
              )}
              <SheetContent side="left" className="p-0 w-64">{sidebarContent}</SheetContent>
            </Sheet>
          </div>
        </div>

        <main className="app-main relative z-10 flex-1 max-w-5xl mx-auto w-full p-4 pt-[calc(env(safe-area-inset-top,0px)+64px)] md:p-8 md:pt-8">
          {children}
        </main>
      </div>

      {panelOpen && (
        <NotificationPanel onClose={() => { setPanelOpen(false); setUnreadCount(0); }} />
      )}
    </div>
  );
}
