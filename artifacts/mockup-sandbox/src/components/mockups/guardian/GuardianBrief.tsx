import { useEffect, useState, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType = "walking" | "driving" | "stationary" | "running";
type RiskLevel = "safe" | "warning" | "alert";

interface Contact {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  location: string;
  lat: number;
  lng: number;
  speed: number;          // mph
  battery: number;        // %
  accuracy: number;       // meters
  activity: ActivityType;
  heading: string;
  durationMinutes: number;
  risk: RiskLevel;
  knownLocation: boolean;
  briefs: string[];       // rotating AI briefs to simulate live updates
  briefIndex: number;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const INITIAL_CONTACTS: Contact[] = [
  {
    id: "1",
    name: "Sarah Okafor",
    initials: "SO",
    avatarColor: "#6366f1",
    location: "Lincoln Center, Manhattan",
    lat: 40.7724,
    lng: -73.9836,
    speed: 2.9,
    battery: 82,
    accuracy: 4,
    activity: "walking",
    heading: "NE",
    durationMinutes: 14,
    risk: "safe",
    knownLocation: true,
    briefIndex: 0,
    briefs: [
      "Sarah is walking northeast near Lincoln Center, Manhattan at a leisurely pace. She arrived 14 minutes ago and her movement pattern is consistent with her usual Tuesday evening routine. Battery healthy at 82% — no action needed.",
      "Sarah continues her walk along Broadway near W 65th St. Speed has settled at 2.9 mph — she appears to be window shopping or taking a relaxed evening stroll. Signal strong, accuracy within 4 metres.",
      "Sarah is approaching the Columbus Circle area from the north. Her heading and pace suggest she may be walking toward the 59th St subway entrance. All telemetry nominal.",
    ],
  },
  {
    id: "2",
    name: "James Adeyemi",
    initials: "JA",
    avatarColor: "#f59e0b",
    location: "Unknown area — East Flatbush, Brooklyn",
    lat: 40.6501,
    lng: -73.9329,
    speed: 0,
    battery: 31,
    accuracy: 18,
    activity: "stationary",
    heading: "—",
    durationMinutes: 63,
    risk: "warning",
    knownLocation: false,
    briefIndex: 0,
    briefs: [
      "⚠ James has been stationary for 63 minutes at an unrecognised location in East Flatbush, Brooklyn — this area has not appeared in his previous 30-day movement history. Battery is dropping (31%) and GPS accuracy has degraded to 18 m. Consider checking in.",
      "⚠ No movement detected from James in over an hour. The location does not match any of his saved zones or historical patterns. Low battery may indicate the phone is idle or switched to power-save mode. Situation warrants attention.",
      "⚠ James remains stationary in East Flatbush. Cross-referencing against his typical commute windows — this stop is 4.2 miles off his usual Brooklyn–Downtown corridor. Guardian AI flags this as an atypical dwell event.",
    ],
  },
  {
    id: "3",
    name: "Mike Eze",
    initials: "ME",
    avatarColor: "#10b981",
    location: "I-95 North, New Jersey",
    lat: 40.8448,
    lng: -74.1502,
    speed: 71,
    battery: 68,
    accuracy: 6,
    activity: "driving",
    heading: "N",
    durationMinutes: 28,
    risk: "safe",
    knownLocation: true,
    briefIndex: 0,
    briefs: [
      "Mike is driving north on I-95 at 71 mph — within the highway speed range. He's been on the road for 28 minutes and is currently 22 miles south of his registered home zone. Based on current speed and heading, estimated arrival is approximately 19 minutes.",
      "Mike continues northbound on I-95, holding a steady 71 mph. No sudden speed changes or deviation from his usual commute corridor. He is tracking precisely along his Friday-evening home route. All clear.",
      "Mike has just passed Exit 14A based on GPS trajectory. Estimated arrival at home zone revised to 16 minutes. Phone battery at 68% — charging likely not needed. Safe transit in progress.",
    ],
  },
  {
    id: "4",
    name: "Amara Nwosu",
    initials: "AN",
    avatarColor: "#ec4899",
    location: "Victoria Island, Lagos",
    lat: 6.4281,
    lng: 3.4219,
    speed: 0,
    battery: 94,
    accuracy: 8,
    activity: "stationary",
    heading: "—",
    durationMinutes: 7,
    risk: "safe",
    knownLocation: true,
    briefIndex: 0,
    briefs: [
      "Amara is stationary at her registered workplace on Victoria Island, Lagos. She arrived 7 minutes ago and her device shows excellent signal and full battery. This location matches 100% of her Monday–Friday 9 AM arrival events.",
      "Amara remains at the office. Her last movement ended at the main entrance, consistent with previous entries. No anomalies detected — Guardian AI assigns confidence score 98% for routine workday activity.",
      "Amara is inside her known workspace geofence. Battery at 94%, accuracy 8 m — likely near a window or with strong indoor signal. Routine morning check-in confirmed.",
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActivityBadge({ activity }: { activity: ActivityType }) {
  const cfg: Record<ActivityType, { icon: string; label: string; color: string; bg: string }> = {
    walking:    { icon: "🚶", label: "Walking",    color: "#60a5fa", bg: "rgba(96,165,250,0.1)"   },
    running:    { icon: "🏃", label: "Running",    color: "#fb923c", bg: "rgba(251,146,60,0.1)"   },
    driving:    { icon: "🚗", label: "Driving",    color: "#34d399", bg: "rgba(52,211,153,0.1)"   },
    stationary: { icon: "⏸", label: "Stationary", color: "#94a3b8", bg: "rgba(148,163,184,0.1)"  },
  };
  const c = cfg[activity];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider"
      style={{ color: c.color, backgroundColor: c.bg, border: `1px solid ${c.color}30` }}
    >
      <span>{c.icon}</span> {c.label.toUpperCase()}
    </span>
  );
}

function RiskDot({ risk }: { risk: RiskLevel }) {
  const color = risk === "alert" ? "#ef4444" : risk === "warning" ? "#f59e0b" : "#10b981";
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
        style={{ backgroundColor: color }}
      />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: color }} />
    </span>
  );
}

function TelemetryPill({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mb-0.5">{label}</span>
      <span className="text-sm font-mono font-bold text-slate-200">{value}<span className="text-[10px] text-slate-500 font-normal ml-0.5">{unit}</span></span>
    </div>
  );
}

function ContactCard({ contact, tick }: { contact: Contact; tick: number }) {
  const brief = contact.briefs[tick % contact.briefs.length];
  const borderColor =
    contact.risk === "alert"   ? "rgba(239,68,68,0.3)"  :
    contact.risk === "warning" ? "rgba(245,158,11,0.35)" :
                                 "rgba(255,255,255,0.07)";
  const glowColor =
    contact.risk === "alert"   ? "rgba(239,68,68,0.06)"  :
    contact.risk === "warning" ? "rgba(245,158,11,0.07)" :
                                 "transparent";

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 transition-all duration-700"
      style={{
        background: `linear-gradient(135deg, rgba(255,255,255,0.03) 0%, ${glowColor} 100%)`,
        border: `1px solid ${borderColor}`,
        boxShadow: contact.risk !== "safe" ? `0 0 24px ${glowColor}` : "none",
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${contact.avatarColor}, ${contact.avatarColor}99)`, boxShadow: `0 0 12px ${contact.avatarColor}40` }}
          >
            {contact.initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white text-sm">{contact.name}</span>
              <RiskDot risk={contact.risk} />
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
              <span>📍</span>
              <span className={contact.knownLocation ? "" : "text-amber-400"}>{contact.location}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ActivityBadge activity={contact.activity} />
        </div>
      </div>

      {/* AI Brief */}
      <div
        className="rounded-xl p-3 text-[12.5px] leading-relaxed text-slate-300"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex gap-2">
          <span className="text-indigo-400 text-xs font-semibold tracking-widest uppercase flex-shrink-0 mt-0.5">AI</span>
          <span>{brief}</span>
        </div>
      </div>

      {/* Telemetry row */}
      <div className="flex items-center gap-2">
        <TelemetryPill label="Speed"    value={contact.speed}    unit="mph" />
        <TelemetryPill label="Battery"  value={contact.battery}  unit="%" />
        <TelemetryPill label="Accuracy" value={contact.accuracy} unit="m" />
        <TelemetryPill label="Dwell"    value={contact.durationMinutes} unit="min" />
        <div className="ml-auto text-[10px] text-slate-600 font-mono">HDG {contact.heading}</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GuardianBrief() {
  const [contacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [tick, setTick] = useState(0);
  const [analysisTime, setAnalysisTime] = useState(new Date());
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setAnalysing(true);
      setTimeout(() => {
        setTick(t => t + 1);
        setAnalysisTime(new Date());
        setAnalysing(false);
      }, 800);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  const warningContacts = contacts.filter(c => c.risk !== "safe");
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{ background: "linear-gradient(160deg, #08080f 0%, #0d0d1a 60%, #080811 100%)", fontFamily: "system-ui, sans-serif" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.4)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", boxShadow: "0 0 20px rgba(99,102,241,0.4)" }}>
            🛡️
          </div>
          <div>
            <div className="text-white font-bold text-base tracking-tight">Guardian Brief</div>
            <div className="text-[10px] text-indigo-400 font-semibold tracking-widest uppercase">AI Situational Awareness</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Anomaly count */}
          {warningContacts.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <span className="text-amber-400 text-xs font-bold">{warningContacts.length} anomal{warningContacts.length === 1 ? "y" : "ies"} detected</span>
            </div>
          )}

          {/* Live pulse */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[11px] text-emerald-400 font-mono">LIVE</span>
          </div>

          <div className="text-[11px] text-slate-600 font-mono">{contacts.length} contacts monitored</div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">

        {/* Anomaly banner */}
        {warningContacts.length > 0 && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
          >
            <span className="text-amber-400 text-lg">⚠</span>
            <div>
              <div className="text-amber-300 text-xs font-bold tracking-wider">GUARDIAN ALERT</div>
              <div className="text-slate-400 text-[11px] mt-0.5">
                {warningContacts.map(c => c.name).join(" and ")} {warningContacts.length === 1 ? "has" : "have"} an unusual location pattern. Review the brief below.
              </div>
            </div>
          </div>
        )}

        {/* Contact cards */}
        {contacts.map(c => (
          <ContactCard key={c.id} contact={c} tick={tick} />
        ))}
      </div>

      {/* ── Footer ── */}
      <div
        className="px-6 py-3 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase"
            style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}
          >
            Mistral AI
          </div>
          <span className="text-slate-600 text-[10px]">Powering natural-language situation analysis</span>
        </div>
        <div className="flex items-center gap-3">
          {analysing && (
            <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Analysing…
            </div>
          )}
          <span className="text-slate-600 text-[10px] font-mono">Last brief: {fmt(analysisTime)}</span>
        </div>
      </div>
    </div>
  );
}
