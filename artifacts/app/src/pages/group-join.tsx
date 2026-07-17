/**
 * /group/:groupId  — public group share join page
 *
 * Works like the consent page but:
 *  - No invite record required; anyone with the link can join
 *  - Pushes location to /api/group-shares/:groupId/push (NOT /api/location/push)
 *  - Location therefore NEVER appears on the owner's main live-map
 *  - Supports multiple concurrent participants sharing through the same link
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, MapPin, CheckCircle, Users, Loader2, WifiOff, Navigation } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── Animated background sparkles ─────────────────────────────────────────────

function Sparkle({ x, y, delay, size }: { x: number; y: number; delay: number; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: `${x}%`, top: `${y}%`, width: size, height: size,
        background: "radial-gradient(circle, rgba(99,102,241,0.7) 0%, rgba(139,92,246,0.3) 60%, transparent 100%)",
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 0.8, 0], scale: [0, 1, 0] }}
      transition={{ duration: 2.5 + Math.random(), delay, repeat: Infinity, repeatDelay: Math.random() * 3 }}
    />
  );
}

const SPARKLES = Array.from({ length: 18 }, (_, i) => ({
  id: i, x: Math.random() * 100, y: Math.random() * 100,
  delay: Math.random() * 3, size: 6 + Math.random() * 14,
}));

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {SPARKLES.map((s) => <Sparkle key={s.id} {...s} />)}
    </div>
  );
}

// ─── Pulse ring around the location dot ──────────────────────────────────────

function PulseRing() {
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border-2 border-indigo-400"
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

// ─── State machine types ──────────────────────────────────────────────────────

type JoinState =
  | "loading"      // fetching group info
  | "pre_join"     // show join screen
  | "joining"      // POST /join in-flight
  | "requesting"   // getting GPS permission
  | "tracking"     // live sharing active
  | "denied"       // GPS denied
  | "error";       // group not found / network error

interface GroupInfo {
  groupId: string;
  name: string;
  ownerName: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

// A page refresh must not spawn a duplicate group_share_members row — persist
// the memberToken per-group so a reload resumes the same membership instead
// of silently re-joining as a brand-new (and now orphaned) member.
function storageKeyFor(groupId: string): string {
  return `phonelink_group_member_${groupId}`;
}
function loadStoredMemberToken(groupId: string): string | null {
  try { return localStorage.getItem(storageKeyFor(groupId)); } catch { return null; }
}
function storeMemberToken(groupId: string, token: string): void {
  try { localStorage.setItem(storageKeyFor(groupId), token); } catch { /* storage unavailable — falls back to rejoin */ }
}

