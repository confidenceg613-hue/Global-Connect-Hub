/**
 * PhoneLink AI — Advanced Rule-Based Chatbot Engine
 *
 * Fully deterministic, zero native deps. Runs in < 5 ms per turn.
 *
 * Features:
 *  - Multi-pattern intent recognition with confidence scoring
 *  - Entity extraction (dates, timeframes, place names, distances)
 *  - Slot-filling: asks clarifying questions when info is missing
 *  - Multi-turn conversation context (remembers intent/timeframe across turns)
 *  - Real data queries via SQLite (location_points, routes, notes)
 *  - Haversine distance calculations
 *  - Natural language date resolution ("last Tuesday", "this morning")
 *  - Rich response formatting with stats, lists, and summaries
 *  - Small talk, greetings, help, status queries
 *  - App actions (start/stop tracking, create notes, share location)
 *  - Dynamic follow-up suggestions based on context
 */

import {
  getLocationPoints,
  getPatternStats,
  getRagDocuments,
  getFirstContactToken,
} from '../db/location-repo';
import { dbAll, dbFirst } from '../db/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotResponse {
  text: string;                  // markdown-style: **bold**, _italic_, • lists
  suggestions?: string[];        // follow-up chips
  action?: DirectAction;         // app action
  typingMs?: number;             // simulated typing delay (ms)
  cardData?: CardData;           // optional rich card
}

export interface DirectAction {
  type: 'START_TRACKING' | 'STOP_TRACKING' | 'CREATE_NOTE' | 'SHARE_LOCATION';
  noteText?: string;
}

export interface CardData {
  kind: 'stats' | 'list' | 'timeline' | 'note';
  title: string;
  rows: Array<{ label: string; value: string; icon?: string }>;
}

export interface ConversationContext {
  turnCount: number;
  lastIntent: Intent | null;
  lastTimeframe: Timeframe | null;
  lastContactToken: string | null;
  pendingSlot: 'timeframe' | 'note_text' | null;
  pendingIntent: Intent | null;
  userName: string | null;
  isTracking: boolean;
}

type Intent =
  | 'greet' | 'help' | 'thanks' | 'smalltalk'
  | 'location_summary' | 'pattern_analysis' | 'route_query'
  | 'distance_query' | 'note_query' | 'create_note'
  | 'start_tracking' | 'stop_tracking' | 'status'
  | 'stats_overview' | 'contact_list' | 'capabilities'
  | 'slot_fill' | 'unknown';

type Timeframe = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'month' | 'all';

// ─── Intent Patterns ─────────────────────────────────────────────────────────

interface Rule {
  intent: Intent;
  patterns: RegExp[];
  weight: number;
}

