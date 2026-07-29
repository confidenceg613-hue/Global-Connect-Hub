import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth, AuthProvider } from "@/hooks/use-auth";
import { useAccess, AccessProvider } from "@/hooks/use-access";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { AudioPlayerBar } from "@/components/audio-player-bar";
import { useEffect, lazy, Suspense } from "react";

// Public entry pages: kept as static imports so the very first screen
// (sign-in / consent link) shows up as fast as possible, with no extra
// network round-trips for code the visitor may never need.
import Landing from "@/pages/landing";
import ConsentPage from "@/pages/consent";

// Everything behind login is lazy-loaded. Some of these pages pull in heavy
// libraries (Mapbox, charts), and in dev mode Vite serves each module as its
// own unbundled request — eagerly importing all of them from App.tsx meant
// the landing page couldn't render until the *entire* app's JS (maps, charts,
// and all) had finished downloading. On a slow/high-latency mobile
// connection that could stall the initial load for a long time, looking like
// a stuck "Setting up secure connection..." screen. Splitting these out means
// the landing page only needs its own small bundle; each protected page's
// code is fetched on demand, right before it's shown.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Activity = lazy(() => import("@/pages/activity"));
const Permissions = lazy(() => import("@/pages/permissions"));
const Invites = lazy(() => import("@/pages/invites"));
const Sessions = lazy(() => import("@/pages/sessions"));
const Profile = lazy(() => import("@/pages/profile"));
const SharedCoordinates = lazy(() => import("@/pages/shared-coordinates"));
const LocationHistory = lazy(() => import("@/pages/location-history"));
const LiveMap = lazy(() => import("@/pages/live-map"));
const GeoBoard = lazy(() => import("@/pages/geoboard"));
const LocationReports = lazy(() => import("@/pages/location-reports"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const Surveillance = lazy(() => import("@/pages/surveillance"));
const GMap = lazy(() => import("@/pages/gmap"));
const GroupJoinPage = lazy(() => import("@/pages/group-join"));
const Subscription = lazy(() => import("@/pages/subscription"));
const Admin = lazy(() => import("@/pages/admin"));
const GuardianPage = lazy(() => import("@/pages/guardian"));
const SecurityCenter = lazy(() => import("@/pages/security-center"));
const PanicLog = lazy(() => import("@/pages/panic-log"));
const EvidenceVault = lazy(() => import("@/pages/evidence-vault"));
const IpLookup = lazy(() => import("@/pages/ip-lookup"));
const AmbienceTest = lazy(() => import("@/pages/ambience-test"));
const About = lazy(() => import("@/pages/about"));

import { AppLayout } from "@/components/layout/app-layout";
import { GrantNotifier } from "@/components/grant-notifier";
import { ErrorBoundary } from "@/components/error-boundary";
import AssistantWidget from "@/components/assistant/AssistantWidget";
import { AppCommandHandler } from "@/components/assistant/AppCommandHandler";
import { AncientSky } from "@/components/ancient-sky";
import { IncomingRequestModal } from "@/components/incoming-request-modal";

const queryClient = new QueryClient();

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// VAPID key injected at build time via VITE_VAPID_PUBLIC_KEY env var (set in .replit).
// Falls back to empty string so push subscription is silently skipped rather than crashing.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

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
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
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

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { userId } = useAuth();
  const { status, loading } = useAccess();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!userId) {
      setLocation("/");
      return;
    }
    if (!loading && status && !status.allowed) {
      setLocation("/subscription");
    }
  }, [userId, loading, status, setLocation]);

  if (!userId) return null;
  if (loading || !status) return <RouteFallback />;
  if (!status.allowed) return null;

  return (
    <AppLayout>
      <PageErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Component />
        </Suspense>
      </PageErrorBoundary>
    </AppLayout>
  );
}

// The paywall/subscription screen itself: reachable whenever the user is
// signed in, regardless of access status (that's the whole point — this is
// where a locked-out user goes to pay and redeem a code). No AppLayout chrome
// around it so it reads as a dedicated checkpoint, not just another app page.
function SubscriptionRoute() {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!userId) setLocation("/");
  }, [userId, setLocation]);

  if (!userId) return null;

  return (
    <PageErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Subscription />
      </Suspense>
    </PageErrorBoundary>
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
      <Route path="/sessions"><ProtectedRoute component={Sessions} /></Route>
      <Route path="/shared-coordinates"><ProtectedRoute component={SharedCoordinates} /></Route>
      <Route path="/location-history"><ProtectedRoute component={LocationHistory} /></Route>
      <Route path="/live-map"><ProtectedRoute component={LiveMap} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      <Route path="/geoboard"><ProtectedRoute component={GeoBoard} /></Route>
      <Route path="/location-reports"><ProtectedRoute component={LocationReports} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
      <Route path="/surveillance"><ProtectedRoute component={Surveillance} /></Route>
      <Route path="/guardian"><ProtectedRoute component={GuardianPage} /></Route>
      <Route path="/security-center"><ProtectedRoute component={SecurityCenter} /></Route>
      <Route path="/panic-log"><ProtectedRoute component={PanicLog} /></Route>
      <Route path="/evidence-vault"><ProtectedRoute component={EvidenceVault} /></Route>
      <Route path="/gmap"><ProtectedRoute component={GMap} /></Route>
      <Route path="/ip-lookup"><ProtectedRoute component={IpLookup} /></Route>
      <Route path="/subscription"><SubscriptionRoute /></Route>
      <Route path="/group/:groupId" component={GroupJoinPage} />
      {/* Not linked from anywhere but the landing page's key icon — has its
          own password gate independent of the regular user login. */}
      <Route path="/admin">
        <Suspense fallback={<RouteFallback />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/ambience-test"><Suspense fallback={null}><AmbienceTest /></Suspense></Route>
      <Route path="/about"><ProtectedRoute component={About} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  const { userId } = useAuth();
  const { soundOn, trackName, progress, currentTime, duration, toggleSound, playTrack, seek } = useAudioPlayer();
  return (
    <>
      <AncientSky />
      <AudioPlayerBar
        soundOn={soundOn}
        trackName={trackName}
        progress={progress}
        currentTime={currentTime}
        duration={duration}
        onToggle={toggleSound}
        onSeek={seek}
        onPlayTrack={playTrack}
      />
      <ServiceWorkerManager userId={userId} />
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
        <AppCommandHandler />
      </WouterRouter>
      <GrantNotifier />
      <IncomingRequestModal />
      <AssistantWidget />
      <Toaster />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccessProvider>
          <TooltipProvider>
            <AppInner />
          </TooltipProvider>
        </AccessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
