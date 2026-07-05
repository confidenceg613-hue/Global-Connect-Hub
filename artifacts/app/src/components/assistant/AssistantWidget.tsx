import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, X, Send, Trash2, Map, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { dispatchMapCommand, getMapContext } from "@/lib/map-command-bus";
import type { MapCommand } from "@/lib/map-command-bus";
import { useAuth } from "@/hooks/use-auth";

// ── Browser speech API types (not in default TS lib) ──────────────────────────
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
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const WELCOME: Message = {
  role: "assistant",
  content:
    "Hey! 👋 I'm your PhoneLink AI. I can navigate the map, describe locations, and control layers.\n\nTap 📞 to call me, or try: \"go to Tokyo\", \"show heatmap\", \"go back\", \"where is [contact]\".",
};

// ── Geocoding ──────────────────────────────────────────────────────────────────
async function geocodePlace(place: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`;
    const r = await fetch(url, { headers: { "Accept-Language": "en" } });
    const data: { lat: string; lon: string; display_name: string }[] = await r.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
  } catch {
    return null;
  }
}

// ── Wikipedia place info ───────────────────────────────────────────────────────
async function fetchPlaceInfo(place: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(place.split(",")[0].trim());
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return null;
    const data: { extract?: string; description?: string } = await r.json();
    return data.extract ? data.extract.slice(0, 600) : null;
  } catch {
    return null;
  }
}

// ── TTS helpers ────────────────────────────────────────────────────────────────
function speak(text: string, onEnd?: () => void): void {
  if (!("speechSynthesis" in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#~]/g, "").replace(/\n+/g, " ").trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05;
  utt.pitch = 1;
  utt.volume = 1;
  // Pick a natural English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith("en") && v.localService) ??
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

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SRInstance | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track pending timeout IDs so we can cancel them on unmount / call end
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Keep stable refs so callbacks always see fresh state
  const callModeRef = useRef(callMode);
  const loadingRef = useRef(loading);
  const mountedRef = useRef(true);
  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopSpeaking();
      try { recognitionRef.current?.stop(); } catch {}
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      pendingTimers.current.forEach(clearTimeout);
    };
  }, []);

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Focus textarea on open ────────────────────────────────────────────────
  useEffect(() => {
    if (open && !callMode) setTimeout(() => textareaRef.current?.focus(), 120);
  }, [open, callMode]);

  // ── Load persistent history from DB ───────────────────────────────────────
  useEffect(() => {
    if (!open || historyLoaded || !userId) return;
    setHistoryLoaded(true);
    const controller = new AbortController();
    fetch(`${BASE}/api/assistant/history?userId=${userId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { messages: { role: "user" | "assistant"; content: string }[] }) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        if (data.messages?.length) {
          // Merge DB history with any messages already in state (user may have sent while loading)
          setMessages((prev) => {
            const nonWelcome = prev.filter((m) => m.content !== WELCOME.content);
            if (nonWelcome.length > 0) return prev; // user already chatted — don't clobber
            return [WELCOME, ...data.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];
          });
        }
      })
      .catch(() => {/* aborted or network error — ignore */});
    return () => controller.abort();
  }, [open, historyLoaded, userId]);

  // ── Call timer — also tears down voice on exit ────────────────────────────
  useEffect(() => {
    if (callMode) {
      setCallDuration(0);
      callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      stopSpeaking();
      stopListening();
      // Cancel all pending timers (delayed listen-restart, wiki narration, etc.)
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

  // ── Speech recognition ─────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR: SpeechRecognitionCtor | undefined =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    if (loadingRef.current) return;
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
        if (callModeRef.current) {
          sendMessage(transcript);
        } else {
          setInput(transcript);
        }
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

  // ── Core send ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const msg = (overrideText ?? input).trim();
    if (!msg || loadingRef.current) return;
    if (!overrideText) setInput("");

    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    const mapContext = getMapContext();

    try {
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, mapContext, userId: userId ?? undefined }),
      });

      const data = await resp.json();
      const reply: string = data.reply ?? "Sorry, I couldn't understand that.";
      const command: MapCommand | null = data.command ?? null;

      setMessages((prev) => [...prev, { role: "assistant", content: reply, command }]);

      // Speak in call mode
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
      setMessages((prev) => [...prev, { role: "assistant", content: err }]);
      if (callModeRef.current) speak(err);
    } finally {
      setLoading(false);
    }
  }, [input, userId, startListening]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Execute map command ────────────────────────────────────────────────────
  const executeCommand = async (command: MapCommand) => {
    if (command.type === "geocode") {
      const [coords, wiki] = await Promise.all([
        geocodePlace(command.place),
        fetchPlaceInfo(command.place),
      ]);

      if (coords) {
        dispatchMapCommand({ type: "flyTo", lat: coords.lat, lng: coords.lng, zoom: 13 });
        // After flying, narrate Wikipedia info in call mode
        if (callModeRef.current && wiki) {
          const t = setTimeout(() => {
            if (!mountedRef.current || !callModeRef.current) return;
            setSpeaking(true);
            speak(`Here's some background: ${wiki}`, () => {
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
        // Show wiki snippet as a chat bubble
        if (wiki) {
          const snippet = wiki.length > 220 ? wiki.slice(0, 220) + "…" : wiki;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `📍 **${command.place}**\n${snippet}` },
          ]);
        }
      } else {
        const notFound = `⚠️ Couldn't find "${command.place}" on the map.`;
        setMessages((prev) => [...prev, { role: "assistant", content: notFound }]);
        if (callModeRef.current) speak(`Couldn't find ${command.place}.`);
      }
    } else {
      dispatchMapCommand(command);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Call mode ──────────────────────────────────────────────────────────────
  const startCall = useCallback(() => {
    setCallMode(true);
    setOpen(false);
    setSpeaking(true);
    speak("PhoneLink AI connected. How can I help you?", () => {
      setSpeaking(false);
      if (callModeRef.current) setTimeout(() => startListening(), 500);
    });
  }, [startListening]);

  const endCall = useCallback(() => {
    setCallMode(false);
  }, []);

  const clearChat = () => {
    setMessages([WELCOME]);
    setHistoryLoaded(false);
  };

  const ctx = getMapContext();
  const onMap = ctx.onMapPage;

  return (
    <>
      {/* ── Voice Call Overlay ─────────────────────────────────────────────── */}
      {callMode && (
        <div className="fixed inset-0 z-[9999] bg-black/96 flex flex-col items-center justify-center select-none">
          {/* Animated ring */}
          <div className="relative mb-10">
            {(speaking || listening) && (
              <>
                <div
                  className="absolute inset-0 rounded-full border-2 animate-ping"
                  style={{
                    borderColor: speaking ? "rgba(99,102,241,.45)" : "rgba(16,185,129,.45)",
                    animationDuration: "1.4s",
                  }}
                />
                <div
                  className="absolute inset-0 rounded-full border-2 animate-ping"
                  style={{
                    borderColor: speaking ? "rgba(99,102,241,.25)" : "rgba(16,185,129,.25)",
                    animationDuration: "2.1s",
                    animationDelay: "0.4s",
                  }}
                />
              </>
            )}
            <div
              className="w-32 h-32 rounded-full flex items-center justify-center border-2 transition-colors duration-300"
              style={{
                background: speaking
                  ? "rgba(99,102,241,.15)"
                  : listening
                  ? "rgba(16,185,129,.15)"
                  : "rgba(255,255,255,.05)",
                borderColor: speaking
                  ? "rgba(99,102,241,.6)"
                  : listening
                  ? "rgba(16,185,129,.6)"
                  : "rgba(255,255,255,.15)",
              }}
            >
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

          {/* Waveform */}
          <div className="flex items-center gap-[3px] mb-14 h-10">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="w-[3px] rounded-full transition-all duration-150"
                style={{
                  height:
                    speaking || listening
                      ? `${10 + Math.abs(Math.sin((i * 0.7) + (callDuration * 3))) * 22}px`
                      : "4px",
                  backgroundColor:
                    speaking
                      ? `rgba(99,102,241,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})`
                      : listening
                      ? `rgba(16,185,129,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})`
                      : "#3f3f46",
                }}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-10">
            {/* Mic toggle */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggleListening}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{
                  background: listening ? "rgba(16,185,129,.25)" : "rgba(255,255,255,.08)",
                  border: `2px solid ${listening ? "rgba(16,185,129,.5)" : "rgba(255,255,255,.12)"}`,
                }}
              >
                {listening ? <Mic className="w-6 h-6 text-emerald-400" /> : <MicOff className="w-6 h-6 text-zinc-400" />}
              </button>
              <span className="text-[10px] font-mono text-zinc-600">{listening ? "Mute" : "Mic"}</span>
            </div>

            {/* Hang up */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={endCall}
                className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg"
                style={{ boxShadow: "0 0 30px rgba(220,38,38,.35)" }}
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">End Call</span>
            </div>

            {/* Chat */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => { setOpen(true); }}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{ background: "rgba(255,255,255,.08)", border: "2px solid rgba(255,255,255,.12)" }}
              >
                <Bot className="w-6 h-6 text-zinc-400" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">Chat</span>
            </div>
          </div>

          <p className="text-[11px] text-zinc-700 mt-10">Tap mic · Tap hang up to end</p>
        </div>
      )}

      {/* ── FAB ───────────────────────────────────────────────────────────────── */}
      {!callMode && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Open AI assistant"
          className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {/* ── Chat panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: "min(70vh, 560px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-500" />
              <span className="font-semibold text-sm">PhoneLink AI</span>
              {onMap && (
                <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <Map className="w-2.5 h-2.5" />
                  MAP ACTIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={startCall}
                aria-label="Voice call"
                title="Start voice call"
                className="p-1.5 rounded hover:bg-muted text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={clearChat}
                aria-label="Clear chat"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="flex flex-col gap-1 max-w-[85%]">
                  <div
                    className={`px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {m.content}
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

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted text-foreground px-3 py-2 rounded-xl rounded-bl-sm text-sm flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border bg-muted/20">
            {onMap && (
              <p className="text-[10px] text-indigo-400 mb-2 font-mono">
                🗺️ Map connected — try "go to Paris", "go back"
              </p>
            )}
            <div className="flex gap-2 items-end">
              {/* Mic button */}
              <button
                onClick={toggleListening}
                title={listening ? "Stop" : "Voice input"}
                className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border transition-all ${
                  listening
                    ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  listening ? "🎤 Listening…" : onMap ? "Navigate map or ask anything…" : "Ask anything…"
                }
                rows={1}
                className="flex-1 resize-none text-sm min-h-[36px] max-h-[120px]"
                disabled={loading || listening}
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />

              <Button
                size="icon"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="h-9 w-9 shrink-0 bg-indigo-600 hover:bg-indigo-500"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              <button
                onClick={startCall}
                className="text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-2"
              >
                📞 Start voice call
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
    case "fitAll":      return "Fit all contacts";
    case "zoomIn":      return "Zoomed in";
    case "zoomOut":     return "Zoomed out";
    case "findContact": return `Locating: ${cmd.name}`;
    case "goBack":      return "Returned to home view";
  }
}
