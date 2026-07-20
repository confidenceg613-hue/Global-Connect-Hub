import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Shield, RefreshCw, ArrowLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = "safe" | "warning" | "alert";
type ActivityType = "stationary" | "walking" | "running" | "driving" | null;

interface GuardianContact {
  token: string;
  name: string;
  brief: string;
  risk: RiskLevel;
  hasVisuals: boolean;
  photoCount: number;
  videoCount: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  battery: number | null;
  batteryCharging: boolean;
  activity: ActivityType;
  accuracy: number | null;
  minutesSincePing: number;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const REFRESH_SECONDS = 45;

// ── Sub-components ────────────────────────────────────────────────────────────

function ActivityBadge({ activity }: { activity: ActivityType }) {
  const cfg: Record<NonNullable<ActivityType>, { icon: string; label: string; color: string; bg: string }> = {
    walking:    { icon: "🚶", label: "Walking",    color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
    running:    { icon: "🏃", label: "Running",    color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
    driving:    { icon: "🚗", label: "Driving",    color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
    stationary: { icon: "⏸",  label: "Stationary", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  };
  const c = activity ? cfg[activity] : cfg.stationary;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase"
      style={{ color: c.color, backgroundColor: c.bg, border: `1px solid ${c.color}30` }}
    >
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}

function RiskPulse({ risk }: { risk: RiskLevel }) {
  const color =
    risk === "alert"   ? "#ef4444" :
    risk === "warning" ? "#f59e0b" : "#10b981";
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: color }} />
    </span>
  );
}

function TelemetryPill({ label, value, unit }: { label: string; value: string | number | null; unit?: string }) {
  if (value === null) return null;
  return (
    <div
      className="flex flex-col items-center px-3 py-1.5 rounded-lg"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <span className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mb-0.5">{label}</span>
      <span className="text-sm font-mono font-bold text-slate-200">
        {value}
        {unit && <span className="text-[10px] text-slate-500 font-normal ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function ContactCard({ contact }: { contact: GuardianContact }) {
  const borderColor =
    contact.risk === "alert"   ? "rgba(239,68,68,0.35)"  :
    contact.risk === "warning" ? "rgba(245,158,11,0.35)" :
                                 "rgba(255,255,255,0.08)";
  const glowBg =
    contact.risk === "alert"   ? "rgba(239,68,68,0.05)"  :
    contact.risk === "warning" ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.015)";

  // Initials + avatar colour deterministically from name
  const initials = contact.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = contact.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const avatarColor = `hsl(${hue},55%,50%)`;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 transition-all duration-500"
      style={{
        background: `linear-gradient(135deg, ${glowBg} 0%, rgba(0,0,0,0.25) 100%)`,
        border: `1px solid ${borderColor}`,
        boxShadow: contact.risk !== "safe" ? `0 0 28px ${glowBg}` : "none",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}99)`, boxShadow: `0 0 14px ${avatarColor}40` }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white text-sm truncate">{contact.name}</span>
              <RiskPulse risk={contact.risk} />
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1 truncate">
              <span className="flex-shrink-0">📍</span>
              <span className={cn("truncate", !contact.address && "text-slate-600 italic")}>
                {contact.address ?? "Location unavailable"}
              </span>
            </div>
          </div>
        </div>
        <ActivityBadge activity={contact.activity} />
      </div>

      {/* AI Brief */}
      <div
        className="rounded-xl p-3 text-[12.5px] leading-relaxed text-slate-300"
        style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex gap-2">
          <span className="text-indigo-400 text-[10px] font-bold tracking-widest uppercase flex-shrink-0 mt-0.5 pt-px">AI</span>
          <span>{contact.brief}</span>
        </div>
        {/* Vision / media badge */}
        {(contact.hasVisuals || contact.videoCount > 0) && (
          <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {contact.hasVisuals && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
                style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}
              >
                📸 {contact.photoCount} frame{contact.photoCount !== 1 ? "s" : ""} analysed
              </span>
            )}
            {contact.videoCount > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
              >
                🎥 {contact.videoCount} video clip{contact.videoCount !== 1 ? "s" : ""}
              </span>
            )}
            {contact.hasVisuals && (
              <span className="text-[9px] text-slate-600 ml-auto">Vision · Pixtral</span>
            )}
          </div>
        )}
      </div>

      {/* Telemetry */}
      <div className="flex items-center gap-2 flex-wrap">
        {contact.battery !== null && (
          <TelemetryPill
            label="Battery"
            value={`${contact.battery}%${contact.batteryCharging ? " ⚡" : ""}`}
          />
        )}
        {contact.accuracy !== null && (
          <TelemetryPill label="Accuracy" value={`±${Math.round(contact.accuracy)}`} unit="m" />
        )}
        <TelemetryPill
          label="Last Ping"
          value={contact.minutesSincePing < 999 ? contact.minutesSincePing : "—"}
          unit={contact.minutesSincePing < 999 ? "min" : undefined}
        />
        {contact.lat !== null && contact.lng !== null && (
          <a
            href={`https://maps.google.com/?q=${contact.lat},${contact.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[10px] text-slate-600 hover:text-indigo-400 transition-colors font-mono"
          >
            {contact.lat.toFixed(4)}, {contact.lng.toFixed(4)} ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GuardianPage() {
  const { userId } = useAuth();
  const [contacts, setContacts] = useState<GuardianContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBriefs = useCallback(async () => {
    if (!userId) return;
    try {
      setGenerating(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/guardian/brief?userId=${userId}`);
      if (!res.ok) throw new Error("Failed to fetch briefs");
      const data = await res.json() as { results: GuardianContact[] };
      setContacts(data.results);
      setLastRefresh(new Date());
      setCountdown(REFRESH_SECONDS);
    } catch {
      setError("Could not reach Guardian Brief. Retrying shortly.");
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    fetchBriefs();
  }, [fetchBriefs]);

  // Auto-refresh every REFRESH_SECONDS
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchBriefs();
          return REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [fetchBriefs]);

  const warningContacts = contacts.filter(c => c.risk !== "safe");
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] animate-in fade-in duration-300">
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.2)" }}
      >
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground mr-1">
              <ArrowLeft size={16} />
            </Button>
          </Link>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", boxShadow: "0 0 20px rgba(99,102,241,0.35)" }}
          >
            🛡️
          </div>
          <div>
            <div className="text-white font-bold text-base tracking-tight">Guardian Brief</div>
            <div className="text-[10px] text-indigo-400 font-semibold tracking-widest uppercase">AI Situational Awareness</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {warningContacts.length > 0 && (
            <div
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}
            >
              <span className="text-amber-400 text-xs font-bold">
                {warningContacts.length} anomal{warningContacts.length === 1 ? "y" : "ies"} detected
              </span>
            </div>
          )}

          {/* Live indicator */}
          <div className="flex items-center gap-2">
            {generating ? (
              <Loader2 size={12} className="text-indigo-400 animate-spin" />
            ) : (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            <span className={cn("text-[11px] font-mono", generating ? "text-indigo-400" : "text-emerald-400")}>
              {generating ? "GENERATING" : "LIVE"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchBriefs}
            disabled={generating}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
            <span className="text-slate-600 font-mono">{countdown}s</span>
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 py-5 flex flex-col gap-3 max-w-4xl mx-auto w-full">

        {/* Loading skeleton */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.3), rgba(124,58,237,0.3))", border: "1px solid rgba(99,102,241,0.3)" }}
            >
              🛡️
            </div>
            <div className="text-center">
              <p className="text-white font-medium mb-1">Generating intelligence briefs…</p>
              <p className="text-sm text-muted-foreground">Mistral AI is analysing your contacts' live telemetry</p>
            </div>
            <Loader2 size={20} className="text-indigo-400 animate-spin" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <span className="text-red-400 text-lg">⚠</span>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* No contacts */}
        {!loading && !error && contacts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Shield size={28} className="text-slate-600" />
            </div>
            <div>
              <p className="text-white font-semibold mb-1">No active contacts</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Guardian Brief activates when contacts accept your invite and begin sharing their location.
              </p>
            </div>
            <Link href="/invites">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white mt-2">
                Send an Invite
              </Button>
            </Link>
          </div>
        )}

        {/* Anomaly banner */}
        {!loading && warningContacts.length > 0 && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
          >
            <span className="text-amber-400 text-xl flex-shrink-0">⚠</span>
            <div>
              <div className="text-amber-300 text-xs font-bold tracking-wider uppercase">Guardian Alert</div>
              <div className="text-slate-400 text-[12px] mt-0.5">
                {warningContacts.map(c => c.name).join(" and ")}{" "}
                {warningContacts.length === 1 ? "has" : "have"} an unusual location pattern. Review the brief{warningContacts.length > 1 ? "s" : ""} below.
              </div>
            </div>
          </div>
        )}

        {/* Contact cards */}
        {!loading && contacts.map(c => (
          <ContactCard key={c.token} contact={c} />
        ))}
      </div>

      {/* ── Footer ── */}
      {!loading && contacts.length > 0 && (
        <div
          className="px-6 py-3 flex items-center justify-between flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase"
              style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}
            >
              <Zap size={8} className="inline mr-0.5 -mt-px" />
              Mistral AI
            </div>
            <span className="text-slate-600 text-[10px]">Natural-language situation analysis</span>
          </div>
          {lastRefresh && (
            <span className="text-slate-600 text-[10px] font-mono">
              Last brief: {fmt(lastRefresh)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
