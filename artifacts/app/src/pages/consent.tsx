import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import {
  useGetInviteByToken,
  useGrantLocationConsent,
  getGetInviteByTokenQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, MapPin, CheckCircle, XCircle, Loader2, AlertTriangle, WifiOff, Wifi } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ConsentState =
  | "idle"
  | "requesting"
  | "granting"
  | "tracking"
  | "gps_off"
  | "denied"
  | "error";

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { "Accept-Language": "en" } },
    );
    if (r.ok) return ((await r.json()).display_name as string);
  } catch { /* ignore */ }
  return undefined;
}

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<ConsentState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [address, setAddress] = useState<string | undefined>();
  const [updateCount, setUpdateCount] = useState(0);
  const [lastSent, setLastSent] = useState<Date | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const { data: invite, isLoading, isError } = useGetInviteByToken(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetInviteByTokenQueryKey(token!),
      retry: false,
    },
  });

  const grant = useGrantLocationConsent();

  // Acquire screen wake lock so GPS keeps running
  async function acquireWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current?.addEventListener("release", () => {
          // Re-acquire if the tab is still visible
          if (document.visibilityState === "visible") acquireWakeLock();
        });
      } catch { /* not critical */ }
    }
  }

  // Send location update to server
  async function pushLocation(lat: number, lng: number, acc?: number, addr?: string, locationStatus: "active" | "offline" = "active") {
    try {
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, latitude: lat, longitude: lng, accuracy: acc, address: addr, status: locationStatus }),
      });
      setLastSent(new Date());
      setUpdateCount((c) => c + 1);
    } catch { /* will retry on next watchPosition tick */ }
  }

  // Start continuous location tracking
  function startTracking(initialLat: number, initialLng: number, initialAcc?: number) {
    setState("tracking");
    acquireWakeLock();

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        setCoords({ lat, lng, accuracy: acc });
        if (state !== "tracking") setState("tracking");

        // Reverse geocode occasionally (every 5 updates or if no address yet)
        let addr = address;
        if (!addr || updateCount % 5 === 0) {
          addr = await reverseGeocode(lat, lng);
          if (addr) setAddress(addr);
        }

        pushLocation(lat, lng, acc, addr, "active");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          stopTracking();
        } else {
          // GPS temporarily unavailable (user turned off device location)
          setState("gps_off");
          if (coords) pushLocation(coords.lat, coords.lng, undefined, address, "offline");
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
    );
  }

  function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }

  // Re-acquire wake lock when tab becomes visible again
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && state === "tracking") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [state]);

  // When GPS comes back after being off, watchPosition will call success again
  useEffect(() => {
    if (state === "gps_off" && watchIdRef.current === null && coords) {
      // Restart watching
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = pos.coords.accuracy;
          setCoords({ lat, lng, accuracy: acc });
          setState("tracking");
          const addr = await reverseGeocode(lat, lng);
          if (addr) setAddress(addr);
          pushLocation(lat, lng, acc, addr, "active");
        },
        () => { setState("gps_off"); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
      );
    }
  }, [state]);

  // Cleanup on unmount
  useEffect(() => () => stopTracking(), []);

  const handleGrant = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Your browser does not support location access.");
      setState("error");
      return;
    }

    setState("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        setCoords({ lat: latitude, lng: longitude, accuracy });
        setState("granting");

        const addr = await reverseGeocode(latitude, longitude);
        if (addr) setAddress(addr);

        grant.mutate(
          { token: token!, data: { latitude, longitude, address: addr } },
          {
            onSuccess: () => {
              // After recording consent, start continuous tracking
              startTracking(latitude, longitude, accuracy);
            },
            onError: (err: any) => {
              const msg = err?.data?.error ?? "Failed to record consent.";
              setErrorMsg(msg);
              setState("error");
            },
          },
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState("denied");
        else { setErrorMsg("Unable to retrieve your location. Please try again."); setState("error"); }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  // ── loading / error states ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Invalid Link</h2>
            <p className="text-muted-foreground text-sm">
              This consent link is invalid or has expired. Please ask the sender to resend the invite.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── already granted (but not currently tracking this session) ────────────────
  if (invite.status === "accepted" && state !== "tracking" && state !== "granting" && state !== "gps_off") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Already Granted</h2>
            <p className="text-muted-foreground text-sm mb-4">
              You have already granted location access to{" "}
              <span className="font-medium text-foreground">{invite.fromUserName}</span>.
            </p>
            <Button onClick={() => startTracking(invite.grantedLatitude ?? 0, invite.grantedLongitude ?? 0)} className="w-full">
              <Wifi className="h-4 w-4 mr-2" /> Resume Live Sharing
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── GPS turned off ────────────────────────────────────────────────────────────
  if (state === "gps_off") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <WifiOff className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">GPS Turned Off</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Your device location was turned off. Turn it back on and your live location will automatically reconnect.
            </p>
            <p className="text-xs text-muted-foreground">
              {invite.fromUserName} has been notified that you went offline.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-amber-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for GPS to come back…
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── active tracking ───────────────────────────────────────────────────────────
  if (state === "tracking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 text-primary font-bold text-lg">
              <Shield className="h-5 w-5" /> PhoneLink
            </div>
          </div>
          <Card className="shadow-xl border-border">
            <CardContent className="pt-8 pb-8 px-8">
              {/* Live indicator */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <div className="relative">
                  <div className="w-4 h-4 rounded-full bg-emerald-500" />
                  <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                </div>
                <span className="text-emerald-400 font-bold text-lg tracking-wide">LIVE SHARING</span>
              </div>

              <p className="text-center text-muted-foreground text-sm mb-6">
                Your live location is being shared with{" "}
                <span className="font-semibold text-foreground">{invite.fromUserName}</span>.
                You can play games, watch videos — as long as your GPS is on, sharing continues.
              </p>

              {/* Current position */}
              {coords && (
                <div className="bg-muted rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Position</span>
                  </div>
                  <p className="text-sm font-mono text-foreground">
                    {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                  </p>
                  {coords.accuracy && (
                    <p className="text-xs text-muted-foreground mt-1">Accuracy: ±{Math.round(coords.accuracy)}m</p>
                  )}
                  {address && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{address.slice(0, 80)}{address.length > 80 ? "…" : ""}</p>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-muted rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-foreground">{updateCount}</p>
                  <p className="text-xs text-muted-foreground">Updates sent</p>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <p className="text-sm font-bold text-foreground">
                    {lastSent ? lastSent.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Last update</p>
                </div>
              </div>

              <div className="bg-primary/10 rounded-xl p-4">
                <p className="text-xs text-primary leading-relaxed">
                  Keep this page open in your browser. You can freely switch to other apps — your location will keep updating automatically as long as your device GPS is on.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── denied ────────────────────────────────────────────────────────────────────
  if (state === "denied") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Location Access Denied</h2>
            <p className="text-muted-foreground text-sm mb-6">
              You blocked location access. To try again, allow location permission in your browser settings and reload.
            </p>
            <Button variant="outline" onClick={() => { setState("idle"); window.location.reload(); }}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── error ─────────────────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <AlertTriangle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Something Went Wrong</h2>
            <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
            <Button variant="outline" onClick={() => setState("idle")}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── idle / requesting / granting (grant form) ─────────────────────────────────
  const isProcessing = state === "requesting" || state === "granting";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-primary font-bold text-lg mb-2">
            <Shield className="h-5 w-5" /> PhoneLink
          </div>
        </div>

        <Card className="shadow-xl border-border">
          <CardContent className="pt-8 pb-8 px-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <MapPin className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">Live Location Request</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                <span className="font-semibold text-foreground">{invite.fromUserName}</span>{" "}
                wants to follow your live location via PhoneLink.
              </p>
            </div>

            <div className="bg-primary/10 rounded-xl p-4 mb-6">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">What this means</p>
              <ul className="space-y-1.5">
                {[
                  "Grant once — no repeated pop-ups",
                  "Your live GPS position, updated continuously",
                  "Works while you play games or watch videos",
                  "You're notified when sharing is active",
                  "Turn off your GPS anytime to stop sharing",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-muted-foreground text-center mb-6 leading-relaxed">
              By tapping Grant, your browser will ask for location permission once. Your position
              is shared only with {invite.fromUserName} and stored securely by PhoneLink.
            </p>

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleGrant}
              disabled={isProcessing}
              data-testid="button-grant-location"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {state === "requesting" ? "Requesting permission…" : "Starting live sharing…"}
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  Grant Live Location Access
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center mt-4">
              Turn off your device GPS at any time to stop sharing.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
