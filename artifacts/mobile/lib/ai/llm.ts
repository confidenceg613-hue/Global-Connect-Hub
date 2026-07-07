/**
 * LLM completion wrapper around llama.rn.
 *
 * Provides:
 *   - Streaming token delivery (onToken callback)
 *   - Graceful cancellation via AbortSignal
 *   - Automatic stop-token injection from model config
 *   - Generation stats (tokens/sec)
 */
import { getLlamaContext } from './model-manager';
import type { ModelInfo } from './model-manager';

export interface CompletionOptions {
  /** Conversation messages (system / user / assistant). */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Max new tokens to generate. */
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Called with each generated token string. */
  onToken?: (token: string) => void;
  /** Abort via AbortController. */
  signal?: AbortSignal;
  modelInfo: ModelInfo;
}

export interface CompletionResult {
  text: string;
  tokenCount: number;
  tokensPerSec: number;
  stopped: boolean;
}

export async function runCompletion(opts: CompletionOptions): Promise<CompletionResult> {
  const ctx = getLlamaContext();
  const {
    messages,
    maxTokens = 512,
    temperature = 0.7,
    topP = 0.9,
    topK = 40,
    onToken,
    signal,
    modelInfo,
  } = opts;

  let tokens = 0;
  let stopped = false;
  const startMs = Date.now();

  // Build accumulated text from streaming tokens
  let fullText = '';

  await ctx.completion(
    {
      messages,
      n_predict: maxTokens,
      temperature,
      top_p: topP,
      top_k: topK,
      min_p: 0.05,
      stop: modelInfo.stopTokens,
    },
    (data: { token: string }) => {
      if (signal?.aborted) {
        stopped = true;
        return;
      }
      // Filter out bare stop tokens that leaked into the stream
      const tok = data.token;
      if (modelInfo.stopTokens.some((s) => tok.includes(s))) return;

      fullText += tok;
      tokens++;
      onToken?.(tok);
    },
  );

  const elapsed = (Date.now() - startMs) / 1000;

  return {
    text: fullText.trim(),
    tokenCount: tokens,
    tokensPerSec: elapsed > 0 ? tokens / elapsed : 0,
    stopped,
  };
}

/**
 * One-shot non-streaming completion (useful for intent classification
 * or short structured outputs where streaming isn't needed).
 */
export async function runQuickCompletion(
  systemPrompt: string,
  userMessage: string,
  modelInfo: ModelInfo,
  maxTokens = 128,
): Promise<string> {
  const result = await runCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    maxTokens,
    temperature: 0.1,  // low temp for structured outputs
    modelInfo,
  });
  return result.text;
}
