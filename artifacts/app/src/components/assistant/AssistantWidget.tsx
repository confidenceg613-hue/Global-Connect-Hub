import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, X, Send, Trash2, Map, Mic, MicOff, Phone, PhoneOff, Monitor, Camera, XCircle, Sparkles, Zap, Images, ExternalLink, Radio } from "lucide-react";
import { dispatchMapCommand, getMapContext } from "@/lib/map-command-bus";
import type { MapCommand } from "@/lib/map-command-bus";
import { useAuth } from "@/hooks/use-auth";

interface SREvent extends Event { results: SpeechRecognitionResultList; }
interface SRInstance {
  lang: string; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onresult: ((ev: SREvent) => void) | null;
}
type SpeechRecognitionCtor = new () => SRInstance;
declare global {
  interface Window { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor; }
}

interface ImageResult { url: string; source: string; alt: string; thumb?: string; }

interface Message {
  role: "user" | "assistant";
  content: string;
  command?: MapCommand | null;
  streaming?: boolean;
  images?: ImageResult[];
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const WELCOME: Message = {
  role: "assistant",
  content: "Hey! 👋 I'm your **PhoneLink AI** — powered by GPT-4o.\n\nI can navigate the map, find **real photos** of any place on Earth, brief you on locations, and much more.",
};

const QUICK_ACTIONS_DEFAULT = ["Show image of Abuja", "Go to Lagos", "What is a geofence?", "Show heatmap"];

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} className="h-1" />;
    if (/^[•\-\*] /.test(line.trim())) {
      return (
        <div key={i} className="flex gap-1.5 items-start">
          <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400/70" />
          <span>{inlineMarkdown(line.replace(/^[\s•\-\*]+/, ""))}</span>
        </div>
      );
    }
    return <div key={i}>{inlineMarkdown(line)}</div>;
  });
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )}</>;
}

function speak(text: string, onEnd?: () => void): void {
  if (!("speechSynthesis" in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#~•]/g, "").replace(/\n+/g, " ").trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05; utt.pitch = 1; utt.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find(v => /google|neural|natural|premium/i.test(v.name) && v.lang.startsWith("en")) ??
    voices.find(v => v.lang.startsWith("en-US") && v.localService) ??
    voices.find(v => v.lang.startsWith("en")) ?? null;
  if (preferred) utt.voice = preferred;
  utt.onend = () => onEnd?.(); utt.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utt);
}
function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch {} }

