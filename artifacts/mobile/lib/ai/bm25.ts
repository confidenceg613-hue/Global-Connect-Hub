/**
 * BM25Okapi retrieval engine — pure TypeScript, zero dependencies.
 *
 * Parameters follow Okapi BM25 standard defaults (k1=1.5, b=0.75).
 * Usage:
 *   const engine = new BM25Engine();
 *   engine.addDocument(0, 'Visited Starbucks on Monday morning', { date: '2025-04-01' });
 *   engine.addDocument(1, 'Route from home to office downtown', { date: '2025-04-02' });
 *   const hits = engine.search('coffee morning Monday', 5);
 */

export interface BM25Doc {
  id: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BM25Hit {
  id: number;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','of','for','is','it',
  'was','are','be','this','that','with','by','from','have','has','had','not',
  'as','do','did','my','i','me','we','us','you','your','he','she','they',
  'their','its','what','which','who','when','where','how',
]);

export class BM25Engine {
  private k1 = 1.5;
  private b  = 0.75;

  private docs      = new Map<number, BM25Doc>();
  private termIndex = new Map<string, { df: number; postings: Map<number, number> }>();
  private docLens   = new Map<number, number>();
  private avgLen    = 0;

  // ── Indexing ────────────────────────────────────────────────────────────────

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }

  addDocument(id: number, content: string, metadata?: Record<string, unknown>): void {
    const tokens = this.tokenize(content);
    this.docs.set(id, { id, content, metadata });
    this.docLens.set(id, tokens.length);

    // Term frequencies for this doc
    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    for (const [term, freq] of tf) {
      if (!this.termIndex.has(term)) {
        this.termIndex.set(term, { df: 0, postings: new Map() });
      }
      const entry = this.termIndex.get(term)!;
      if (!entry.postings.has(id)) entry.df++;
      entry.postings.set(id, freq);
    }

    this._recomputeAvg();
  }

  removeDocument(id: number): void {
    if (!this.docs.has(id)) return;
    const { content } = this.docs.get(id)!;
    const tokens = new Set(this.tokenize(content));
    for (const term of tokens) {
      const entry = this.termIndex.get(term);
      if (!entry) continue;
      if (entry.postings.delete(id)) entry.df--;
      if (entry.postings.size === 0) this.termIndex.delete(term);
    }
    this.docs.delete(id);
    this.docLens.delete(id);
    this._recomputeAvg();
  }

  clear(): void {
    this.docs.clear();
    this.termIndex.clear();
    this.docLens.clear();
    this.avgLen = 0;
  }

  get size(): number { return this.docs.size; }

  // ── Retrieval ───────────────────────────────────────────────────────────────

  search(query: string, topK = 5): BM25Hit[] {
    const N = this.docs.size;
    if (N === 0) return [];

    const terms = this.tokenize(query);
    const scores = new Map<number, number>();

    for (const term of terms) {
      const entry = this.termIndex.get(term);
      if (!entry) continue;

      // IDF — smooth Robertson formula
      const idf = Math.log((N - entry.df + 0.5) / (entry.df + 0.5) + 1);

      for (const [docId, tf] of entry.postings) {
        const dl   = this.docLens.get(docId) ?? 0;
        const norm = 1 - this.b + this.b * (dl / Math.max(1, this.avgLen));
        const tfScore = (tf * (this.k1 + 1)) / (tf + this.k1 * norm);
        scores.set(docId, (scores.get(docId) ?? 0) + idf * tfScore);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => {
        const doc = this.docs.get(id)!;
        return { id, score, content: doc.content, metadata: doc.metadata };
      });
  }

  /**
   * Hybrid score: BM25 + a simple date-recency bonus.
   * dateKey: 'YYYY-MM-DD' stored in metadata.date_key
   */
  searchWithRecency(query: string, topK = 5, recencyWeight = 0.15): BM25Hit[] {
    const hits = this.search(query, topK * 3); // oversample, then re-rank
    if (hits.length === 0) return [];

    const maxBm25 = hits[0].score;
    const now = Date.now();

    const rescored = hits.map((h) => {
      const dateKey = h.metadata?.date_key as string | undefined;
      let recency = 0;
      if (dateKey) {
        const ageDays = (now - new Date(dateKey).getTime()) / 86_400_000;
        recency = Math.exp(-ageDays / 30); // half-life ≈ 21 days
      }
      const bm25Norm = maxBm25 > 0 ? h.score / maxBm25 : 0;
      return { ...h, score: (1 - recencyWeight) * bm25Norm + recencyWeight * recency };
    });

    return rescored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _recomputeAvg(): void {
    if (this.docLens.size === 0) { this.avgLen = 0; return; }
    let sum = 0;
    for (const l of this.docLens.values()) sum += l;
    this.avgLen = sum / this.docLens.size;
  }
}
