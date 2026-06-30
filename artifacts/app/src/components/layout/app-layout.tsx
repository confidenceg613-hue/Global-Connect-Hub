import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  UserCircle,
  LogOut,
  Menu,
  Navigation,
  Clock,
  Map,
  Bell,
  BellOff,
  BellRing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VAPID_PUBLIC_KEY = "BC25lK-LutnB0q-o9jd7PV8jo5dzFELRDBfpbUFcJRs632OKi1cx81ghTwK_mpV3AbtEk7SLLKIQroAHFkWaamM";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type NotifState = "unsupported" | "default" | "granted" | "denied" | "loading";

function useNotificationBell(userId: number | null) {
  const { toast } = useToast();
  const [state, setState] = useState<NotifState>("default");

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as NotifState);
  }, []);

  const subscribe = useCallback(async () => {
    if (!userId) {
      toast({ title: "Sign in first to enable notifications" });
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast({ title: "Notifications not supported on this device", variant: "destructive" });
      return;
    }
    if (Notification.permission === "denied") {
      toast({ title: "Notifications blocked", description: "Open browser settings and allow notifications for this site.", variant: "destructive" });
      return;
    }

    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      setState(permission as NotifState);

      if (permission !== "granted") {
        toast({ title: "Notifications not enabled", description: "You can enable them from browser settings.", variant: "destructive" });
        return;
      }

      const base = import.meta.env.BASE_URL;
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });

      const existing = await reg.pushManager.getSubscription();
      let sub = existing;
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const p256dh = sub.getKey("p256dh");
      const auth = sub.getKey("auth");
      if (p256dh && auth) {
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            endpoint: sub.endpoint,
            keys: {
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            },
          }),
        });
      }

      toast({ title: "🔔 Notifications enabled", description: "You'll get alerts when location updates happen." });
    } catch {
      setState(Notification.permission as NotifState);
      toast({ title: "Could not enable notifications", variant: "destructive" });
    }
  }, [userId, toast]);

  return { state, subscribe };
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { logout, userId } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { state: notifState, subscribe } = useNotificationBell(userId);

  const navItems = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/permissions", label: "Permissions", icon: ShieldCheck },
    { href: "/invites", label: "Invites", icon: Users },
    { href: "/live-map", label: "Live Map", icon: Map },
    { href: "/shared-coordinates", label: "Shared Coordinates", icon: Navigation },
    { href: "/location-history", label: "Location History", icon: Clock },
    { href: "/profile", label: "Profile", icon: UserCircle },
  ];

  const BellIcon = notifState === "granted" ? BellRing : notifState === "denied" ? BellOff : Bell;
  const bellColor =
    notifState === "granted" ? "text-emerald-400" :
    notifState === "denied" ? "text-red-400" :
    notifState === "loading" ? "text-yellow-400 animate-pulse" :
    "text-muted-foreground";
  const bellTitle =
    notifState === "granted" ? "Notifications ON — click to re-subscribe" :
    notifState === "denied" ? "Notifications blocked — open browser settings" :
    notifState === "unsupported" ? "Push notifications not supported" :
    "Enable push notifications";

  const NotificationButton = () => (
    <button
      onClick={subscribe}
      disabled={notifState === "unsupported" || notifState === "loading"}
      title={bellTitle}
      className={`relative p-2 rounded-lg transition-all hover:bg-secondary ${bellColor}`}
    >
      <BellIcon size={20} />
      {notifState === "granted" && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-background" />
      )}
      {notifState === "default" && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-background" />
      )}
    </button>
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar border-r border-border">
      <div className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <ShieldCheck size={24} />
            </div>
            <span className="font-bold text-xl tracking-tight text-foreground">PhoneLink</span>
          </div>
          <NotificationButton />
        </div>
      </div>

      <div className="flex-1 px-4 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={logout}
        >
          <LogOut size={20} className="mr-3" />
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-72 shrink-0">
        <div className="fixed inset-y-0 w-72">
          <SidebarContent />
        </div>
      </div>

      {/* Mobile Sidebar & Header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between p-4 bg-background border-b border-border">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
              <ShieldCheck size={20} />
            </div>
            <span className="font-bold text-lg text-foreground">PhoneLink</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationButton />
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu size={24} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <SidebarContent />
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
