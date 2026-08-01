import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth, AuthProvider } from "@/hooks/use-auth";
import { useAccess, AccessProvider } from "@/hooks/use-access";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useImmersiveMode } from "@/hooks/use-immersive-mode";
import { InAppBrowserProvider, useInAppBrowser } from "@/components/in-app-browser";
import { AudioPlayerProvider } from "@/hooks/audio-player-context";
import { PinLockGate } from "@/components/pin-lock-gate";
import { useEffect, useCallback, useState, lazy, Suspense } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

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
const MovementPatterns = lazy(() => import("@/pages/movement-patterns"));
const BehavioralSignatures = lazy(() => import("@/pages/behavioral-signatures"));
const SignalFusion = lazy(() => import("@/pages/signal-fusion"));
const SecurityCenter = lazy(() => import("@/pages/security-center"));
const PanicLog = lazy(() => import("@/pages/panic-log"));
const EvidenceVault = lazy(() => import("@/pages/evidence-vault"));
const IpLookup = lazy(() => import("@/pages/ip-lookup"));
const AmbienceTest = lazy(() => import("@/pages/ambience-test"));
const About = lazy(() => import("@/pages/about"));
const Library = lazy(() => import("@/pages/library"));

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
  const { toast } = useToast();

  // Register SW, auto-subscribe push if permission already granted
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: "none" })
      .then(async (registration) => {
        // Check for a waiting SW (already downloaded update) on every page load
        if (registration.waiting) {
          toast({
            title: "🚀 Update ready",
            description: "A new version of DeepFalcon is available.",
            action: (
              <ToastAction
                altText="Reload"
                onClick={() => {
                  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
                  window.location.reload();
                }}
              >
                Reload
              </ToastAction>
            ),
            duration: 0,
          });
        }
        // If push permission already granted, re-sync subscription silently
        if (userId && Notification.permission === "granted") {
          registerPushSubscription(userId, registration);
        }
        // Register periodic background sync if supported
        try {
          const ps = (registration as ServiceWorkerRegistration & {
            periodicSync?: { register: (tag: string, opts: object) => Promise<void> };
          }).periodicSync;
          await ps?.register("location-refresh", { minInterval: 24 * 60 * 60 * 1000 });
        } catch { /* not supported or permission denied — non-fatal */ }
      })
      .catch(() => { /* non-critical */ });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for messages from the SW
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const { type } = e.data ?? {};

      // Deep-link on notification click
      if (type === "NOTIFICATION_CLICK") {
        const target: string = e.data.targetPath ?? "/live-map";
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.href = `${base}${target}`;
        return;
      }

      // New SW just activated — prompt user to reload
      if (type === "SW_UPDATED") {
        toast({
          title: "✨ DeepFalcon updated",
          description: "Reload to get the latest features.",
          action: (
            <ToastAction altText="Reload" onClick={() => window.location.reload()}>
              Reload
            </ToastAction>
          ),
          duration: 8000,
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── Install Prompt Banner ─────────────────────────────────────────────────────
// Captures the browser's beforeinstallprompt event and shows a tasteful bottom
// banner after the user has spent 20 s in the app. Shown at most once per session;
// never shown if already running as a PWA (standalone / fullscreen).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already installed — don't show
    const mq = window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)");
    if (mq.matches || (navigator as Navigator & { standalone?: boolean }).standalone) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Show the banner after a 20-second delay so it doesn't feel intrusive on first load
    const tid = setTimeout(() => setVisible(true), 20_000);

    window.addEventListener("appinstalled", () => { setPrompt(null); setVisible(false); });

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(tid);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prompt || !visible) return null;

  const handleInstall = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") { setPrompt(null); setVisible(false); }
  };

  return (
    <div
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9990,
        background: "linear-gradient(0deg, #0D0A06 0%, rgba(13,10,6,0.97) 100%)",
        borderTop: "1px solid rgba(245,159,11,0.2)",
        padding: "14px 20px calc(14px + env(safe-area-inset-bottom)) 20px",
        display: "flex", alignItems: "center", gap: 14,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
        animation: "slideUp 0.35s cubic-bezier(.16,1,.3,1)",
      }}
    >
      <style>{`@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}`}</style>
      <img src="/falcon-logo.png" alt="DeepFalcon"
        style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          boxShadow: "0 0 14px rgba(245,159,11,0.4)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#F5C97A",
          fontFamily: "system-ui,sans-serif" }}>
          Add DeepFalcon to home screen
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#78716c",
          fontFamily: "system-ui,sans-serif" }}>
          Instant launch · offline support · background alerts
        </p>
      </div>
      <button
        onClick={handleInstall}
        style={{
          background: "linear-gradient(135deg,#D97706,#F59E0B)",
          border: "none", borderRadius: 10, padding: "9px 16px",
          color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer",
          flexShrink: 0, fontFamily: "system-ui,sans-serif",
        }}
      >
        Install
      </button>
      <button
        onClick={() => setVisible(false)}
        style={{
          background: "none", border: "none", color: "#52504c",
          fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
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
      <Route path="/movement-patterns"><ProtectedRoute component={MovementPatterns} /></Route>
      <Route path="/behavioral-signatures"><ProtectedRoute component={BehavioralSignatures} /></Route>
      <Route path="/signal-fusion"><ProtectedRoute component={SignalFusion} /></Route>
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
      <Route path="/library"><ProtectedRoute component={Library} /></Route>
      <Route path="/ambience-test"><Suspense fallback={null}><AmbienceTest /></Suspense></Route>
      <Route path="/about"><ProtectedRoute component={About} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Intercepts all external link clicks and window.open calls and routes them
 * through the in-app browser so the user never leaves the PWA.
 */
function ExternalLinkInterceptor() {
  const { openUrl } = useInAppBrowser();

  // Patch window.open
  useEffect(() => {
    const originalOpen = window.open.bind(window);
    window.open = (url?: string | URL, target?: string, features?: string) => {
      const href = url?.toString() ?? "";
      if (href.startsWith("http") && (target === "_blank" || target === "_system" || !target)) {
        // Let _system pass through (used by the in-app browser's own "Open externally" button)
        if (target === "_system") return originalOpen(href, "_blank", features);
        openUrl(href);
        return null;
      }
      return originalOpen(url, target, features);
    };
    return () => { window.open = originalOpen; };
  }, [openUrl]);

  // Intercept <a target="_blank"> and any external href clicks
  const handleDocClick = useCallback(
    (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("http") && !href.startsWith("//")) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin) return; // internal
        e.preventDefault();
        e.stopPropagation();
        openUrl(url.href);
      } catch { /* malformed href, ignore */ }
    },
    [openUrl],
  );

  useEffect(() => {
    document.addEventListener("click", handleDocClick, true);
    return () => document.removeEventListener("click", handleDocClick, true);
  }, [handleDocClick]);

  return null;
}

/** Inner shell — consumes the shared audio player from context */
function AppInner() {
  const { userId } = useAuth();
  const { soundOn, trackName, progress, currentTime, duration, toggleSound, playTrack, seek } =
    useAudioPlayer();
  useImmersiveMode();
  return (
    // Provide the single audio player instance to every child (Library page, etc.)
    <AudioPlayerProvider value={{ soundOn, trackName, progress, currentTime, duration, toggleSound, playTrack, seek, startMusic: toggleSound }}>
      <AncientSky />
      <ServiceWorkerManager userId={userId} />
      <InstallBanner />
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
        <AppCommandHandler />
      </WouterRouter>
      <GrantNotifier />
      <IncomingRequestModal />
      <AssistantWidget />
      <Toaster />
    </AudioPlayerProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccessProvider>
          <TooltipProvider>
            <InAppBrowserProvider>
              <ExternalLinkInterceptor />
              <PinLockGate>
                <AppInner />
              </PinLockGate>
            </InAppBrowserProvider>
          </TooltipProvider>
        </AccessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