async function geocodePlace(place: string): Promise<{ lat: number; lng: number; formattedAddress: string; placeTypes: string[]; city: string | null; region: string | null; country: string | null; neighborhood: string | null; } | null> {
  try {
    const r = await fetch(`${BASE}/api/maps/geocode?place=${encodeURIComponent(place)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.lat === "number" ? d : null;
  } catch { return null; }
}

async function fetchPlaceInfo(place: string): Promise<{ name: string | null; summary: string | null; placeTypes: string[]; rating: number | null; userRatingCount: number | null; } | null> {
  try {
    const r = await fetch(`${BASE}/api/maps/place-info?place=${encodeURIComponent(place)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchLocationImages(place: string): Promise<ImageResult[]> {
  try {
    const r = await fetch(`${BASE}/api/images/search?q=${encodeURIComponent(place)}`);
    if (!r.ok) return [];
    const data: { images: ImageResult[] } = await r.json();
    return data.images || [];
  } catch { return []; }
}

interface StreamEvent {
  type: "token" | "done" | "error";
  text?: string;
  command?: MapCommand | null;
  fullReply?: string;
  message?: string;
}

async function* readStream(resp: Response): AsyncGenerator<StreamEvent> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try { yield JSON.parse(raw) as StreamEvent; } catch { /* skip malformed */ }
    }
  }
}

// ── Image grid component ──────────────────────────────────────────────────────
function ImageGrid({ images, place }: { images: ImageResult[]; place: string }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const valid = images.filter((_, i) => !failed.has(i));
  if (valid.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
        <Images className="w-3 h-3" /> Photos of {place}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {valid.slice(0, 6).map((img, i) => (
          <a key={i} href={img.url} target="_blank" rel="noopener noreferrer"
            className="relative group rounded-lg overflow-hidden border border-border/40 bg-muted aspect-video block">
            <img
              src={img.thumb || img.url}
              alt={img.alt}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
              onError={() => setFailed(prev => new Set([...prev, images.indexOf(img)]))}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
              <span className="text-[9px] text-white/80 truncate">{img.source}</span>
              <ExternalLink className="w-2.5 h-2.5 text-white/60 shrink-0" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function AssistantWidget() {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SRInstance | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callModeRef = useRef(callMode);
  const alwaysOnRef = useRef(alwaysOn);
  const loadingRef = useRef(loading);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks all image URLs ever shown — prevents repeats across the session
  const shownImagesRef = useRef<Set<string>>(new Set());
  // Stable ref to sendMessage so background mic can always call latest version
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { alwaysOnRef.current = alwaysOn; }, [alwaysOn]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopSpeaking();
      try { recognitionRef.current?.stop(); } catch {}
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      pendingTimers.current.forEach(clearTimeout);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, streaming]);
  useEffect(() => {
    if (open && !callMode) setTimeout(() => textareaRef.current?.focus(), 120);
  }, [open, callMode]);

  useEffect(() => {
    if (!open || historyLoaded || !userId) return;
    setHistoryLoaded(true);
    const ctrl = new AbortController();
    fetch(`${BASE}/api/assistant/history?userId=${userId}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((data: { messages: { role: "user" | "assistant"; content: string }[] }) => {
        if (!mountedRef.current || ctrl.signal.aborted) return;
        if (data.messages?.length) {
          setMessages(prev => {
            if (prev.filter(m => m.content !== WELCOME.content).length > 0) return prev;
            return [WELCOME, ...data.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))];
          });
        }
      }).catch(() => {});
    return () => ctrl.abort();
  }, [open, historyLoaded, userId]);

  useEffect(() => {
    if (callMode) {
      setCallDuration(0);
      callTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    } else {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      stopSpeaking(); stopListening();
      pendingTimers.current.forEach(clearTimeout); pendingTimers.current = [];
    }
    return () => {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      stopSpeaking(); stopListening();
      pendingTimers.current.forEach(clearTimeout); pendingTimers.current = [];
    };
  }, [callMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Background always-on mic (auto-restarts after each utterance) ────────────
  const startBackgroundListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    try { recognitionRef.current?.stop(); } catch {}
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    recognitionRef.current = rec;
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      if (alwaysOnRef.current && mountedRef.current) {
        const t = setTimeout(() => {
          if (alwaysOnRef.current && mountedRef.current && !loadingRef.current)
            startBackgroundListening();
        }, 400);
        pendingTimers.current.push(t);
      }
    };
    rec.onerror = (e: Event) => {
      setListening(false);
      const err = (e as Event & { error?: string }).error;
      if (err === "aborted") return;
      if (alwaysOnRef.current && mountedRef.current) {
        const t = setTimeout(() => {
          if (alwaysOnRef.current && mountedRef.current) startBackgroundListening();
        }, 1500);
        pendingTimers.current.push(t);
      }
    };
    rec.onresult = (event: SREvent) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript && !loadingRef.current) sendMessageRef.current(transcript);
    };
    try { rec.start(); } catch { /* mic unavailable */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR || loadingRef.current) return;
    try { recognitionRef.current?.stop(); } catch {}
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
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
    if (listening) stopListening(); else startListening();
  }, [listening, startListening]);

  const toggleAlwaysOn = useCallback(() => {
    setAlwaysOn(prev => {
      const next = !prev;
      if (next) { startBackgroundListening(); }
      else {
        stopListening();
        pendingTimers.current.forEach(clearTimeout);
        pendingTimers.current = [];
      }
      return next;
    });
  }, [startBackgroundListening]);

  // ── Execute map / image / app commands ───────────────────────────────────
  const executeCommand = useCallback(async (command: MapCommand) => {
    // App-level commands — handled by AppCommandHandler via the bus
    if (command.type === "navigate" || command.type === "openInviteForm") {
      dispatchMapCommand(command);
      return;
    }

    if (command.type === "showImages") {
      const imgs = await fetchLocationImages(command.place);
      // Deduplicate: filter out images already shown this session
      const fresh = imgs.filter(img => !shownImagesRef.current.has(img.url));
      const toShow = fresh.length >= 2 ? fresh : imgs; // fallback if all repeat
      toShow.forEach(img => shownImagesRef.current.add(img.url));
      setMessages(prev => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (next[lastIdx]?.role === "assistant") {
          next[lastIdx] = { ...next[lastIdx], images: toShow, command };
        }
        return next;
      });
      return;
    }
    if (command.type === "geocode") {
      const [coords, placeInfo] = await Promise.all([geocodePlace(command.place), fetchPlaceInfo(command.place)]);
      if (coords) {
        dispatchMapCommand({ type: "flyTo", lat: coords.lat, lng: coords.lng, zoom: 13 });
        const parts: string[] = [];
        if (coords.formattedAddress) parts.push(`📍 ${coords.formattedAddress}`);
        const types = placeInfo?.placeTypes?.length ? placeInfo.placeTypes : coords.placeTypes;
        if (types?.length) parts.push(`🏷️ ${types.slice(0, 3).join(", ")}`);
        if (placeInfo?.rating != null) {
          parts.push(`${"★".repeat(Math.round(placeInfo.rating))} ${placeInfo.rating.toFixed(1)}`);
        }
        if (placeInfo?.summary) parts.push(placeInfo.summary.length > 300 ? placeInfo.summary.slice(0, 300) + "…" : placeInfo.summary);
        if (parts.length) setMessages(prev => [...prev, { role: "assistant", content: parts.join("\n") }]);
        if (callModeRef.current && placeInfo?.summary) {
          const t = setTimeout(() => {
            if (!mountedRef.current || !callModeRef.current) return;
            setSpeaking(true);
            speak(placeInfo.summary!, () => {
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
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ Couldn't find **${command.place}** on the map. Showing images instead…` }]);
        // Still show images even if geocoding fails
        const imgs = await fetchLocationImages(command.place);
        if (imgs.length > 0) {
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], images: imgs };
            return next;
          });
        }
        if (callModeRef.current) speak(`Couldn't find ${command.place} on the map.`);
      }
      return;
    }
    dispatchMapCommand(command);
  }, [startListening]);

  // ── Core send with streaming + non-streaming fallback ─────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const msg = (overrideText ?? input).trim();
    if (!msg || loadingRef.current) return;
    if (!overrideText) setInput("");

    const imageToSend = screenCapture;
    if (imageToSend) setScreenCapture(null);

    setMessages(prev => [...prev, {
      role: "user",
      content: imageToSend ? `🖥️ [Screen shared]\n${msg}` : msg,
    }]);
    setLoading(true);

    const mapContext = getMapContext();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const tryStream = !imageToSend;

    try {
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tryStream ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify({
          message: msg,
          mapContext,
          userId: userId ?? undefined,
          ...(imageToSend ? { image: imageToSend } : {}),
        }),
        signal: ctrl.signal,
      });

      // Handle HTTP errors
      if (!resp.ok) {
        let errMsg = `Server error (${resp.status})`;
        try {
          const errData = await resp.json();
          if (errData?.reply) errMsg = errData.reply;
          else if (errData?.error) errMsg = errData.error;
        } catch { /* */ }
        setMessages(prev => [...prev, { role: "assistant", content: errMsg }]);
        return;
      }

      const isSSE = resp.headers.get("content-type")?.includes("text/event-stream") && resp.body;

      // ── Streaming ───────────────────────────────────────────────────────────
      if (isSSE) {
        setStreaming(true);
        setMessages(prev => [...prev, { role: "assistant", content: "", streaming: true }]);

        let fullReply = "";
        let command: MapCommand | null = null;

        for await (const event of readStream(resp)) {
          if (!mountedRef.current) break;
          if (event.type === "token" && event.text) {
            fullReply += event.text;
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.streaming) next[next.length - 1] = { ...last, content: fullReply };
              return next;
            });
          } else if (event.type === "done") {
            command = event.command ?? null;
            if (event.fullReply) fullReply = event.fullReply;
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.streaming) next[next.length - 1] = { role: "assistant", content: fullReply, command, streaming: false };
              return next;
            });
            if (callModeRef.current) {
              setSpeaking(true);
              speak(fullReply, () => {
                if (!mountedRef.current) return;
                setSpeaking(false);
                if (callModeRef.current) pendingTimers.current.push(setTimeout(() => startListening(), 500));
              });
            }
            if (command) await executeCommand(command);
            break;
          } else if (event.type === "error") {
            const errMsg = event.message || "Something went wrong. Please try again.";
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.streaming) next[next.length - 1] = { role: "assistant", content: errMsg, streaming: false };
              return next;
            });
            break;
          }
        }
        setStreaming(false);
        return;
      }

      // ── Non-streaming (vision / fallback) ───────────────────────────────────
      const data = await resp.json();
      const reply: string = data.reply ?? "Sorry, I couldn't process that.";
      const command: MapCommand | null = data.command ?? null;
      setMessages(prev => [...prev, { role: "assistant", content: reply, command }]);
      if (callModeRef.current) {
        setSpeaking(true);
        speak(reply, () => {
          if (!mountedRef.current) return;
          setSpeaking(false);
          if (callModeRef.current) pendingTimers.current.push(setTimeout(() => startListening(), 500));
        });
      }
      if (command) await executeCommand(command);

    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") return;
      console.error("[AssistantWidget] send error:", e);
      const errMsg = "Connection error — please check your network and try again.";
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          next[next.length - 1] = { role: "assistant", content: errMsg, streaming: false };
        } else {
          next.push({ role: "assistant", content: errMsg });
        }
        return next;
      });
      setStreaming(false);
      if (callModeRef.current) speak(errMsg);
    } finally {
      setLoading(false);
    }
  }, [input, userId, startListening, screenCapture, executeCommand]);

  // Keep stable ref so background mic always calls latest sendMessage
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const startCall = useCallback(() => {
    setCallMode(true); setOpen(false); setSpeaking(true);
    speak("PhoneLink AI connected. How can I help you?", () => {
      setSpeaking(false);
      if (callModeRef.current) setTimeout(() => startListening(), 500);
    });
  }, [startListening]);

  const endCall = useCallback(() => { setCallMode(false); }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { if (typeof ev.target?.result === "string") setScreenCapture(ev.target.result); };
    reader.readAsDataURL(file);
  }, []);

  const supportsScreenShare = typeof navigator !== "undefined" &&
    typeof (navigator.mediaDevices as { getDisplayMedia?: unknown })?.getDisplayMedia === "function";

  const captureScreen = useCallback(async () => {
    if (capturingRef.current) return;
    setCaptureError(null);
    if (!supportsScreenShare) { fileInputRef.current?.click(); return; }
    capturingRef.current = true; setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await (navigator.mediaDevices as MediaDevices & { getDisplayMedia(opts?: MediaStreamConstraints): Promise<MediaStream> }).getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
        video.onloadedmetadata = () => { clearTimeout(timer); video.play().then(resolve).catch(reject); };
        video.onerror = () => { clearTimeout(timer); reject(new Error("error")); };
      });
      setOpen(false);
      await new Promise<void>(resolve => {
        let secs = 5; setCountdown(secs);
        const tick = setInterval(() => {
          secs -= 1;
          if (secs <= 0) { clearInterval(tick); setCountdown(null); resolve(); } else setCountdown(secs);
        }, 1000);
        pendingTimers.current.push(tick as unknown as ReturnType<typeof setTimeout>);
      });
      const canvas = document.createElement("canvas");
      const MAX_W = 1280; const scale = Math.min(1, MAX_W / (video.videoWidth || MAX_W));
      canvas.width = Math.round((video.videoWidth || MAX_W) * scale);
      canvas.height = Math.round((video.videoHeight || 720) * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setScreenCapture(canvas.toDataURL("image/jpeg", 0.80));
      setOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel|denied|dismissed|NotAllowed/i.test(msg)) setCaptureError("Screen capture failed. Please try again.");
    } finally {
      stream?.getTracks().forEach(t => t.stop());
      capturingRef.current = false; setCapturing(false); setCountdown(null);
    }
  }, [supportsScreenShare]);

  const clearChat = () => { setMessages([WELCOME]); setHistoryLoaded(false); };

  const ctx = getMapContext();
  const onMap = ctx.onMapPage;
  const contactNames = ctx.contacts?.map(c => c.name).filter(Boolean) ?? [];
  const quickActions = onMap && contactNames.length > 0
    ? [`Where is ${contactNames[0]}?`, "Show all contacts", "Enable heatmap", "Show image of this area"]
    : QUICK_ACTIONS_DEFAULT;
  const showQuickActions = messages.filter(m => m.content !== WELCOME.content).length === 0 && !loading && !streaming;

  return (
    <>
      {/* ── Voice Call Overlay ─────────────────────────────────────────────── */}
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
          <div className="text-xs font-mono mb-14" style={{ color: "#52525b" }}>{formatDuration(callDuration)}</div>
          <div className="flex items-center gap-[3px] mb-14 h-10">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="w-[3px] rounded-full transition-all duration-150"
                style={{
                  height: speaking || listening ? `${10 + Math.abs(Math.sin(i * 0.7 + callDuration * 3)) * 22}px` : "4px",
                  backgroundColor: speaking ? `rgba(99,102,241,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})` : listening ? `rgba(16,185,129,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.5})` : "#3f3f46",
                }} />
            ))}
          </div>
          <div className="flex items-center gap-10">
            <div className="flex flex-col items-center gap-2">
              <button onClick={toggleListening} className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{ background: listening ? "rgba(16,185,129,.25)" : "rgba(255,255,255,.08)", border: `2px solid ${listening ? "rgba(16,185,129,.5)" : "rgba(255,255,255,.12)"}` }}>
                {listening ? <Mic className="w-6 h-6 text-emerald-400" /> : <MicOff className="w-6 h-6 text-zinc-400" />}
              </button>
              <span className="text-[10px] font-mono text-zinc-600">{listening ? "Mute" : "Mic"}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={endCall} className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg"
                style={{ boxShadow: "0 0 30px rgba(220,38,38,.35)" }}>
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">End Call</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={() => setOpen(true)} className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
                style={{ background: "rgba(255,255,255,.08)", border: "2px solid rgba(255,255,255,.12)" }}>
                <Bot className="w-6 h-6 text-zinc-400" />
              </button>
              <span className="text-[10px] font-mono text-zinc-600">Chat</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-700 mt-10">Tap mic · Tap hang up to end</p>
        </div>
      )}

      {/* ── Screenshot countdown ────────────────────────────────────────────── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[120px] font-black tabular-nums leading-none select-none"
            style={{ color: "white", textShadow: "0 0 60px rgba(99,102,241,.9), 0 4px 24px rgba(0,0,0,.8)" }}>
            {countdown}
          </div>
          <p className="mt-4 text-lg font-semibold text-white/80" style={{ textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>Taking screenshot…</p>
        </div>
      )}

      {/* ── FAB ──────────────────────────────────────────────────────────────── */}
      {!callMode && (
        <button onClick={() => setOpen(o => !o)} aria-label="Open AI assistant"
          className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all hover:scale-105 active:scale-95">
          {alwaysOn && (
            <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60" />
          )}
          <Bot className="w-6 h-6" />
          {alwaysOn && listening && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-background flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            </span>
          )}
          {alwaysOn && !listening && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-background" />
          )}
        </button>
      )}

      {/* ── Chat panel ───────────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: "min(80vh, 640px)" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Bot className="w-4 h-4 text-indigo-500" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-background" />
              </div>
              <span className="font-semibold text-sm">PhoneLink AI</span>
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                <Sparkles className="w-2.5 h-2.5" />GPT-4o
              </span>
              {streaming && (
                <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 animate-pulse">
                  <Zap className="w-2.5 h-2.5" />LIVE
                </span>
              )}
              {onMap && !streaming && (
                <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <Map className="w-2.5 h-2.5" />MAP
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={toggleAlwaysOn} aria-label="Toggle always-on mic"
                title={alwaysOn ? "Always-on mic active — click to stop" : "Enable always-on background mic"}
                className={`p-1.5 rounded transition-colors ${alwaysOn ? "text-emerald-400 bg-emerald-500/15 hover:text-emerald-300" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                <Radio className="w-3.5 h-3.5" />
              </button>
              <button onClick={startCall} aria-label="Voice call" title="Start voice call"
                className="p-1.5 rounded hover:bg-muted text-emerald-400 hover:text-emerald-300 transition-colors">
                <Phone className="w-3.5 h-3.5" />
              </button>
              <button onClick={clearChat} aria-label="Clear chat"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="flex flex-col gap-1 max-w-[92%]">
                  <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.role === "assistant"
                      ? <div className="space-y-0.5">
                          {renderMarkdown(m.content || "")}
                          {m.streaming && m.content && (
                            <span className="inline-block w-0.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                          )}
                          {m.images && m.images.length > 0 && m.command?.type === "showImages" && (
                            <ImageGrid images={m.images} place={(m.command as { type: "showImages"; place: string }).place} />
                          )}
                        </div>
                      : <span className="whitespace-pre-wrap">{m.content}</span>
                    }
                  </div>
                  {m.command && m.command.type !== "showImages" && (
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 px-1">
                      <Map className="w-2.5 h-2.5" />
                      <span>{commandLabel(m.command)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && !streaming && (
              <div className="flex justify-start">
                <div className="bg-muted px-3 py-2.5 rounded-xl rounded-bl-sm text-xs flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-[10px] text-muted-foreground opacity-60">Thinking…</span>
                </div>
              </div>
            )}

            {showQuickActions && (
              <div className="pt-1">
                <p className="text-[10px] text-muted-foreground mb-2 font-mono px-1">Try asking:</p>
                <div className="flex flex-wrap gap-1.5">
                  {quickActions.map(action => (
                    <button key={action} onClick={() => sendMessage(action)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-indigo-400 hover:border-indigo-500/40 transition-all">
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
                <button onClick={() => setCaptureError(null)}><X className="w-3 h-3" /></button>
              </div>
            )}
            {screenCapture && (
              <div className="relative mb-2 inline-block">
                <img src={screenCapture} alt="Screen capture preview" className="h-20 rounded-lg border border-border object-cover shadow-sm" />
                <button onClick={() => setScreenCapture(null)} className="absolute -top-1.5 -right-1.5 text-zinc-400 hover:text-zinc-200">
                  <XCircle className="w-4 h-4 fill-background" />
                </button>
                <span className="absolute bottom-1 left-1 text-[9px] font-mono bg-black/60 text-white px-1 rounded">screen</span>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <button onClick={toggleListening} title={listening ? "Stop" : "Voice input"}
                className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border transition-all ${
                  listening ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"}`}>
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
              <button onClick={captureScreen} disabled={capturing}
                className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border transition-all ${
                  screenCapture ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                    : capturing ? "bg-muted/50 border-border text-muted-foreground animate-pulse"
                    : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"}`}>
                {supportsScreenShare ? <Monitor className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
              </button>
              <Textarea ref={textareaRef} value={input}
                onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={
                  screenCapture ? "Ask about your screen…"
                    : listening ? "🎤 Listening…"
                    : streaming ? "Streaming response…"
                    : onMap ? "Navigate map, show images…"
                    : "Ask anything or say 'show image of Lagos'…"
                }
                rows={1} className="flex-1 resize-none text-sm min-h-[36px] max-h-[120px]"
                disabled={loading || listening || streaming}
                style={{ fieldSizing: "content" } as React.CSSProperties} />
              <Button size="icon" onClick={() => sendMessage()}
                disabled={loading || streaming || !input.trim()}
                className="h-9 w-9 shrink-0 bg-indigo-600 hover:bg-indigo-500">
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              <button onClick={startCall} className="text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-2">📞 Voice call</button>
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
    case "flyTo":          return `Flew to ${cmd.lat.toFixed(4)}, ${cmd.lng.toFixed(4)}`;
    case "geocode":        return `Searching "${cmd.place}"…`;
    case "setLayer":       return `${cmd.enabled ? "Enabled" : "Disabled"} ${cmd.layer}`;
    case "fitAll":         return "Fit all contacts in view";
    case "zoomIn":         return "Zoomed in";
    case "zoomOut":        return "Zoomed out";
    case "findContact":    return `Locating: ${cmd.name}`;
    case "goBack":         return "Returned to home view";
    case "showImages":     return `Photos of ${cmd.place}`;
    case "navigate":       return `Navigated to ${cmd.path}`;
    case "openInviteForm": return `Opened invite form${cmd.name ? ` for ${cmd.name}` : ""}`;
  }
}
