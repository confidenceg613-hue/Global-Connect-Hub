import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, X, Send, Trash2, Map, Mic, MicOff, Phone, PhoneOff, Monitor, Camera, XCircle, Sparkles } from "lucide-react";
import { dispatchMapCommand, getMapContext } from "@/lib/map-command-bus";
import type { MapCommand } from "@/lib/map-command-bus";
import { useAuth } from "@/hooks/use-auth";

// ── Browser speech API types ───────────────────────────────────────────────────
interface SREvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SRInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onresult: ((ev: SREvent) => void) | null;
}
type SpeechRecognitionCtor = new () => SRInstance;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

interface Message {
  role: "user" | "assistant";
  content: string;
  command?: MapCommand | null;
  timestamp?: number;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const WELCOME: Message = {
  role: "assistant",
  content:
    "Hey! 👋 I'm your **PhoneLink AI** — powered by GPT-4o.\n\nI can navigate the map, answer questions about any place on Earth, analyse your screen, and much more. Try asking me anything.",
  timestamp: Date.now(),
};

// Quick-action chips shown when no contacts exist yet
const QUICK_ACTIONS_DEFAULT = [
  "Go to Tokyo",
  "What is a geofence?",
  "Show heatmap",
  "How does SOS work?",
];

// ── Markdown-lite renderer ─────────────────────────────────────────────────────
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty line → spacer
    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-1" />);
      continue;
    }

    // Bullet point
    if (/^[•\-\*] /.test(line.trim())) {
      const content = line.replace(/^[\s•\-\*]+/, "");
      nodes.push(
        <div key={i} className="flex gap-1.5 items-start">
          <span className="mt-[3px] shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400/70" />
          <span>{inlineMarkdown(content)}</span>
        </div>
      );
      continue;
    }

    // Normal line
    nodes.push(<div key={i}>{inlineMarkdown(line)}</div>);
  }

  return nodes;
}

