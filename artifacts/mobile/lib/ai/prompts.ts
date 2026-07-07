/**
 * System prompts and context formatters for each intent type.
 *
 * Design goals:
 *   - Concise system prompt (< 400 tokens) to leave room for context + response
 *   - Structured <context> block so the model can clearly identify retrieved data
 *   - Action command syntax for app actions
 */

import type { QueryIntent } from './intent';

// ─── Base system prompt ───────────────────────────────────────────────────────

export const BASE_SYSTEM = `\
You are the PhoneLink AI, a private on-device assistant for a location tracking app.
All data stays 100% on-device. You never send data to the cloud.

Guidelines:
- Answer concisely and naturally. Use bullet points for lists.
- When asked about location history, reference specific dates, times, and addresses.
- For pattern analysis, identify actionable insights (e.g. "You typically leave home around 8:30am on weekdays").
- Respect privacy: never speculate beyond the data provided.
- If the context doesn't contain enough data to answer, say so clearly.
- For app actions, respond with a single action tag on its own line at the END of your reply:
  <action>{"type":"START_TRACKING"}</action>
  <action>{"type":"STOP_TRACKING"}</action>
  <action>{"type":"CREATE_NOTE","text":"..."}</action>
  <action>{"type":"SHARE_LOCATION"}</action>`;

// ─── Intent-specific additions ────────────────────────────────────────────────

const INTENT_SUFFIX: Partial<Record<QueryIntent, string>> = {
  location_summary:
    'Summarise the location data chronologically. Group by day. Mention key places and approximate times.',

  pattern_analysis:
    'Identify recurring patterns: most-visited places, typical active hours, day-of-week habits, and notable anomalies.',

  distance_query:
    'Focus on distance and movement statistics. Convert to km or miles as appropriate.',

  route_query:
    'Describe the journey sequence of locations visited, with approximate times if available.',

  note_query:
    'Surface relevant notes. Quote the note text directly.',

  time_query:
    'Focus on the specific date or time window requested.',

  app_action:
    'Confirm the action you are about to perform. End your reply with the action tag.',
};

/** Build the full system prompt for a given intent. */
export function buildSystemPrompt(intent: QueryIntent): string {
  const suffix = INTENT_SUFFIX[intent];
  return suffix ? `${BASE_SYSTEM}\n\nFocus: ${suffix}` : BASE_SYSTEM;
}

// ─── Context formatters ───────────────────────────────────────────────────────

export interface PatternStats {
  topAddresses: Array<{ address: string; visits: number }>;
  activeHourDist: number[];
  dayOfWeekDist: number[];
  totalDays: number;
  totalDistanceKm: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format pattern stats as a compact readable block. */
export function formatPatternContext(stats: PatternStats): string {
  const peakHour = stats.activeHourDist.indexOf(Math.max(...stats.activeHourDist));
  const peakDay  = stats.dayOfWeekDist.indexOf(Math.max(...stats.dayOfWeekDist));

  const topPlaces = stats.topAddresses
    .slice(0, 5)
    .map((a, i) => `  ${i + 1}. ${a.address} (${a.visits} visits)`)
    .join('\n');

  return `\
PATTERN STATISTICS (${stats.totalDays} days tracked, ${stats.totalDistanceKm.toFixed(1)} km total)

Most-visited places:
${topPlaces || '  (no address data)'}

Most active hour: ${peakHour < 12 ? `${peakHour || 12}am` : `${peakHour === 12 ? 12 : peakHour - 12}pm`}
Most active day:  ${DAYS[peakDay] ?? 'unknown'}

Active hours distribution (0–23h):
  ${stats.activeHourDist.map((n, h) => `${h}h:${n}`).join(' ')}

Day-of-week counts:
  ${stats.dayOfWeekDist.map((n, d) => `${DAYS[d]}:${n}`).join(' ')}`;
}

/** Format retrieved RAG documents as a context block. */
export function formatRagContext(
  docs: Array<{ content: string; metadata?: Record<string, unknown> }>,
): string {
  if (docs.length === 0) return 'No relevant location data found for this query.';
  return docs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n');
}

/** Wrap context in the model-visible XML block. */
export function wrapContext(inner: string): string {
  return `<context>\n${inner}\n</context>`;
}

/** Parse an action command out of model output (if any). */
export function parseActionFromResponse(text: string): {
  cleanText: string;
  action: Record<string, unknown> | null;
} {
  const match = text.match(/<action>(\{.*?\})<\/action>/s);
  if (!match) return { cleanText: text.trim(), action: null };

  let action: Record<string, unknown> | null = null;
  try { action = JSON.parse(match[1]); } catch { /* ignore malformed */ }

  const cleanText = text.replace(/<action>.*?<\/action>/s, '').trim();
  return { cleanText, action };
}