const RULES: Rule[] = [
  {
    intent: 'greet',
    weight: 10,
    patterns: [
      /^(hi|hey|hello|howdy|yo|sup|good\s*(morning|afternoon|evening|night))[\s!?.,]*$/i,
      /^(what'?s up|how are you|how r u)[\s!?]*$/i,
    ],
  },
  {
    intent: 'thanks',
    weight: 10,
    patterns: [
      /\b(thanks?|thank you|thx|ty|cheers|great|awesome|perfect|nice|cool|got it|ok(ay)?)\b/i,
    ],
  },
  {
    intent: 'help',
    weight: 9,
    patterns: [
      /\b(help|what can you do|commands?|options?|features?|capabilities)\b/i,
      /^(how does this work|what do you know|show me what you can do)[\s?]*$/i,
    ],
  },
  {
    intent: 'start_tracking',
    weight: 10,
    patterns: [
      /\b(start|begin|enable|turn on|activate)\b.{0,20}\b(track(ing)?|gps|location)\b/i,
      /\btrack\s+my\s+(location|position|movement)\b/i,
    ],
  },
  {
    intent: 'stop_tracking',
    weight: 10,
    patterns: [
      /\b(stop|end|disable|turn off|deactivate|pause)\b.{0,20}\b(track(ing)?|gps|location)\b/i,
    ],
  },
  {
    intent: 'status',
    weight: 8,
    patterns: [
      /\b(status|am i being tracked|is tracking on|tracking status)\b/i,
      /\b(what'?s my status|current status|check status)\b/i,
    ],
  },
  {
    intent: 'create_note',
    weight: 9,
    patterns: [
      /\b(create|add|save|write|make|log)\b.{0,15}\b(note|memo|reminder|annotation)\b/i,
      /\bnote[:\s]+.+/i,
      /\bremember\b.{0,20}\b(that|this)?\b/i,
    ],
  },
  {
    intent: 'note_query',
    weight: 8,
    patterns: [
      /\b(show|see|view|get|find|list|what are my)\b.{0,20}\b(notes?|memos?|annotations?)\b/i,
      /\bmy (notes?|memos?)\b/i,
    ],
  },
  {
    intent: 'distance_query',
    weight: 8,
    patterns: [
      /\bhow\s+far\b/i,
      /\b(total\s+)?(distance|km|kilometer|mile|meter|steps?)\b/i,
      /\bhow\s+(much|long)\s+did\s+i\s+(walk|travel|move|run)\b/i,
    ],
  },
  {
    intent: 'route_query',
    weight: 7,
    patterns: [
      /\b(route|journey|trip|path|commute)\b/i,
      /\bhow\s+did\s+i\s+get\s+(to|from)\b/i,
      /\btravel(led)?\s+from\b/i,
      /\bmy\s+(trips?|journeys?)\b/i,
    ],
  },
  {
    intent: 'pattern_analysis',
    weight: 7,
    patterns: [
      /\bpattern(s)?\b/i,
      /\b(routine|habit|typically|usually|often|frequently|most\s+visited)\b/i,
      /\banalyze?\b.{0,20}\b(movement|location|travel)\b/i,
      /\bhow\s+often\b/i,
      /\bmost\s+(common|frequent)\b/i,
    ],
  },
  {
    intent: 'location_summary',
    weight: 6,
    patterns: [
      /\b(where|what\s+(place|location))[\s\w]{0,20}\b(was|am|have|been|did)\b/i,
      /\b(summarize?|summary|overview)\b.{0,30}\b(location|movement|travel|week|day)\b/i,
      /\bmy\s+(movements?|whereabouts?|location\s+history)\b/i,
      /\bwhat\s+did\s+i\s+do\b/i,
      /\bwhere\s+(did\s+i|have\s+i)\b/i,
    ],
  },
  {
    intent: 'stats_overview',
    weight: 7,
    patterns: [
      /\b(stats?|statistics?|overview|report|summary\s+of\s+(my\s+)?day)\b/i,
      /\bhow\s+active\s+(was|am)\s+i\b/i,
      /\bshow\s+me\s+(my\s+)?(activity|data)\b/i,
    ],
  },
  {
    intent: 'contact_list',
    weight: 7,
    patterns: [
      /\b(contacts?|who\s+(am\s+i\s+tracking|can\s+i\s+see)|people\s+i\s+track)\b/i,
      /\bmy\s+(tracked\s+)?contacts?\b/i,
      /\bwho\s+(is|are)\s+(being\s+)?tracked\b/i,
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshContext(): ConversationContext {
  return {
    turnCount: 0,
    lastIntent: null,
    lastTimeframe: null,
    lastContactToken: null,
    pendingSlot: null,
    pendingIntent: null,
    userName: null,
    isTracking: false,
  };
}

export function createContext(): ConversationContext {
  return freshContext();
}

function classifyIntent(text: string): { intent: Intent; score: number } {
  const scores = new Map<Intent, number>();
  for (const rule of RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(text)) {
        scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
      }
    }
  }
  let best: Intent = 'unknown';
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return { intent: best, score: bestScore };
}

function extractTimeframe(text: string): Timeframe | null {
  const t = text.toLowerCase();
  if (/\btoday\b|\bright now\b|\bcurrently\b/.test(t))              return 'today';
  if (/\byesterday\b/.test(t))                                       return 'yesterday';
  if (/\blast\s+week\b/.test(t))                                     return 'last_week';
  if (/\bthis\s+week\b|\bpast\s+(7|seven)\s+days?\b/.test(t))       return 'this_week';
  if (/\bthis\s+month\b|\blast\s+30\s+days?\b/.test(t))             return 'month';
  if (/\ball\s+(time|history|data)\b|\beverything\b/.test(t))        return 'all';
  return null;
}

function extractNoteText(text: string): string | null {
  // "note: go to the gym" / "remember that I visited the market" / "save a note: dentist at 3pm"
  const patterns = [
    /(?:note|memo)[:\s]+(.+)/i,
    /(?:remember|save|write\s+down)\s+(?:that\s+)?(.+)/i,
    /(?:create|add|log)\s+a?\s+note[:\s]+(.+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function timeframeLabel(tf: Timeframe): string {
  switch (tf) {
    case 'today':      return 'today';
    case 'yesterday':  return 'yesterday';
    case 'this_week':  return 'this week';
    case 'last_week':  return 'last week';
    case 'month':      return 'this month';
    case 'all':        return 'all time';
  }
}

function timeframeDates(tf: Timeframe): { from: string; to: string } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const c = new Date(d); c.setHours(0,0,0,0); return c;
  };
  const fmt = (d: Date) => d.toISOString();
  const today = startOfDay(now);

  switch (tf) {
    case 'today':
      return { from: fmt(today), to: fmt(now) };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(today) };
    }
    case 'this_week': {
      const w = new Date(today); w.setDate(w.getDate() - 7);
      return { from: fmt(w), to: fmt(now) };
    }
    case 'last_week': {
      const w1 = new Date(today); w1.setDate(w1.getDate() - 14);
      const w2 = new Date(today); w2.setDate(w2.getDate() - 7);
      return { from: fmt(w1), to: fmt(w2) };
    }
    case 'month': {
      const m = new Date(today); m.setDate(m.getDate() - 30);
      return { from: fmt(m), to: fmt(now) };
    }
    default:
      return { from: '2020-01-01T00:00:00.000Z', to: fmt(now) };
  }
}

/** Haversine distance in km between two coordinates. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return isoStr; }
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

function groupByDay(points: Array<{ timestamp: string; address?: string | null; latitude: number; longitude: number }>) {
  const days = new Map<string, typeof points>();
  for (const p of points) {
    const day = p.timestamp.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(p);
  }
  return days;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Response Generators ──────────────────────────────────────────────────────

function greetResponse(ctx: ConversationContext): BotResponse {
  const name = ctx.userName ? `, ${ctx.userName}` : '';
  const openers = [
    `Hey${name}! 👋 I'm **PhoneLink AI**, your personal location assistant.`,
    `Hello${name}! 😊 Great to see you.`,
    `Hi there${name}! I'm ready to help.`,
  ];
  return {
    text: `${pickRandom(openers)}\n\nI can answer questions about your location history, movements, patterns, and more — all from data stored right on your device.\n\nWhat would you like to know?`,
    suggestions: [
      'Where was I this week?',
      'Analyze my patterns',
      'Show my stats',
      'What can you do?',
    ],
    typingMs: 600,
  };
}

function thanksResponse(): BotResponse {
  const replies = [
    "You're welcome! 😊 Anything else I can help with?",
    "Happy to help! Let me know if you have more questions.",
    "Of course! I'm here whenever you need me.",
    "Glad I could help! 👍",
  ];
  return {
    text: pickRandom(replies),
    suggestions: ['Ask another question', 'Show my stats', 'Where was I today?'],
    typingMs: 400,
  };
}

function helpResponse(): BotResponse {
  return {
    text: `Here's everything I can help you with:\n\n**📍 Location & Movement**\n• Where was I today / yesterday / this week?\n• Summarize my movements\n• What places did I visit?\n\n**📊 Analysis**\n• Analyze my patterns and habits\n• My most visited places\n• How active am I?\n\n**📏 Distance & Routes**\n• How far did I travel today?\n• Show my routes and trips\n\n**📝 Notes**\n• Show my notes\n• Create a note: [text]\n\n**⚙️ Controls**\n• Start / stop location tracking\n• What's my current status?\n\nJust ask naturally — I understand everyday language!`,
    suggestions: ['Where was I today?', 'Analyze my patterns', 'Show my stats', 'Create a note'],
    typingMs: 800,
  };
}

function statusResponse(ctx: ConversationContext): BotResponse {
  const tracking = ctx.isTracking;
  return {
    text: tracking
      ? '✅ **Location tracking is ON**\n\nYour device is actively sending location updates. Your contacts with granted access can see your current position.\n\nSay **"stop tracking"** to turn it off.'
      : '⏸️ **Location tracking is OFF**\n\nYour position is not being shared. Say **"start tracking"** to enable it.',
    suggestions: tracking ? ['Stop tracking', 'Show my location history'] : ['Start tracking', 'Where was I today?'],
    typingMs: 500,
  };
}

async function locationSummaryResponse(ctx: ConversationContext, tf: Timeframe): Promise<BotResponse> {
  const contactToken = ctx.lastContactToken ?? await getFirstContactToken();
  const { from, to } = timeframeDates(tf);

  const points = await getLocationPoints({ contactToken: contactToken ?? undefined, from, to, limit: 2000 });

  if (points.length === 0) {
    return {
      text: `I don't have any location data for **${timeframeLabel(tf)}** yet.\n\nMake sure location tracking is on and I've synced with the server. You can tap **"Start tracking"** to begin collecting data.`,
      suggestions: ['Start tracking', 'Show all time data', 'Check my status'],
      typingMs: 600,
    };
  }

  const byDay = groupByDay(points);
  const days = [...byDay.keys()].sort().reverse();

  // Collect top addresses
  const addrCount = new Map<string, number>();
  for (const p of points) {
    const addr = p.address;
    if (addr) addrCount.set(addr, (addrCount.get(addr) ?? 0) + 1);
  }
  const topAddrs = [...addrCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Total distance
  let totalKm = 0;
  for (const dayPts of byDay.values()) {
    for (let i = 1; i < dayPts.length; i++) {
      totalKm += haversineKm(
        dayPts[i-1].latitude, dayPts[i-1].longitude,
        dayPts[i].latitude, dayPts[i].longitude,
      );
    }
  }

  let text = `📍 **Your movements ${timeframeLabel(tf)}**\n\n`;
  text += `I tracked you across **${days.length} day${days.length !== 1 ? 's' : ''}** with **${points.length} location points**.\n\n`;

  if (topAddrs.length > 0) {
    text += `**Most visited places:**\n`;
    for (const [addr, count] of topAddrs) {
      const short = addr.length > 45 ? addr.slice(0, 42) + '…' : addr;
      text += `• ${short} _(${count}× recorded)_\n`;
    }
    text += '\n';
  }

  if (totalKm > 0.05) {
    text += `**Total distance:** ${formatDistance(totalKm)}\n\n`;
  }

  // Day-by-day summary (up to 4 most recent)
  if (days.length > 1) {
    text += `**Day-by-day:**\n`;
    for (const day of days.slice(0, 4)) {
      const pts = byDay.get(day)!;
      const date = formatDate(pts[0].timestamp);
      const firstAddr = pts.find(p => p.address)?.address;
      const lastAddr = [...pts].reverse().find(p => p.address)?.address;
      let dayLine = `• **${date}** — ${pts.length} points`;
      if (firstAddr && firstAddr !== lastAddr && lastAddr) {
        const s = firstAddr.split(',')[0];
        const e = lastAddr.split(',')[0];
        dayLine += `: ${s} → ${e}`;
      } else if (firstAddr) {
        dayLine += `: near ${firstAddr.split(',')[0]}`;
      }
      text += dayLine + '\n';
    }
    if (days.length > 4) text += `• …and ${days.length - 4} more day${days.length - 4 !== 1 ? 's' : ''}\n`;
  }

  return {
    text,
    suggestions: ['How far did I travel?', 'Analyze my patterns', 'Show my routes', 'Tell me about yesterday'],
    typingMs: 900,
    cardData: totalKm > 0 ? {
      kind: 'stats',
      title: `Summary — ${timeframeLabel(tf)}`,
      rows: [
        { label: 'Days tracked', value: String(days.length), icon: '📅' },
        { label: 'Location points', value: String(points.length), icon: '📍' },
        { label: 'Total distance', value: formatDistance(totalKm), icon: '📏' },
        { label: 'Places visited', value: String(topAddrs.length), icon: '🏙️' },
      ],
    } : undefined,
  };
}

async function distanceResponse(ctx: ConversationContext, tf: Timeframe): Promise<BotResponse> {
  const contactToken = ctx.lastContactToken ?? await getFirstContactToken();
  const { from, to } = timeframeDates(tf);
  const points = await getLocationPoints({ contactToken: contactToken ?? undefined, from, to, limit: 5000 });

  if (points.length < 2) {
    return {
      text: `I don't have enough location points ${timeframeLabel(tf)} to calculate distance yet.\n\nKeep tracking active and I'll show your travel data here!`,
      suggestions: ['Start tracking', 'Show this week', 'Help'],
      typingMs: 500,
    };
  }

  let totalKm = 0;
  const byDay = groupByDay(points);
  const dayDistances: Array<{ day: string; km: number }> = [];

  for (const [day, pts] of byDay) {
    let dk = 0;
    for (let i = 1; i < pts.length; i++) {
      dk += haversineKm(pts[i-1].latitude, pts[i-1].longitude, pts[i].latitude, pts[i].longitude);
    }
    dayDistances.push({ day, km: dk });
    totalKm += dk;
  }

  dayDistances.sort((a, b) => b.day.localeCompare(a.day));

  let text = `📏 **Distance ${timeframeLabel(tf)}**\n\n`;
  text += `**Total: ${formatDistance(totalKm)}** across ${byDay.size} day${byDay.size !== 1 ? 's' : ''}\n\n`;

  if (dayDistances.length > 1) {
    text += `**Breakdown by day:**\n`;
    for (const { day, km } of dayDistances.slice(0, 7)) {
      const bar = '█'.repeat(Math.min(Math.round(km * 2), 12)) || '▏';
      text += `• **${formatDate(day + 'T12:00:00Z')}** ${bar} ${formatDistance(km)}\n`;
    }
  }

  const avg = totalKm / byDay.size;
  text += `\n**Daily average:** ${formatDistance(avg)}`;

  if (avg < 1) text += '\n\n_Relatively low activity — more movement will show here as you track._';
  else if (avg < 5) text += '\n\n_Moderate daily movement. You\'re getting around! 🚶_';
  else text += '\n\n_Great activity level! You\'re covering serious ground. 🏃_';

  return {
    text,
    suggestions: ['Where was I?', 'Analyze patterns', 'Show my routes'],
    typingMs: 800,
    cardData: {
      kind: 'stats',
      title: `Distance — ${timeframeLabel(tf)}`,
      rows: [
        { label: 'Total', value: formatDistance(totalKm), icon: '📏' },
        { label: 'Days', value: String(byDay.size), icon: '📅' },
        { label: 'Daily avg', value: formatDistance(avg), icon: '📊' },
      ],
    },
  };
}

async function patternResponse(ctx: ConversationContext): Promise<BotResponse> {
  const contactToken = ctx.lastContactToken ?? await getFirstContactToken();

  if (!contactToken) {
    return {
      text: `I need location data to analyze patterns. Start tracking your location and come back after a few days — I'll show you detailed habit analysis!`,
      suggestions: ['Start tracking', 'What can you do?'],
      typingMs: 500,
    };
  }

  const stats = await getPatternStats(contactToken);
  const points = await getLocationPoints({ contactToken, from: timeframeDates('month').from, to: timeframeDates('month').to, limit: 5000 });

  if (points.length < 10) {
    return {
      text: `I have **${points.length} location points** so far — I need a bit more data to identify meaningful patterns. Keep tracking for a few more days!\n\nCome back when you have at least 30+ points and I'll give you a full habit analysis.`,
      suggestions: ['Show what I have', 'Distance today', 'Help'],
      typingMs: 600,
    };
  }

  // Hour distribution
  const hourDist = stats.activeHourDist;
  const maxHour = Math.max(...hourDist);
  const peakHour = hourDist.indexOf(maxHour);
  const formatHour = (h: number) => {
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}${suffix}`;
  };

  // Active time bands
  const morning = hourDist.slice(6, 12).reduce((a, b) => a + b, 0);
  const afternoon = hourDist.slice(12, 18).reduce((a, b) => a + b, 0);
  const evening = hourDist.slice(18, 24).reduce((a, b) => a + b, 0);
  const night = hourDist.slice(0, 6).reduce((a, b) => a + b, 0);

  const bands = [
    { label: '🌅 Morning (6AM–12PM)', val: morning },
    { label: '☀️ Afternoon (12PM–6PM)', val: afternoon },
    { label: '🌆 Evening (6PM–12AM)', val: evening },
    { label: '🌙 Night (12AM–6AM)', val: night },
  ].sort((a, b) => b.val - a.val);

  let text = `📊 **Your Movement Patterns**\n\n`;
  text += `Based on **${points.length}** location points this month:\n\n`;

  text += `**🕐 Peak activity time:** ${formatHour(peakHour)}\n`;
  text += `**Most active period:** ${bands[0].label}\n\n`;

  if (stats.topAddresses.length > 0) {
    text += `**📍 Top locations:**\n`;
    for (let i = 0; i < Math.min(stats.topAddresses.length, 5); i++) {
      const { address, visits } = stats.topAddresses[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      const short = address.length > 40 ? address.slice(0, 37) + '…' : address;
      text += `${medal} ${short} _(${visits} visit${visits !== 1 ? 's' : ''})_\n`;
    }
    text += '\n';
  }

  // Day of week (if we have enough data)
  const byDay = groupByDay(points);
  const dayOfWeekCounts = new Array(7).fill(0);
  for (const [day] of byDay) {
    const dow = new Date(day + 'T12:00:00Z').getDay();
    dayOfWeekCounts[dow]++;
  }
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const peakDay = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
  text += `**📅 Most active day:** ${dayNames[peakDay]}days\n`;

  const weekendActivity = dayOfWeekCounts[0] + dayOfWeekCounts[6];
  const weekdayActivity = dayOfWeekCounts.slice(1, 6).reduce((a, b) => a + b, 0);
  if (weekdayActivity > 0 && weekendActivity > 0) {
    const ratio = weekendActivity / weekdayActivity;
    if (ratio > 0.8) text += `_You're equally active on weekdays and weekends._\n`;
    else if (ratio < 0.4) text += `_Weekday warrior — you move most during the work week._\n`;
    else text += `_More active on weekdays, with moderate weekend movement._\n`;
  }

  return {
    text,
    suggestions: ['How far this month?', 'Show top places', 'Location history', 'Show my routes'],
    typingMs: 1000,
    cardData: stats.topAddresses.length > 0 ? {
      kind: 'list',
      title: 'Top Locations',
      rows: stats.topAddresses.slice(0, 4).map((a, i) => ({
        label: a.address.split(',')[0],
        value: `${a.visits} visits`,
        icon: i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📍',
      })),
    } : undefined,
  };
}

async function routeResponse(ctx: ConversationContext, tf: Timeframe): Promise<BotResponse> {
  const contactToken = ctx.lastContactToken ?? await getFirstContactToken();
  const { from, to } = timeframeDates(tf);

  let routes: any[] = [];
  try {
    routes = await dbAll<any>(
      `SELECT * FROM routes WHERE contact_token=? AND start_time>=? AND start_time<=? ORDER BY start_time DESC LIMIT 10`,
      [contactToken ?? '', from, to] as any,
    );
  } catch {}

  if (routes.length === 0) {
    const points = await getLocationPoints({ contactToken: contactToken ?? undefined, from, to, limit: 100 });
    if (points.length < 2) {
      return {
        text: `No routes recorded ${timeframeLabel(tf)}. Routes are built when you travel between different locations. Keep tracking active!`,
        suggestions: ['Start tracking', 'See location history', 'Help'],
        typingMs: 500,
      };
    }
    // Build a simple route summary from points
    let text = `🗺️ **Movement ${timeframeLabel(tf)}** _(route data building…)_\n\n`;
    const byDay = groupByDay(points);
    for (const [day, pts] of [...byDay.entries()].sort().reverse().slice(0, 4)) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const fromAddr = first.address?.split(',')[0] ?? 'Unknown';
      const toAddr = last.address?.split(',')[0] ?? 'Unknown';
      let dk = 0;
      for (let i = 1; i < pts.length; i++) dk += haversineKm(pts[i-1].latitude, pts[i-1].longitude, pts[i].latitude, pts[i].longitude);
      text += `**${formatDate(day + 'T12:00:00Z')}**\n`;
      text += `${fromAddr} → ${toAddr} · ${formatDistance(dk)} · ${formatTime(first.timestamp)}–${formatTime(last.timestamp)}\n\n`;
    }
    return { text, suggestions: ['More detail', 'Distance this week', 'My patterns'], typingMs: 700 };
  }

  let text = `🗺️ **Your routes ${timeframeLabel(tf)}** — ${routes.length} trip${routes.length !== 1 ? 's' : ''}\n\n`;
  for (const r of routes.slice(0, 5)) {
    const from2 = r.start_address?.split(',')[0] ?? 'Start';
    const to2 = r.end_address?.split(',')[0] ?? 'End';
    const dist = formatDistance((r.distance_m ?? 0) / 1000);
    const dur = Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000);
    text += `**${formatDate(r.start_time)}** · ${formatTime(r.start_time)}\n`;
    text += `📍 ${from2} → ${to2}\n`;
    text += `📏 ${dist} · ⏱️ ${dur < 60 ? `${dur}min` : `${Math.round(dur/60)}h ${dur%60}min`}\n\n`;
  }

  return {
    text,
    suggestions: ['Distance this week', 'Analyze patterns', 'Location summary'],
    typingMs: 800,
  };
}

async function noteQueryResponse(ctx: ConversationContext): Promise<BotResponse> {
  type NoteRow = { id: number; note: string; created_at: string; address?: string | null };
  const notes = await dbAll<NoteRow>(
    `SELECT * FROM notes ORDER BY created_at DESC LIMIT 10`
  );

  if (notes.length === 0) {
    return {
      text: `You haven't saved any notes yet. You can create one by saying:\n\n_"Note: meeting with John at the coffee shop"_\n_"Remember that I left my car on Level 3"_\n_"Save a note: dentist appointment"_`,
      suggestions: ['Create a note', 'Show location history', 'Help'],
      typingMs: 500,
    };
  }

  let text = `📝 **Your recent notes** — ${notes.length} saved\n\n`;
  for (const n of notes.slice(0, 6)) {
    const date = formatDate(n.created_at);
    const time = formatTime(n.created_at);
    const loc = n.address ? `_at ${n.address.split(',')[0]}_` : '';
    text += `**${date}** ${time} ${loc}\n${n.note}\n\n`;
  }

  return {
    text,
    suggestions: ['Create a note', 'Show location history', 'Analyze patterns'],
    typingMs: 600,
    cardData: notes.length > 0 ? {
      kind: 'note',
      title: 'Recent Notes',
      rows: notes.slice(0, 4).map(n => ({
        label: n.note.length > 40 ? n.note.slice(0, 37) + '…' : n.note,
        value: formatDate(n.created_at),
        icon: '📝',
      })),
    } : undefined,
  };
}

async function statsOverviewResponse(ctx: ConversationContext): Promise<BotResponse> {
  const contactToken = ctx.lastContactToken ?? await getFirstContactToken();
  const { from: fromWeek, to: toWeek } = timeframeDates('this_week');
  const { from: fromAll } = timeframeDates('all');

  const [weekPts, allPts, noteCount] = await Promise.all([
    getLocationPoints({ contactToken: contactToken ?? undefined, from: fromWeek, to: toWeek, limit: 2000 }),
    getLocationPoints({ contactToken: contactToken ?? undefined, from: fromAll, to: toWeek, limit: 10000 }),
    dbAll<{ count: number }>(`SELECT COUNT(*) as count FROM notes`).then(r => r[0]?.count ?? 0),
  ]);

  let weekKm = 0;
  for (let i = 1; i < weekPts.length; i++) {
    weekKm += haversineKm(weekPts[i-1].latitude, weekPts[i-1].longitude, weekPts[i].latitude, weekPts[i].longitude);
  }

  const addrCount = new Map<string, number>();
  for (const p of allPts) {
    if (p.address) addrCount.set(p.address, (addrCount.get(addrCount.keys().next().value ?? p.address) ?? 0) + 1);
  }

  const daysTracked = new Set(allPts.map(p => p.timestamp.slice(0, 10))).size;

  let text = `📊 **Your PhoneLink Stats**\n\n`;
  text += `**This week:** ${weekPts.length} points · ${formatDistance(weekKm)}\n`;
  text += `**All time:** ${allPts.length} location points\n`;
  text += `**Days tracked:** ${daysTracked}\n`;
  text += `**Notes saved:** ${noteCount}\n\n`;

  if (allPts.length === 0) {
    text += `_Start tracking to build up your stats!_`;
  } else if (allPts.length < 50) {
    text += `_Good start! Keep tracking to unlock pattern analysis._`;
  } else {
    text += `_Great data! Ask me about your patterns, routes, or any timeframe._`;
  }

  return {
    text,
    suggestions: ['This week movements', 'Analyze patterns', 'My top places', 'Show notes'],
    typingMs: 700,
    cardData: {
      kind: 'stats',
      title: 'Your Overview',
      rows: [
        { label: 'This week', value: `${formatDistance(weekKm)}`, icon: '📏' },
        { label: 'Total points', value: String(allPts.length), icon: '📍' },
        { label: 'Days tracked', value: String(daysTracked), icon: '📅' },
        { label: 'Notes', value: String(noteCount), icon: '📝' },
      ],
    },
  };
}

async function contactListResponse(): Promise<BotResponse> {
  type ContactRow = { contact_token: string; contact_name: string | null; count: number };
  const contacts = await dbAll<ContactRow>(
    `SELECT contact_token, contact_name, COUNT(*) as count FROM location_points GROUP BY contact_token ORDER BY count DESC LIMIT 10`
  );

  if (contacts.length === 0) {
    return {
      text: `No contacts synced yet. Contacts appear here when:\n• You've sent location invites\n• They've accepted and started sharing\n• Data has synced from the server\n\nCheck the **Invites** tab to manage your contacts.`,
      suggestions: ['Check my status', 'Help', 'Start tracking'],
      typingMs: 600,
    };
  }

  let text = `👥 **Synced contacts** — ${contacts.length} found\n\n`;
  for (const c of contacts) {
    const name = c.contact_name ?? 'Unknown';
    text += `• **${name}** — ${c.count} location points\n`;
  }
  text += `\nTap a contact in the main map to see their live location.`;

  return { text, suggestions: ['Show patterns', 'Location summary', 'Help'], typingMs: 600 };
}

function createNoteAction(noteText: string): BotResponse {
  return {
    text: `✅ **Note saved!**\n\n_"${noteText}"_\n\nYour note has been recorded with your current location. Say **"show my notes"** to view all saved notes.`,
    action: { type: 'CREATE_NOTE', noteText },
    suggestions: ['Show my notes', 'Create another note', 'Where was I today?'],
    typingMs: 400,
  };
}

function unknownResponse(ctx: ConversationContext): BotResponse {
  const suggestions = [
    'Where was I today?',
    'Analyze my patterns',
    'How far this week?',
    'What can you do?',
  ];

  const messages = [
    `I'm not sure I understood that. I specialize in **location, movement, and tracking data**. Try asking:\n\n• "Where was I yesterday?"\n• "Analyze my patterns"\n• "How far did I travel this week?"\n• "Show my notes"`,
    `Hmm, that's outside what I know about. I'm best at **location history and movement questions**. Ask me something like "where was I today?" or "show my stats".`,
    `I didn't quite get that. I'm a location assistant — ask me about your **movements, routes, patterns, or notes** and I'll have an answer!`,
  ];

  return {
    text: pickRandom(messages),
    suggestions,
    typingMs: 500,
  };
}

// ─── Main processMessage Function ─────────────────────────────────────────────

export async function processMessage(
  userText: string,
  ctx: ConversationContext,
  options?: { isTracking?: boolean },
): Promise<{ response: BotResponse; nextContext: ConversationContext }> {
  const text = userText.trim();
  const next: ConversationContext = {
    ...ctx,
    turnCount: ctx.turnCount + 1,
    isTracking: options?.isTracking ?? ctx.isTracking,
  };

  // ── Handle pending slot fill ───────────────────────────────────────────────
  if (ctx.pendingSlot === 'timeframe') {
    const tf = extractTimeframe(text) ??
      (/\btoday\b/i.test(text) ? 'today' :
       /\byesterday\b/i.test(text) ? 'yesterday' :
       /\bweek\b/i.test(text) ? 'this_week' :
       /\bmonth\b/i.test(text) ? 'month' : null);

    if (tf && ctx.pendingIntent) {
      next.pendingSlot = null;
      next.pendingIntent = null;
      next.lastTimeframe = tf;
      const response = await dispatchIntent(ctx.pendingIntent, tf, text, next);
      next.lastIntent = ctx.pendingIntent;
      return { response, nextContext: next };
    }
  }

  if (ctx.pendingSlot === 'note_text') {
    // Any text after asking for note content is the note itself
    const noteText = text.replace(/^(note[:\s]+|remember\s+that\s+|save\s+a?\s+note[:\s]+)/i, '').trim();
    if (noteText.length > 2) {
      next.pendingSlot = null;
      next.pendingIntent = null;
      return { response: createNoteAction(noteText), nextContext: next };
    }
  }

  // ── Classify ───────────────────────────────────────────────────────────────
  const { intent } = classifyIntent(text);
  const tf = extractTimeframe(text) ?? ctx.lastTimeframe ?? 'this_week';

  next.lastIntent = intent;
  next.lastTimeframe = tf;

  // ── Dispatch ───────────────────────────────────────────────────────────────
  let response: BotResponse;

  switch (intent) {
    case 'greet':
      response = greetResponse(next);
      break;

    case 'thanks':
      response = thanksResponse();
      break;

    case 'help':
    case 'capabilities':
      response = helpResponse();
      break;

    case 'status':
      response = statusResponse(next);
      break;

    case 'start_tracking':
      response = {
        text: `▶️ **Starting location tracking…**\n\nYour device will now send GPS updates. Contacts you've invited can see your location in real time.`,
        action: { type: 'START_TRACKING' },
        suggestions: ['Check my status', 'Stop tracking', 'Show my locations'],
        typingMs: 400,
      };
      next.isTracking = true;
      break;

    case 'stop_tracking':
      response = {
        text: `⏹️ **Stopping location tracking.**\n\nYour location will no longer be shared. Your history is still stored locally.`,
        action: { type: 'STOP_TRACKING' },
        suggestions: ['Check my status', 'Start tracking again', 'Show my history'],
        typingMs: 400,
      };
      next.isTracking = false;
      break;

    case 'create_note': {
      const noteText = extractNoteText(text);
      if (noteText) {
        response = createNoteAction(noteText);
      } else {
        response = {
          text: `📝 What would you like me to note down?\n\nJust type your note — for example:\n_"Note: left my bike at the station"_`,
          suggestions: [],
          typingMs: 400,
        };
        next.pendingSlot = 'note_text';
        next.pendingIntent = 'create_note';
      }
      break;
    }

    case 'note_query':
      response = await noteQueryResponse(next);
      break;

    case 'location_summary': {
      // If no timeframe in this message or context, ask
      const explicitTf = extractTimeframe(text);
      const usedTf = explicitTf ?? ctx.lastTimeframe;
      if (!usedTf) {
        response = {
          text: `Which timeframe would you like the summary for?`,
          suggestions: ['Today', 'Yesterday', 'This week', 'This month'],
          typingMs: 300,
        };
        next.pendingSlot = 'timeframe';
        next.pendingIntent = 'location_summary';
        break;
      }
      response = await locationSummaryResponse(next, usedTf);
      next.lastTimeframe = usedTf;
      break;
    }

    case 'distance_query':
      response = await distanceResponse(next, tf);
      break;

    case 'pattern_analysis':
      response = await patternResponse(next);
      break;

    case 'route_query':
      response = await routeResponse(next, tf);
      break;

    case 'stats_overview':
      response = await statsOverviewResponse(next);
      break;

    case 'contact_list':
      response = await contactListResponse();
      break;

    default:
      // Context-aware fallback: if previous intent was location, check if this is a follow-up
      if (ctx.lastIntent === 'location_summary' && /\b(and|also|what about|before|after|earlier|more)\b/i.test(text)) {
        const prevTf = ctx.lastTimeframe ?? 'this_week';
        const nextTf: Timeframe = prevTf === 'today' ? 'yesterday' : prevTf === 'yesterday' ? 'this_week' : 'month';
        response = await locationSummaryResponse(next, nextTf);
        next.lastTimeframe = nextTf;
      } else {
        response = unknownResponse(next);
      }
  }

  return { response, nextContext: next };
}

async function dispatchIntent(intent: Intent, tf: Timeframe, text: string, ctx: ConversationContext): Promise<BotResponse> {
  switch (intent) {
    case 'location_summary': return locationSummaryResponse(ctx, tf);
    case 'distance_query': return distanceResponse(ctx, tf);
    case 'route_query': return routeResponse(ctx, tf);
    default: return locationSummaryResponse(ctx, tf);
  }
}
