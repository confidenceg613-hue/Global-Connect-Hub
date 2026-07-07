/**
 * Retrieval-Augmented Generation pipeline.
 *
 * Flow:
 *   1. classifyIntent(query)
 *   2. Load relevant docs from SQLite (date-filtered)
 *   3. BM25 retrieval → re-rank with cosine embeddings
 *   4. Supplement with structured stats for pattern/distance queries
 *   5. Build prompt (system + context + conversation history)
 *   6. Run LLM (streaming)
 *   7. Parse action commands from response
 */
import { BM25Engine } from './bm25';
import { embed, rerank } from './embeddings';
import { classifyIntent, timeframeDates } from './intent';
import {
  buildSystemPrompt,
  formatPatternContext,
  formatRagContext,
  wrapContext,
  parseActionFromResponse,
} from './prompts';
import { getRagDocuments, getPatternStats } from '../db/location-repo';
import { runCompletion } from './llm';
import type { ModelInfo } from './model-manager';
import type { CompletionOptions } from './llm';

export interface RagMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagOptions {
  modelInfo: ModelInfo;
  contactToken?: string;   // filter to a specific contact
  conversationHistory?: RagMessage[];
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface RagResult {
  answer: string;
  action: Record<string, unknown> | null;
  intent: string;
  contextDocs: number;
  tokensPerSec: number;
}

const MAX_CONTEXT_DOCS = 8;
const MAX_HISTORY_TURNS = 4; // keep last 4 turns in context to stay within n_ctx

export async function runRag(query: string, opts: RagOptions): Promise<RagResult> {
  const { modelInfo, contactToken, onToken, signal } = opts;
  const history = (opts.conversationHistory ?? []).slice(-MAX_HISTORY_TURNS * 2);

  // ── 1. Classify intent ────────────────────────────────────────────────────
  const { primary: intent, timeframe } = classifyIntent(query);
  const { from, to } = timeframeDates(timeframe);

  // ── 2. Load candidate docs from SQLite ────────────────────────────────────
  let contextText = '';

  if (intent === 'pattern_analysis') {
    // For pattern queries, use pre-computed stats rather than raw docs
    if (contactToken) {
      const stats = await getPatternStats(contactToken);
      contextText = formatPatternContext(stats);
    } else {
      contextText = 'No contact selected for pattern analysis.';
    }
  } else {
    // For all other intents: retrieve docs via BM25
    const docTypes = intent === 'note_query'
      ? ['note']
      : intent === 'route_query'
      ? ['route', 'day']
      : ['day', 'route', 'note'];

    const candidates = await getRagDocuments({
      docTypes,
      contactToken: contactToken || undefined,
      fromDate: from.slice(0, 10),
      toDate: to.slice(0, 10),
      limit: 200,
    });

    if (candidates.length > 0) {
      // ── 3. BM25 retrieval ──────────────────────────────────────────────────
      const engine = new BM25Engine();
      for (const doc of candidates) {
        engine.addDocument(doc.id, doc.content, { date_key: doc.date_key });
      }

      const hits = engine.searchWithRecency(query, MAX_CONTEXT_DOCS * 2);

      // ── 4. Re-rank with trigram embeddings ─────────────────────────────────
      const queryVec = embed(query);
      const reranked = rerank(queryVec, hits, 0.65).slice(0, MAX_CONTEXT_DOCS);

      contextText = formatRagContext(reranked);
    } else {
      contextText = `No location data found for the selected timeframe (${from.slice(0, 10)} → ${to.slice(0, 10)}).`;
    }
  }

  // ── 5. Build messages ─────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(intent);
  const contextBlock = wrapContext(contextText);

  // Inject context as the first user turn so it doesn't bloat the system prompt
  const messages: CompletionOptions['messages'] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: contextBlock },
    { role: 'assistant', content: 'Understood. I have the location context. How can I help?' },
    // Conversation history (alternating user/assistant)
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    // Current query
    { role: 'user', content: query },
  ];

  // ── 6. Run LLM ────────────────────────────────────────────────────────────
  const result = await runCompletion({
    messages,
    maxTokens: 600,
    temperature: intent === 'app_action' ? 0.2 : 0.7,
    modelInfo,
    onToken,
    signal,
  });

  // ── 7. Parse action commands ──────────────────────────────────────────────
  const { cleanText, action } = parseActionFromResponse(result.text);

  return {
    answer: cleanText,
    action,
    intent,
    contextDocs: MAX_CONTEXT_DOCS,
    tokensPerSec: result.tokensPerSec,
  };
}