function inlineMarkdown(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── TTS helpers ────────────────────────────────────────────────────────────────
function speak(text: string, onEnd?: () => void): void {
  if (!("speechSynthesis" in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#~•]/g, "").replace(/\n+/g, " ").trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05;
  utt.pitch = 1;
  utt.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  // Prefer high-quality neural / natural voices
  const preferred =
    voices.find((v) => /google|neural|natural|premium/i.test(v.name) && v.lang.startsWith("en")) ??
    voices.find((v) => v.lang.startsWith("en-US") && v.localService) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  if (preferred) utt.voice = preferred;
  utt.onend = () => onEnd?.();
  utt.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utt);
}

function stopSpeaking(): void {
  try { window.speechSynthesis?.cancel(); } catch {}
}

// ── Geocoding / Place helpers ──────────────────────────────────────────────────
interface GeocodeResult {
  lat: number; lng: number; formattedAddress: string;
  placeTypes: string[]; city: string | null; region: string | null;
  country: string | null; neighborhood: string | null;
}
interface PlaceInfo {
  name: string | null; summary: string | null; placeTypes: string[];
  rating: number | null; userRatingCount: number | null;
}

async function geocodePlace(place: string): Promise<GeocodeResult | null> {
  try {
    const r = await fetch(`${BASE}/api/maps/geocode?place=${encodeURIComponent(place)}`);
    if (!r.ok) return null;
    const data: GeocodeResult = await r.json();
    return typeof data.lat === "number" ? data : null;
  } catch { return null; }
}

async function fetchPlaceInfo(place: string): Promise<PlaceInfo | null> {
  try {
    const r = await fetch(`${BASE}/api/maps/place-info?place=${encodeURIComponent(place)}`);
    if (!r.ok) return null;
    return await r.json() as PlaceInfo;
  } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AssistantWidget() {
  const { userId } = useAuth();

  const [open, setOpen] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [screenCapture, setScreenCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const capturingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const supportsScreenShare = typeof navigator !== "undefined" &&
    typeof (navigator.mediaDevices as { getDisplayMedia?: unknown })?.getDisplayMedia === "function";

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SRInstance | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callModeRef = useRef(callMode);
  const loadingRef = useRef(loading);
  const mountedRef = useRef(true);

  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopSpeaking();
      try { recognitionRef.current?.stop(); } catch {}
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      pendingTimers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open && !callMode) setTimeout(() => textareaRef.current?.focus(), 120);
  }, [open, callMode]);

  useEffect(() => {
    if (!open || historyLoaded || !userId) return;
    setHistoryLoaded(true);
    const controller = new AbortController();
    fetch(`${BASE}/api/assistant/history?userId=${userId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { messages: { role: "user" | "assistant"; content: string }[] }) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        if (data.messages?.length) {
          setMessages((prev) => {
            const nonWelcome = prev.filter((m) => m.content !== WELCOME.content);
            if (nonWelcome.length > 0) return prev;
            return [WELCOME, ...data.messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: Date.now(),
            }))];
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open, historyLoaded, userId]);

  useEffect(() => {
    if (callMode) {
      setCallDuration(0);
      callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      stopSpeaking();
      stopListening();
      pendingTimers.current.forEach(clearTimeout);
      pendingTimers.current = [];
    }
    return () => {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      stopSpeaking();
      stopListening();
      pendingTimers.current.forEach(clearTimeout);
      pendingTimers.current = [];
    };
  }, [callMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Speech recognition ──────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR || loadingRef.current) return;
    try { recognitionRef.current?.stop(); } catch {}
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recognitionRef.current = rec;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (event: SREvent) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript) {
        if (callModeRef.current) sendMessage(transcript);
        else setInput(transcript);
      }
    };
    rec.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopListening() {
    setListening(false);
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  }

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening]);

  // ── Core send ───────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const msg = (overrideText ?? input).trim();
    if (!msg || loadingRef.current) return;
    if (!overrideText) setInput("");

    const imageToSend = screenCapture;
    if (imageToSend) setScreenCapture(null);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: imageToSend ? `🖥️ [Screen shared]\n${msg}` : msg, timestamp: Date.now() },
    ]);
    setLoading(true);

    const mapContext = getMapContext();

    try {
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          mapContext,
          userId: userId ?? undefined,
          ...(imageToSend ? { image: imageToSend } : {}),
        }),
      });

      const data = await resp.json();
      const reply: string = data.reply ?? "Sorry, I couldn't understand that.";
      const command: MapCommand | null = data.command ?? null;

      setMessages((prev) => [...prev, { role: "assistant", content: reply, command, timestamp: Date.now() }]);

      if (callModeRef.current) {
        setSpeaking(true);
        speak(reply, () => {
          if (!mountedRef.current) return;
          setSpeaking(false);
          if (callModeRef.current) {
            const t = setTimeout(() => startListening(), 500);
            pendingTimers.current.push(t);
          }
        });
      }

      if (command) await executeCommand(command);
    } catch {
      const err = "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: err, timestamp: Date.now() }]);
      if (callModeRef.current) speak(err);
    } finally {
      setLoading(false);
    }
  }, [input, userId, startListening, screenCapture]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Execute map command ─────────────────────────────────────────────────────
  const executeCommand = async (command: MapCommand) => {
    if (command.type === "geocode") {
      const [coords, placeInfo] = await Promise.all([
        geocodePlace(command.place),
        fetchPlaceInfo(command.place),
      ]);

      if (coords) {
        dispatchMapCommand({ type: "flyTo", lat: coords.lat, lng: coords.lng, zoom: 13 });

        const locationParts: string[] = [];
        if (coords.formattedAddress) locationParts.push(`📍 ${coords.formattedAddress}`);

        const displayTypes = placeInfo?.placeTypes?.length ? placeInfo.placeTypes : coords.placeTypes;
        if (displayTypes?.length) locationParts.push(`🏷️ ${displayTypes.slice(0, 3).join(", ")}`);

        if (placeInfo?.rating != null) {
          const stars = "★".repeat(Math.round(placeInfo.rating));
          const count = placeInfo.userRatingCount
            ? ` (${placeInfo.userRatingCount.toLocaleString()} reviews)` : "";
          locationParts.push(`${stars} ${placeInfo.rating.toFixed(1)}${count}`);
        }

        if (placeInfo?.summary) {
          const snippet = placeInfo.summary.length > 300
            ? placeInfo.summary.slice(0, 300) + "…"
            : placeInfo.summary;
          locationParts.push(snippet);
        }

        if (locationParts.length) {
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: locationParts.join("\n"),
            timestamp: Date.now(),
          }]);
        }

        if (callModeRef.current && placeInfo?.summary) {
          const t = setTimeout(() => {
            if (!mountedRef.current || !callModeRef.current) return;
            setSpeaking(true);
            speak(`Here's what I found: ${placeInfo.summary}`, () => {
              if (!mountedRef.current) return;
              setSpeaking(false);
              if (callModeRef.current) {
                const t2 = setTimeout(() => startListening(), 500);
                pendingTimers.current.push(t2);
              }
            });
          }, 1800);
          pendingTimers.current.push(t);
        }
      } else {
        const notFound = `⚠️ Couldn't find **${command.place}** on the map.`;
        setMessages((prev) => [...prev, { role: "assistant", content: notFound, timestamp: Date.now() }]);
        if (callModeRef.current) speak(`Couldn't find ${command.place}.`);
      }
    } else {
      dispatchMapCommand(command);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Call mode ───────────────────────────────────────────────────────────────
  const startCall = useCallback(() => {
    setCallMode(true);
    setOpen(false);
    setSpeaking(true);
    speak("PhoneLink AI connected. How can I help you?", () => {
      setSpeaking(false);
      if (callModeRef.current) setTimeout(() => startListening(), 500);
    });
  }, [startListening]);

  const endCall = useCallback(() => { setCallMode(false); }, []);

  // ── File picker fallback ────────────────────────────────────────────────────
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!e.target) return;
    (e.target as HTMLInputElement).value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") setScreenCapture(result);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Screen capture ──────────────────────────────────────────────────────────
  const captureScreen = useCallback(async () => {
    if (capturingRef.current) return;
    setCaptureError(null);

    if (!supportsScreenShare) {
      fileInputRef.current?.click();
      return;
    }

    capturingRef.current = true;
    setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(opts?: MediaStreamConstraints): Promise<MediaStream>;
      }).getDisplayMedia({ video: true });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Video metadata timeout")), 10_000);
        video.onloadedmetadata = () => { clearTimeout(timer); video.play().then(resolve).catch(reject); };
        video.onerror = () => { clearTimeout(timer); reject(new Error("Video load error")); };
      });

      setOpen(false);
      await new Promise<void>((resolve) => {
        let secs = 5;
        setCountdown(secs);
        const tick = setInterval(() => {
          secs -= 1;
          if (secs <= 0) { clearInterval(tick); setCountdown(null); resolve(); }
          else setCountdown(secs);
        }, 1000);
        pendingTimers.current.push(tick as unknown as ReturnType<typeof setTimeout>);
      });

      const canvas = document.createElement("canvas");
      const MAX_W = 1280;
      const scale = Math.min(1, MAX_W / (video.videoWidth || MAX_W));
      canvas.width = Math.round((video.videoWidth || MAX_W) * scale);
      canvas.height = Math.round((video.videoHeight || 720) * scale);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setScreenCapture(canvas.toDataURL("image/jpeg", 0.80));
      setOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel|denied|dismissed|NotAllowed/i.test(msg)) {
        setCaptureError("Screen capture failed. Please try again.");
      }
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      capturingRef.current = false;
      setCapturing(false);
      setCountdown(null);
    }
  }, [supportsScreenShare]);

  const clearChat = () => { setMessages([WELCOME]); setHistoryLoaded(false); };

  const ctx = getMapContext();
  const onMap = ctx.onMapPage;
  const contactNames = ctx.contacts?.map(c => c.name).filter(Boolean) ?? [];

  // Contextual quick-action chips
  const quickActions = onMap && contactNames.length > 0
    ? [
        `Where is ${contactNames[0]}?`,
        "Show all contacts",
        "Enable heatmap",
        "Go to my location",
      ]
    : QUICK_ACTIONS_DEFAULT;

  const nonWelcomeMessages = messages.filter(m => m.content !== WELCOME.content);
  const showQuickActions = nonWelcomeMessages.length === 0 && !loading;

  return (
    <>
      {/* ── Voice Call Overlay ───────────────────────────────────────────────── */}
      {callMode && (
        <div className="fixed inset-0 z-[9999] bg-black/96 flex flex-col items-center justify-center select-none">
          <div className="relative mb-10">
            {(speaking || listening) && (
              <>
                <div className="absolute inset-0 rounded-full border-2 animate-ping"
                  style={{ borderColor: speaking ? "rgba(99,102,241,.45)" : "rgba(16,185,129,.45)", animationDuration: "1.4s" }} />
                <div className="absolute inset-0 rounded-full border-2 animate-ping"
                  style={{ borderColor: speaking ? "rgba(99,102,241,.25)" : "rgba(16,185,129,.25)", animationDuration: "2.1s", animationDelay: "0.4s" }} />
              </>
            )}
            <div className="w-32 h-32 rounded-full flex items-center justify-center border-2 transition-colors duration-300"
              style={{
                background: speaking ? "rgba(99,102,241,.15)" : listening ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.05)",
                borderColor: speaking ? "rgba(99,102,241,.6)" : listening ? "rgba(16,185,129,.6)" : "rgba(255,255,255,.15)",
              }}>
              <Bot className="w-16 h-16 text-white" />
            </div>
          </div>

          <div className="text-white text-2xl font-semibold mb-1">PhoneLink AI</div>
          <div className="text-sm mb-2" style={{ color: speaking ? "#a5b4fc" : listening ? "#6ee7b7" : "#71717a" }}>
            {speaking ? "Speaking…" : listening ? "Listening…" : loading ? "Thinking…" : "Connected"}
          </div>
          <div className="text-xs font-mono mb-14" style={{ color: "#52525b" }}>
            {formatDuration(callDuration)}
          </div>

          <div className="flex items-center gap-[3px] mb-14 h-10">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="w-[3px] rounded-full transition-all duration-150"
                style={{
                  height: speaking || listening
                    ? `${10 + Math.abs(Math.sin((i * 0.7) + (callDuration * 3))) * 22}px`
                    : "4px",
                  backgroundColor: speaking
                    ? `rgba(99,102,241,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})`
                    : listening
                    ? `rgba(16,185,129,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})`
                    : "#3f3f46",
                }} />
            ))}
          </div>

          <div className="flex items-center gap-10">
            <div className="flex flex-col items-center gap-2">
              <button onClick={toggleListening}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{
                  background: listening ? "rgba(16,185,129,.25)" : "rgba(255,255,255,.08)",
                  border: `2px solid ${listening ? "rgba(16,185,129,.5)" : "rgba(255,255,255,.12)"}`,
                }}>
                {listening ? <Mic className="w-6 h-6 text-emerald-400" /> : <MicOff className="w-6 h-6 text-zinc-400" />}
              </button>
              <span className="text-[10px] font-mono text-zinc-600">{listening ? "Mute" : "Mic"}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button onClick={endCall}
                className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg"
                style={{ boxShadow: "0 0 30px rgba(220,38,38,.35)" }}>
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">End Call</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button onClick={() => setOpen(true)}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{ background: "rgba(255,255,255,.08)", border: "2px solid rgba(255,255,255,.12)" }}>
                <Bot className="w-6 h-6 text-zinc-400" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">Chat</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-700 mt-10">Tap mic · Tap hang up to end</p>
        </div>
      )}

      {/* ── Screenshot countdown overlay ────────────────────────────────────── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[120px] font-black tabular-nums leading-none select-none"
            style={{ color: "white", textShadow: "0 0 60px rgba(99,102,241,.9), 0 4px 24px rgba(0,0,0,.8)" }}>
            {countdown}
          </div>
          <p className="mt-4 text-lg font-semibold text-white/80" style={{ textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>
            Taking screenshot…
          </p>
        </div>
      )}

      {/* ── FAB ─────────────────────────────────────────────────────────────── */}
      {!callMode && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Open AI assistant"
          className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {/* ── Chat panel ──────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: "min(72vh, 600px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Bot className="w-4 h-4 text-indigo-500" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-background" />
              </div>
              <span className="font-semibold text-sm">PhoneLink AI</span>
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                <Sparkles className="w-2.5 h-2.5" />
                GPT-4o
              </span>
              {onMap && (
                <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <Map className="w-2.5 h-2.5" />
                  MAP
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startCall} aria-label="Voice call" title="Start voice call"
                className="p-1.5 rounded hover:bg-muted text-emerald-400 hover:text-emerald-300 transition-colors">
                <Phone className="w-3.5 h-3.5" />
              </button>
              <button onClick={clearChat} aria-label="Clear chat"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close assistant"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="flex flex-col gap-1 max-w-[88%]">
                  <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.role === "assistant"
                      ? <div className="space-y-0.5">{renderMarkdown(m.content)}</div>
                      : <span className="whitespace-pre-wrap">{m.content}</span>
                    }
                  </div>
                  {m.command && (
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 px-1">
                      <Map className="w-2.5 h-2.5" />
                      <span>{commandLabel(m.command)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground px-3 py-2.5 rounded-xl rounded-bl-sm text-xs flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-[10px] opacity-60">Thinking…</span>
                </div>
              </div>
            )}

            {/* Quick-action chips */}
            {showQuickActions && (
              <div className="pt-1">
                <p className="text-[10px] text-muted-foreground mb-2 font-mono px-1">Try asking:</p>
                <div className="flex flex-wrap gap-1.5">
                  {quickActions.map((action) => (
                    <button
                      key={action}
                      onClick={() => sendMessage(action)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all hover:border-indigo-500/40 hover:text-indigo-400"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border bg-muted/20">
            {captureError && (
              <div className="flex items-center gap-2 mb-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                <span className="flex-1">{captureError}</span>
                <button onClick={() => setCaptureError(null)} className="shrink-0 hover:text-red-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {screenCapture && (
              <div className="relative mb-2 inline-block">
                <img src={screenCapture} alt="Screen capture preview"
                  className="h-20 rounded-lg border border-border object-cover shadow-sm" />
                <button onClick={() => setScreenCapture(null)}
                  className="absolute -top-1.5 -right-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Remove screenshot">
                  <XCircle className="w-4 h-4 fill-background" />
                </button>
                <span className="absolute bottom-1 left-1 text-[9px] font-mono bg-black/60 text-white px-1 rounded">screen</span>
              </div>
            )}

            <div className="flex gap-2 items-end">
              <button onClick={toggleListening} title={listening ? "Stop" : "Voice input"}
                className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border transition-all ${
                  listening
                    ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"
                }`}>
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />

              <button onClick={captureScreen}
                title={supportsScreenShare ? "Share your screen with AI" : "Share a photo with AI"}
                disabled={capturing}
                className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border transition-all ${
                  screenCapture
                    ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                    : capturing
                    ? "bg-muted/50 border-border text-muted-foreground animate-pulse"
                    : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"
                }`}>
                {supportsScreenShare ? <Monitor className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
              </button>

              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  screenCapture ? "Ask about your screen…"
                    : listening ? "🎤 Listening…"
                    : onMap ? "Navigate map or ask anything…"
                    : "Ask me anything…"
                }
                rows={1}
                className="flex-1 resize-none text-sm min-h-[36px] max-h-[120px]"
                disabled={loading || listening}
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              <Button size="icon" onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="h-9 w-9 shrink-0 bg-indigo-600 hover:bg-indigo-500">
                <Send className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              <button onClick={startCall} className="text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-2">
                📞 Voice call
              </button>
              {" · "}
              <button onClick={captureScreen} className="text-violet-400 hover:text-violet-300 hover:underline underline-offset-2">
                {supportsScreenShare ? "🖥️ Share screen" : "📷 Share photo"}
              </button>
              {" · "}Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function commandLabel(cmd: MapCommand): string {
  switch (cmd.type) {
    case "flyTo":       return `Flew to ${cmd.lat.toFixed(4)}, ${cmd.lng.toFixed(4)}`;
    case "geocode":     return `Searching "${cmd.place}"…`;
    case "setLayer":    return `${cmd.enabled ? "Enabled" : "Disabled"} ${cmd.layer}`;
    case "fitAll":      return "Fit all contacts in view";
    case "zoomIn":      return "Zoomed in";
    case "zoomOut":     return "Zoomed out";
    case "findContact": return `Locating: ${cmd.name}`;
    case "goBack":      return "Returned to home view";
  }
}
