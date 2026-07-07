/**
 * Rule-based intent classifier — keyword patterns matched against user query.
 *
 * Runs synchronously in < 1 ms; no model inference needed for routing.
 */

export type QueryIntent =
  | 'location_summary'    // "where was I", "summarize my movements"
  | 'pattern_analysis'    // "my patterns", "routine", "frequently visit"
  | 'route_query'         // "route from X to Y", "how did I get to"
  | 'time_query'          // "last Tuesday at 3pm", "yesterday morning"
  | 'note_query'          // "my notes", "what did I write about"
  | 'distance_query'      // "how far", "total distance", "km this week"
  | 'app_action'          // "start tracking", "stop", "share my location"
  | 'general';            // fallback

interface IntentPattern {
  intent: QueryIntent;
  patterns: RegExp[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'app_action',
    weight: 10,
    patterns: [
      /\b(start|begin|stop|pause|resume)\s+(tracking|location|gps)\b/i,
      /\bshare\s+(my\s+)?location\b/i,
      /\bcreate\s+(a\s+)?note\b/i,
      /\badd\s+(a\s+)?note\b/i,
      /\bset\s+(home|work|gym|school)\b/i,
    ],
  },
  {
    intent: 'location_summary',
    weight: 5,
    patterns: [
      /\b(where|what place|what location).{0,20}\b(was|am|have)\b/i,
      /\b(summarize|summary|overview)\b.{0,30}\b(movement|location|week|day|month|travel)\b/i,
      /\bmy (movements?|whereabouts|locations?)\b/i,
      /\b(week|day|month)\s*(in\s*)?review\b/i,
      /\bwhat (did|do)\s+i\s+do\b/i,
    ],
  },
  {
    intent: 'pattern_analysis',
    weight: 5,
    patterns: [
      /\bpattern(s)?\b/i,
      /\bfrequent(ly)?\s+(visit|go|been)\b/i,
      /\b(routine|habit|typically|usually|often)\b/i,
      /\banalyze?\b/i,
      /\bmost\s+(visited|common)\b/i,
      /\bhow\s+often\b/i,
    ],
  },
  {
    intent: 'route_query',
    weight: 5,
    patterns: [
      /\broute\b/i,
      /\b(how|which way)\s+(did|do)\s+i\s+get\b/i,
      /\bjourney\b/i,
      /\btravel(led)?\s+from\b/i,
      /\bpath\s+(from|between)\b/i,
    ],
  },
  {
    intent: 'distance_query',
    weight: 5,
    patterns: [
      /\bhow\s+far\b/i,
      /\bdistance\b/i,
      /\b(total\s+)?(km|kilometer|mile|meter)\b/i,
      /\bhow\s+much\s+.{0,20}walk\b/i,
    ],
  },
  {
    intent: 'note_query',
    weight: 5,
    patterns: [
      /\bnote(s)?\b/i,
      /\bwhat.{0,20}(write|wrote|note(d)?)\b/i,
      /\bannotation(s)?\b/i,
    ],
  },
  {
    intent: 'time_query',
    weight: 3,
    patterns: [
      /\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\byesterday\b/i,
      /\b(this|last)\s+(week|month|morning|afternoon|evening|night)\b/i,
      /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
      /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    ],
  },
];

export interface ClassifiedIntent {
  primary: QueryIntent;
  timeframe: Timeframe;
  action?: AppActionType;
}

export type Timeframe = 'today' | 'yesterday' | 'week' | 'month' | 'all';

export type AppActionType =
  | 'START_TRACKING'
  | 'STOP_TRACKING'
  | 'CREATE_NOTE'
  | 'SHARE_LOCATION';

/** Classify a user query into an intent + timeframe. */
export function classifyIntent(query: string): ClassifiedIntent {
  const q = query.toLowerCase();

  // Score each intent
  const scores = new Map<QueryIntent, number>();
  for (const { intent, patterns, weight } of INTENT_PATTERNS) {
    for (const re of patterns) {
      if (re.test(query)) {
        scores.set(intent, (scores.get(intent) ?? 0) + weight);
      }
    }
  }

  // Pick highest scoring intent
  let primary: QueryIntent = 'general';
  let best = 0;
  for (const [intent, score] of scores) {
    if (score > best) { best = score; primary = intent; }
  }

  // Parse timeframe
  let timeframe: Timeframe = 'week'; // default
  if (/\btoday\b/.test(q))                    timeframe = 'today';
  else if (/\byesterday\b/.test(q))            timeframe = 'yesterday';
  else if (/\bthis\s+week\b/.test(q))         timeframe = 'week';
  else if (/\blast\s+week\b/.test(q))         timeframe = 'week';
  else if (/\bthis\s+month\b/.test(q))        timeframe = 'month';
  else if (/\blast\s+month\b/.test(q))        timeframe = 'month';
  else if (/\ball\s+(time|history)\b/.test(q)) timeframe = 'all';

  // Detect app action
  let action: AppActionType | undefined;
  if (primary === 'app_action') {
    if (/\bstart\b|\bbegin\b/.test(q))  action = 'START_TRACKING';
    else if (/\bstop\b|\bpause\b/.test(q)) action = 'STOP_TRACKING';
    else if (/\bshare\b/.test(q))       action = 'SHARE_LOCATION';
    else if (/\bnote\b/.test(q))        action = 'CREATE_NOTE';
  }

  return { primary, timeframe, action };
}

/** Returns ISO date strings [from, to] for a timeframe. */
export function timeframeDates(tf: Timeframe): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`;

  const today = new Date(now); today.setHours(0, 0, 0, 0);
  switch (tf) {
    case 'today': {
      return { from: fmt(today), to: now.toISOString() };
    }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(today) };
    }
    case 'week': {
      const w = new Date(today); w.setDate(w.getDate() - 7);
      return { from: fmt(w), to: now.toISOString() };
    }
    case 'month': {
      const m = new Date(today); m.setDate(m.getDate() - 30);
      return { from: fmt(m), to: now.toISOString() };
    }
    case 'all':
    default:
      return { from: '2020-01-01T00:00:00.000Z', to: now.toISOString() };
  }
}
