import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

// Pages
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Activity from "@/pages/activity";
import Permissions from "@/pages/permissions";
import Invites from "@/pages/invites";
import Profile from "@/pages/profile";
import ConsentPage from "@/pages/consent";
import SharedCoordinates from "@/pages/shared-coordinates";
import LocationHistory from "@/pages/location-history";
import LiveMap from "@/pages/live-map";
import GeoBoard from "@/pages/geoboard";
import LocationReports from "@/pages/location-reports";
import SettingsPage from "@/pages/settings";
import { AppLayout } from "@/components/layout/app-layout";
import { GrantNotifier } from "@/components/grant-notifier";
import { ErrorBoundary } from "@/components/error-boundary";

const queryClient = new QueryClient();

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VAPID_PUBLIC_KEY = "BC25lK-LutnB0q-o9jd7PV8jo5dzFELRDBfpbUFcJRs632OKi1cx81ghTwK_mpV3AbtEk7SLLKIQroAHFkWaamM";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function registerPushSubscription(userId: number, sw: ServiceWorkerRegistration) {
  try {
    const existing = await sw.pushManager.getSubscription();
    if (existing) {
      await fetch(`${API_BASE}/api/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          endpoint: existing.endpoint,
          keys: {
            auth: btoa(String.fromCharCode(...new Uint8Array((existing.getKey("auth") as ArrayBuffer)))),
            p256dh: btoa(String.fromCharCode(...new Uint8Array((existing.getKey("p256dh") as ArrayBuffer)))),
          },
        }),
      });
      return;
    }

    const subscription = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const p256dh = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!p256dh || !auth) return;

    await fetch(`${API_BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        endpoint: subscription.endpoint,
        keys: {
          auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
          p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
        },
      }),
    });
  } catch { /* push not supported or denied — non-critical */ }
}

function ServiceWorkerManager({ userId }: { userId: number | null }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then(async (registration) => {
        // Only auto-subscribe if permission was already granted (not requesting it here)
        if (!userId) return;
        if (Notification.permission === "granted") {
          registerPushSubscription(userId, registration);
        }
      })
      .catch(() => { /* non-critical */ });
  }, [userId]);

  // Listen for notification click messages from SW — deep link by notification type
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "NOTIFICATION_CLICK") {
        const target: string = e.data.targetPath ?? "/live-map";
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.href = `${base}${target}`;
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}

function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!userId) {
      setLocation("/");
    }
  }, [userId, setLocation]);

  if (!userId) return null;

  return (
    <AppLayout>
      <PageErrorBoundary>
        <Component />
      </PageErrorBoundary>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Landing} />
      <Route path="/consent/:token" component={ConsentPage} />

      {/* Protected routes */}
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/activity"><ProtectedRoute component={Activity} /></Route>
      <Route path="/permissions"><ProtectedRoute component={Permissions} /></Route>
      <Route path="/invites"><ProtectedRoute component={Invites} /></Route>
      <Route path="/shared-coordinates"><ProtectedRoute component={SharedCoordinates} /></Route>
      <Route path="/location-history"><ProtectedRoute component={LocationHistory} /></Route>
      <Route path="/live-map"><ProtectedRoute component={LiveMap} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      <Route path="/geoboard"><ProtectedRoute component={GeoBoard} /></Route>
      <Route path="/location-reports"><ProtectedRoute component={LocationReports} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  const { userId } = useAuth();
  return (
    <>
      <ServiceWorkerManager userId={userId} />
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <GrantNotifier />
      <Toaster />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppInner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
