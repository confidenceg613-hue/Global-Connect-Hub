/**
 * Lightweight character-trigram hash embeddings — zero native deps.
 *
 * Not as powerful as a transformer-based encoder, but fast enough for
 * re-ranking the BM25 candidates on-device in < 1 ms.
 *
 * Algorithm:
 *   1. Generate character trigrams from normalised text
 *   2. Hash each trigram into a dimension (0 … DIM-1) via FNV-1a
 *   3. Accumulate +1 / -1 signs (random projection)
 *   4. L2-normalise the resulting vector
 *   5. Cosine similarity = dot product of two normalised vectors
 */

const DIM = 256;

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function trigrams(text: string): string[] {
  const out: string[] = [];
  const s = ` ${text} `;
  for (let i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
  return out;
}

/** Produce a DIM-dimensional float32 embedding for text. */
export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const tri of trigrams(normalize(text))) {
    const h = fnv1a32(tri);
    const dim = h % DIM;
    const sign = (h >> 16) & 1 ? 1 : -1;
    v[dim] += sign;
  }
  // L2 normalise
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity between two normalised vectors (range -1 … 1). */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Re-rank BM25 hits by blending BM25 score with cosine similarity.
 * Returns hits sorted by combined score.
 */
export function rerank<T extends { content: string; score: number }>(
  queryVec: Float32Array,
  hits: T[],
  alpha = 0.6, // weight for BM25 vs cosine (0 = pure cosine, 1 = pure BM25)
): T[] {
  if (hits.length === 0) return hits;

  const maxBm25 = hits.reduce((m, h) => Math.max(m, h.score), 0);
  const vecs = hits.map((h) => embed(h.content));

  const combined = hits.map((h, i) => ({
    ...h,
    score:
      alpha * (maxBm25 > 0 ? h.score / maxBm25 : 0) +
      (1 - alpha) * Math.max(0, cosineSim(queryVec, vecs[i])),
  }));

  return combined.sort((a, b) => b.score - a.score) as T[];
}
