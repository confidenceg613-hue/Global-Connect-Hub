/**
 * Manages the on-device GGUF model lifecycle:
 *   download → verify → load (via llama.rn) → expose context
 *
 * The model lives in expo-file-system's documentDirectory so it
 * survives app updates and is never uploaded anywhere.
 */
import * as FileSystem from 'expo-file-system';

export type ModelStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'verifying'
  | 'loading'
  | 'ready'
  | 'error';

export interface ModelInfo {
  id: string;
  displayName: string;
  url: string;
  filename: string;
  /** Expected file size in bytes — used for download progress. */
  sizeBytes: number;
  /** Chat template stop tokens. */
  stopTokens: string[];
  /** llama.cpp context size to use (tokens). */
  nCtx: number;
}

/** Recommended models, ordered by quality/size tradeoff for mobile. */
export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'smollm2-1.7b-q4',
    displayName: 'SmolLM2 1.7B (Q4 · ~1.1 GB)',
    url: 'https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    sizeBytes: 1_080_000_000,
    stopTokens: ['<|im_end|>', '</s>'],
    nCtx: 2048,
  },
  {
    id: 'qwen2.5-1.5b-q4',
    displayName: 'Qwen 2.5 1.5B (Q4 · ~1.0 GB)',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 986_000_000,
    stopTokens: ['<|im_end|>', '<|endoftext|>'],
    nCtx: 2048,
  },
  {
    id: 'gemma-2b-q4',
    displayName: 'Gemma 2B (Q4 · ~1.5 GB)',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    sizeBytes: 1_630_000_000,
    stopTokens: ['<end_of_turn>', '<eos>'],
    nCtx: 2048,
  },
];

export const DEFAULT_MODEL_ID = 'smollm2-1.7b-q4';

const MODEL_DIR = `${FileSystem.documentDirectory}phonelink_models/`;

export function modelPath(filename: string): string {
  return `${MODEL_DIR}${filename}`;
}

/** Check whether the model file already exists on disk. */
export async function isModelDownloaded(info: ModelInfo): Promise<boolean> {
  try {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    const stat = await FileSystem.getInfoAsync(modelPath(info.filename));
    return stat.exists;
  } catch {
    return false;
  }
}

/** Delete a downloaded model to free space. */
export async function deleteModel(info: ModelInfo): Promise<void> {
  try {
    await FileSystem.deleteAsync(modelPath(info.filename), { idempotent: true });
  } catch { /* non-critical */ }
}

/**
 * Download a model with progress callbacks.
 * Returns the local file path on success.
 * Throws on network error or cancellation.
 */
export async function downloadModel(
  info: ModelInfo,
  onProgress: (pct: number, bytesWritten: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  const dest = modelPath(info.filename);

  // Remove partial download if it exists
  await FileSystem.deleteAsync(dest, { idempotent: true });

  const task = FileSystem.createDownloadResumable(
    info.url,
    dest,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (signal?.aborted) { task.pauseAsync().catch(() => {}); return; }
      const pct = totalBytesExpectedToWrite > 0
        ? totalBytesWritten / totalBytesExpectedToWrite
        : totalBytesWritten / info.sizeBytes;
      onProgress(Math.min(pct, 1), totalBytesWritten);
    },
  );

  signal?.addEventListener('abort', () => {
    task.pauseAsync()
      .then(() => FileSystem.deleteAsync(dest, { idempotent: true }))
      .catch(() => {});
  });

  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('Download failed — no URI returned');
  return result.uri;
}

// ─── llama.rn context management ─────────────────────────────────────────────
// We keep a singleton loaded context to avoid paying the startup cost every query.

let _llamaModule: typeof import('llama.rn') | null = null;
let _llamaContext: import('llama.rn').LlamaContext | null = null;
let _loadedModelId: string | null = null;

async function getLlamaModule() {
  if (!_llamaModule) {
    try {
      // Dynamic import so the JS bundle still loads on Expo Go / web
      // (llama.rn is only available in dev builds / bare workflow)
      _llamaModule = await import('llama.rn');
    } catch (e) {
      throw new Error('llama.rn is not available in this build. Use a development build with llama.rn installed.');
    }
  }
  return _llamaModule;
}

/** Load a model into the llama.rn context. Reuses an already-loaded context. */
export async function loadModel(
  info: ModelInfo,
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (_loadedModelId === info.id && _llamaContext) return; // already loaded

  onProgress?.('Releasing previous model…');
  await releaseModel();

  const llama = await getLlamaModule();
  onProgress?.('Loading model into memory…');

  _llamaContext = await llama.initLlama({
    model: modelPath(info.filename),
    use_mlock: true,
    n_ctx: info.nCtx,
    n_batch: 512,
    n_threads: 4,          // conservative — avoids thermal throttle
    n_gpu_layers: 0,       // CPU only; set > 0 if Metal / Vulkan available
  });

  _loadedModelId = info.id;
  onProgress?.('Model ready');
}

/** Get the active llama.rn context (throws if not loaded). */
export function getLlamaContext(): import('llama.rn').LlamaContext {
  if (!_llamaContext) throw new Error('Model not loaded — call loadModel() first.');
  return _llamaContext;
}

export function isModelLoaded(modelId?: string): boolean {
  if (!_llamaContext) return false;
  if (modelId) return _loadedModelId === modelId;
  return true;
}

/**
 * Returns the ModelInfo for the currently loaded model, or null.
 * Used by the chat screen to recover activeModel when the model was
 * already in memory from a previous session (avoiding the disabled-input bug).
 */
export function getLoadedModelInfo(): ModelInfo | null {
  if (!_llamaContext || !_loadedModelId) return null;
  return AVAILABLE_MODELS.find((m) => m.id === _loadedModelId) ?? null;
}

/** Release the loaded model to free RAM. */
export async function releaseModel(): Promise<void> {
  try {
    if (_llamaContext) await _llamaContext.release();
  } catch { /* ignore */ }
  _llamaContext = null;
  _loadedModelId = null;
}
