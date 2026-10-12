/**
 * BM25 (крок 05): пошук за словами. Своя реалізація — щоб k1 і b були видні.
 * k1 = 1,2 і b = 0,75 — загальноприйнятий відправний пункт (так само зашиті в SQLite FTS5).
 */
export interface Bm25Options {
  readonly k1: number;
  readonly b: number;
}

export const BM25: Bm25Options = { k1: 1.2, b: 0.75 };

/** Токенізація під українську: \p{L}\p{N} з прапорцем u (\w кирилиці не бачить). Стемінгу немає. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

export interface Bm25Index {
  readonly docs: { readonly id: string; readonly length: number; readonly tf: Map<string, number> }[];
  readonly df: Map<string, number>;
  readonly avgLength: number;
  readonly options: Bm25Options;
}

export function buildBm25(input: readonly { id: string; text: string }[], options: Bm25Options = BM25): Bm25Index {
  const df = new Map<string, number>();
  const docs = input.map(({ id, text }) => {
    const terms = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { id, length: terms.length, tf };
  });
  const avgLength = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  return { docs, df, avgLength, options };
}

export function searchBm25(index: Bm25Index, query: string, topK = 20): { id: string; score: number }[] {
  const { k1, b } = index.options;
  const N = index.docs.length;
  const terms = tokenize(query);
  return index.docs
    .map((d) => {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (f === undefined) continue;
        const n = index.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avgLength)));
      }
      return { id: d.id, score };
    })
    .filter((r) => r.score > 0) // 0 = жодного слова запиту немає
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
    .slice(0, topK);
}