export default function GroupJoinPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [state, setState] = useState<JoinState>("loading");
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [memberToken, setMemberToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState<string | undefined>();
  const [updateCount, setUpdateCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const memberTokenRef = useRef<string | null>(null);
  const addressRef = useRef<string | undefined>(undefined);
  const beatRef = useRef<(() => void) | null>(null);

  useEffect(() => { memberTokenRef.current = memberToken; }, [memberToken]);
  useEffect(() => { addressRef.current = address; }, [address]);

  // ── 1. Fetch group info, then resume an existing membership if this device
  // already joined (survives refresh/tab-close without creating a duplicate
  // group_share_members row every time the page reloads) ───────────────────
  useEffect(() => {
    if (!groupId) return;
    fetch(`${API_BASE}/api/group-shares/${groupId}/info`)
      .then((r) => {
        if (!r.ok) throw new Error("Group not found");
        return r.json() as Promise<GroupInfo>;
      })
      .then((info) => {
        setGroupInfo(info);
        const stored = loadStoredMemberToken(groupId);
        if (stored) startTracking(stored);
        else setState("pre_join");
      })
      .catch(() => { setErrorMsg("This group link is invalid or has been removed."); setState("error"); });
    // startTracking is stable across the component's lifetime (only depends
    // on pushLocation, itself only depending on groupId) — safe to omit here
    // to avoid re-running this fetch whenever it's redefined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // ── 2. Push location helper ──────────────────────────────────────────────
  const pushLocation = useCallback(async (
    lat: number, lng: number, acc?: number,
    addr?: string, status: "active" | "offline" = "active",
  ) => {
    const token = memberTokenRef.current;
    if (!token || !groupId) return;
    try {
      const { signal, clear } = abortAfter(10000);
      await fetch(`${API_BASE}/api/group-shares/${groupId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberToken: token, latitude: lat, longitude: lng, accuracy: acc, address: addr, status }),
        signal,
      }).finally(clear);
      setUpdateCount((c) => c + 1);
    } catch { /* retry on next heartbeat */ }
  }, [groupId]);

  // ── 3. Start GPS tracking once we have a memberToken ────────────────────
  const startTracking = useCallback((token: string) => {
    setMemberToken(token);
    memberTokenRef.current = token;
    setState("requesting");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        setCoords({ lat, lng });
        setState("tracking");
        const addr = await reverseGeocode(lat, lng);
        setAddress(addr);
        addressRef.current = addr;
        await pushLocation(lat, lng, acc, addr);

        // Watch position
        watchIdRef.current = navigator.geolocation.watchPosition(
          async (p) => {
            const { latitude: wlat, longitude: wlng, accuracy: wacc } = p.coords;
            setCoords({ lat: wlat, lng: wlng });
            const waddr = await reverseGeocode(wlat, wlng);
            setAddress(waddr);
            addressRef.current = waddr;
            await pushLocation(wlat, wlng, wacc, waddr);
          },
          () => { /* GPS errors handled by heartbeat */ },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
        );

        // Heartbeat every 15 s to keep the session alive. Extracted so it can
        // also fire immediately on tab-visibility regain below — background
        // tabs throttle/suspend setInterval on most mobile browsers, so the
        // interval alone can silently stop firing for minutes while the tab
        // is backgrounded, leaving the member looking "offline" long after
        // they're actually back.
        const beat = () => {
          if (memberTokenRef.current) {
            navigator.geolocation.getCurrentPosition(
              (p) => pushLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? undefined, addressRef.current),
              () => { if (memberTokenRef.current) pushLocation(0, 0, undefined, undefined, "offline"); },
              { enableHighAccuracy: false, maximumAge: 15000, timeout: 10000 },
            );
          }
        };
        heartbeatRef.current = setInterval(beat, 15000);
        beatRef.current = beat;
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState("denied");
        else { setErrorMsg("Could not get your location. Please try again."); setState("error"); }
      },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }, [pushLocation]);

  // ── 3b. Re-fire the heartbeat the instant the tab regains focus/visibility
  // — closes the gap left by background-tab throttling instead of waiting
  // for the next (possibly very delayed) interval tick. ────────────────────
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") beatRef.current?.(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // ── 4. Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      // Send offline status
      if (memberTokenRef.current && groupId) {
        navigator.sendBeacon(
          `${API_BASE}/api/group-shares/${groupId}/push`,
          JSON.stringify({ memberToken: memberTokenRef.current, latitude: 0, longitude: 0, status: "offline" }),
        );
      }
    };
  }, [groupId]);

  // ── 5. Join handler ──────────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!groupId) return;
    setState("joining");
    try {
      const { signal, clear } = abortAfter(10000);
      const r = await fetch(`${API_BASE}/api/group-shares/${groupId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() || undefined }),
        signal,
      }).finally(clear);
      if (!r.ok) throw new Error("Join failed");
      const data = (await r.json()) as { memberToken: string };
      storeMemberToken(groupId, data.memberToken);
      startTracking(data.memberToken);
    } catch {
      setErrorMsg("Failed to join the group. Please try again.");
      setState("pre_join");
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen min-h-[100svh] p-6 overflow-hidden"
      style={{ background: "radial-gradient(circle at 50% 20%, #1e1b4b 0%, #0f0f1a 60%, #000 100%)" }}
    >
      <FloatingParticles />

      {/* Brand */}
      <motion.div
        className="absolute top-6 left-6 flex items-center gap-2 text-white/70 text-sm font-semibold"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
      >
        <Shield className="w-4 h-4 text-indigo-400" />
        PhoneLink
      </motion.div>

      <AnimatePresence mode="wait">
        {/* ── Loading ── */}
        {state === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 text-white">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-sm text-white/60">Loading group…</p>
          </motion.div>
        )}

        {/* ── Error ── */}
        {state === "error" && (
          <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 text-center text-white max-w-sm">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold">Link unavailable</h2>
            <p className="text-sm text-white/60">{errorMsg}</p>
          </motion.div>
        )}

        {/* ── GPS Denied ── */}
        {state === "denied" && (
          <motion.div key="denied" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 text-center text-white max-w-sm">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center">
              <MapPin className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold">Location access needed</h2>
            <p className="text-sm text-white/60">
              Please enable location access in your browser settings and reload this page to join the group.
            </p>
          </motion.div>
        )}

        {/* ── Pre-join screen ── */}
        {(state === "pre_join" || state === "joining") && groupInfo && (
          <motion.div key="pre_join"
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6 text-white text-center"
          >
            {/* Icon */}
            <motion.div
              className="w-20 h-20 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shadow-2xl shadow-indigo-500/20"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <Users className="w-10 h-10 text-indigo-400" />
            </motion.div>

            <div>
              <p className="text-xs font-semibold tracking-widest text-indigo-400/80 uppercase mb-1">Group Share</p>
              <h1 className="text-2xl font-bold tracking-tight">{groupInfo.name}</h1>
              <p className="text-sm text-white/50 mt-1">
                <span className="text-white/70 font-medium">{groupInfo.ownerName}</span> invited you to share your live location
              </p>
            </div>

            {/* Name input */}
            <div className="w-full">
              <label className="block text-xs font-medium text-white/50 mb-1.5 text-left">
                Your name <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Alex"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                disabled={state === "joining"}
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500/60 focus:bg-white/15 transition-all text-sm"
              />
            </div>

            {/* Info note */}
            <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-left">
              <p className="text-xs text-white/50 leading-relaxed">
                📍 Your live location will be shared privately with <strong className="text-white/70">{groupInfo.ownerName}</strong> and other group participants.
                It will <strong className="text-white/70">not</strong> appear on the public live map.
              </p>
            </div>

            {/* Join button */}
            <motion.button
              onClick={handleJoin}
              disabled={state === "joining"}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all font-semibold text-white shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2"
            >
              {state === "joining" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Joining…</>
              ) : (
                <><Navigation className="w-4 h-4" /> Join & Share Location</>
              )}
            </motion.button>
          </motion.div>
        )}

        {/* ── Requesting GPS ── */}
        {state === "requesting" && (
          <motion.div key="requesting"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 text-white text-center max-w-sm"
          >
            <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
            <div>
              <h2 className="text-xl font-bold mb-2">Requesting location…</h2>
              <p className="text-sm text-white/50">Please allow location access when prompted</p>
            </div>
          </motion.div>
        )}

        {/* ── Tracking active ── */}
        {state === "tracking" && groupInfo && (
          <motion.div key="tracking"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6 text-white text-center"
          >
            <PulseRing />

            <div>
              <motion.div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-3"
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live — sharing now
              </motion.div>
              <h2 className="text-xl font-bold">{groupInfo.name}</h2>
              {displayName && (
                <p className="text-sm text-white/50 mt-0.5">Sharing as <span className="text-white/70 font-medium">{displayName}</span></p>
              )}
            </div>

            {/* Stats */}
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <p className="text-2xl font-bold text-indigo-400">{updateCount}</p>
                <p className="text-xs text-white/40 mt-0.5">Updates sent</p>
              </div>
              <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <p className="text-sm font-semibold text-white/80 truncate">
                  {coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "—"}
                </p>
                <p className="text-xs text-white/40 mt-0.5">Current position</p>
              </div>
            </div>

            {address && (
              <motion.p
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-xs text-white/40 px-2 line-clamp-2"
              >
                📍 {address}
              </motion.p>
            )}

            {/* Privacy note */}
            <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs text-white/40 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Only <strong className="text-white/60">{groupInfo.ownerName}</strong> and group members can see your location
              </p>
            </div>

            <p className="text-xs text-white/25">Keep this page open to continue sharing</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
