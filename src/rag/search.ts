/** Гібридний пошук (крок 05): вектор + BM25 → RRF. */
import { buildBm25, searchBm25, type Bm25Index } from './bm25';
import type { Embedder } from './embed';
import { rrf, RRF_K } from './rrf';
import type { IndexFile, IndexedChunk } from './store';

/** Скільки беремо з кожної гілки ДО злиття. */
export const DEPTH = 20;

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface Scored {
  readonly id: string;
  readonly score: number;
}

export interface Ranked {
  /** Усі фрагменти за косинусом, від найкращого. */
  readonly vector: Scored[];
  /** Фрагменти з хоч одним словом запиту, за BM25. */
  readonly words: Scored[];
  /** RRF по топ-DEPTH кожної гілки. */
  readonly fused: Scored[];
}

export interface Hit {
  readonly chunk: IndexedChunk;
  readonly rrf: number;
  readonly cosine: number;
  /** Ранги з 1; null — цієї гілки фрагмент не знайшла (у топ-DEPTH). */
  readonly rankVector: number | null;
  readonly rankWords: number | null;
}

export function bm25From(index: IndexFile): Bm25Index {
  return buildBm25(index.chunks.map((c) => ({ id: c.id, text: c.text })));
}

export function rankLists(index: IndexFile, words: Bm25Index, queryVector: readonly number[], query: string): Ranked {
  const vector = index.chunks
    .map((c) => ({ id: c.id, score: cosine(queryVector, c.vector) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const wordList = searchBm25(words, query, index.chunks.length);
  const fused = rrf(
    [vector.slice(0, DEPTH).map((r) => r.id), wordList.slice(0, DEPTH).map((r) => r.id)],
    RRF_K,
  );
  return { vector, words: wordList, fused };
}

const rankOf = (list: readonly Scored[], id: string): number | null => {
  const i = list.findIndex((r) => r.id === id);
  return i < 0 ? null : i + 1;
};

export async function hybridSearch(
  index: IndexFile,
  words: Bm25Index,
  embedder: Embedder,
  query: string,
  topK = 8,
): Promise<Hit[]> {
  const r = rankLists(index, words, await embedder.embedQuery(query), query);
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const cos = new Map(r.vector.map((x) => [x.id, x.score]));
  const hits: Hit[] = [];
  for (const { id, score } of r.fused.slice(0, topK)) {
    const chunk = byId.get(id);
    if (!chunk) continue;
    hits.push({
      chunk,
      rrf: score,
      cosine: cos.get(id) ?? 0,
      rankVector: rankOf(r.vector.slice(0, DEPTH), id),
      rankWords: rankOf(r.words.slice(0, DEPTH), id),
    });
  }
  return hits;
}

/** Те саме, що hybridSearch, плюс косинус найкращого фрагмента всієї колекції (для правила відмови). */
export async function retrieve(
  index: IndexFile,
  words: Bm25Index,
  embedder: Embedder,
  query: string,
  topK = 8,
): Promise<{ hits: Hit[]; bestCosine: number }> {
  const r = rankLists(index, words, await embedder.embedQuery(query), query);
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const cos = new Map(r.vector.map((x) => [x.id, x.score]));
  const hits: Hit[] = [];
  for (const { id, score } of r.fused.slice(0, topK)) {
    const chunk = byId.get(id);
    if (!chunk) continue;
    hits.push({
      chunk,
      rrf: score,
      cosine: cos.get(id) ?? 0,
      rankVector: rankOf(r.vector.slice(0, DEPTH), id),
      rankWords: rankOf(r.words.slice(0, DEPTH), id),
    });
  }
  return { hits, bestCosine: r.vector[0]?.score ?? 0 };
}
