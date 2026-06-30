import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import {
  useGetInviteByToken,
  useGrantLocationConsent,
  getGetInviteByTokenQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, MapPin, CheckCircle, XCircle, Loader2, AlertTriangle, WifiOff } from "lucide-react";

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
    if (r.ok) return (await r.json()).display_name as string;
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
  const autoStartedRef = useRef(false);

  // Refs so callbacks always see the latest values (no stale closures)
  const stateRef = useRef<ConsentState>("idle");
  const addressRef = useRef<string | undefined>(undefined);
  const updateCountRef = useRef<number>(0);
  const coordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { addressRef.current = address; }, [address]);
  useEffect(() => { updateCountRef.current = updateCount; }, [updateCount]);
  useEffect(() => { coordsRef.current = coords; }, [coords]);

  const { data: invite, isLoading, isError } = useGetInviteByToken(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetInviteByTokenQueryKey(token!),
      retry: false,
    },
  });

  const grant = useGrantLocationConsent();

  const acquireWakeLock = useCallback(async () => {
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current?.addEventListener("release", () => {
          if (document.visibilityState === "visible" && stateRef.current === "tracking") {
            acquireWakeLock();
          }
        });
      } catch { /* not critical */ }
    }
  }, []);

  const pushLocation = useCallback(async (
    lat: number, lng: number, acc?: number, addr?: string,
    locationStatus: "active" | "offline" = "active",
  ) => {
    try {
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, latitude: lat, longitude: lng, accuracy: acc, address: addr, status: locationStatus }),
      });
      setLastSent(new Date());
      setUpdateCount((c) => c + 1);
    } catch { /* retry on next tick */ }
  }, [token]);

  const startTracking = useCallback((initialLat: number, initialLng: number, _initialAcc?: number) => {
    setState("tracking");
    acquireWakeLock();

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        setCoords({ lat, lng, accuracy: acc });
        if (stateRef.current !== "tracking") setState("tracking");

        let addr = addressRef.current;
        if (!addr || updateCountRef.current % 5 === 0) {
          const newAddr = await reverseGeocode(lat, lng);
          if (newAddr) { setAddress(newAddr); addr = newAddr; }
        }
        pushLocation(lat, lng, acc, addr, "active");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          wakeLockRef.current?.release();
          wakeLockRef.current = null;
        } else {
          // GPS temporarily off — keep the watcher alive so it auto-recovers
          setState("gps_off");
          const c = coordsRef.current;
          if (c) pushLocation(c.lat, c.lng, undefined, addressRef.current, "offline");
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
    );
  }, [acquireWakeLock, pushLocation]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  // Re-acquire wake lock when tab becomes visible
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && stateRef.current === "tracking") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  // Cleanup on unmount
  useEffect(() => () => stopTracking(), [stopTracking]);

  // ── Core auto-grant logic ────────────────────────────────────────────────────
  // Fires the moment invite data is ready — no button tap needed.
  const doGrant = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg("Your browser doesn't support location access. Please try a different browser.");
      setState("error");
      return;
    }
    setState("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setCoords({ lat: latitude, lng: longitude, accuracy });
        setState("granting");

        const addr = await reverseGeocode(latitude, longitude);
        if (addr) setAddress(addr);

        grant.mutate(
          { token: token!, data: { latitude, longitude, address: addr } },
          {
            onSuccess: () => startTracking(latitude, longitude, accuracy),
            onError: (err: any) => {
              const msg = err?.data?.error ?? "Failed to record consent.";
              setErrorMsg(msg);
              setState("error");
            },
          },
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
        } else {
          setErrorMsg("Could not get your location. Make sure Location is turned on and try again.");
          setState("error");
        }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [token, grant, startTracking]);

  // Auto-start as soon as invite is loaded (runs once)
  useEffect(() => {
    if (!invite || autoStartedRef.current) return;
    autoStartedRef.current = true;

    // Already granted in a previous session → resume tracking immediately
    if (invite.status === "accepted") {
      startTracking(invite.grantedLatitude ?? 0, invite.grantedLongitude ?? 0);
    } else {
      // New grant — kick off automatically
      doGrant();
    }
  }, [invite, doGrant, startTracking]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading || state === "idle") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Shield className="h-5 w-5" /> PhoneLink
        </div>
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Setting up secure connection…</p>
      </div>
    );
  }

  // ── Invalid link ─────────────────────────────────────────────────────────────
  if (isError || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Link</h2>
            <p className="text-muted-foreground text-sm">
              This link is invalid or has expired. Ask the sender to resend it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Requesting / granting (auto in progress) ─────────────────────────────────
  if (state === "requesting" || state === "granting") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Shield className="h-5 w-5" /> PhoneLink
        </div>
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
            <MapPin className="h-10 w-10 text-primary" />
          </div>
          <div className="absolute -inset-2 rounded-full border-2 border-primary/30 animate-ping" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-foreground text-lg">
            {state === "requesting" ? "Finding your location…" : "Starting live sharing…"}
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            {state === "requesting"
              ? "Allow location access in the browser prompt above"
              : `Connecting to ${invite.fromUserName}…`}
          </p>
        </div>
      </div>
    );
  }

  // ── GPS off ──────────────────────────────────────────────────────────────────
  if (state === "gps_off") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <WifiOff className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">GPS Turned Off</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Turn your device location back on and sharing will automatically resume.
            </p>
            <p className="text-xs text-muted-foreground">
              {invite.fromUserName} has been notified you went offline.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-amber-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for GPS…
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Active tracking ───────────────────────────────────────────────────────────
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
                You can play games or watch videos — sharing keeps going in the background.
              </p>

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
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {address.slice(0, 80)}{address.length > 80 ? "…" : ""}
                    </p>
                  )}
                </div>
              )}

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

              <div className="bg-emerald-500/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-emerald-500">Live sharing is active</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Keep this page open. Switch to any other app freely — your location updates automatically as long as your GPS is on.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Denied ────────────────────────────────────────────────────────────────────
  if (state === "denied") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Location Access Blocked</h2>
            <p className="text-muted-foreground text-sm mb-6">
              To share your location, allow location access in your browser settings, then tap Retry.
            </p>
            <Button className="w-full" onClick={() => { autoStartedRef.current = false; doGrant(); }}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardContent className="pt-10 pb-10 text-center">
          <AlertTriangle className="h-14 w-14 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Something Went Wrong</h2>
          <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
          <Button variant="outline" className="w-full" onClick={() => { autoStartedRef.current = false; doGrant(); }}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
