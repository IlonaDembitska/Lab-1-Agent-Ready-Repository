/**
 * Пошук із поясненням (крок 05). Потрібна локальна Ollama (ембедінг запиту).
 *   npx tsx scripts/search.ts "питання" --explain   — три списки поруч
 *   npx tsx scripts/search.ts --golden              — ранги потрібного документа для всіх запитів набору
 */
import { readFileSync } from 'node:fs';

import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, DEPTH, rankLists, type Scored } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

const embedder = ollamaEmbedder();
const index = loadIndex('data/index.json', embedder);
const words = bm25From(index);

/** Найкращий ранг будь-якого фрагмента з потрібних документів (з 1), або null. */
function docRank(list: readonly Scored[], docs: readonly string[]): number | null {
  const i = list.findIndex((r) => docs.some((d) => r.id.startsWith(`${d}#`)));
  return i < 0 ? null : i + 1;
}

const fmt = (n: number | null) => (n === null ? '—' : String(n));

async function explain(query: string): Promise<void> {
  const r = rankLists(index, words, await embedder.embedQuery(query), query);
  const col = (list: readonly Scored[], i: number, digits: number) => {
    const x = list[i];
    return x ? `${String(i + 1).padStart(2)} ${x.id.padEnd(12)} ${x.score.toFixed(digits)}` : '';
  };
  console.log('вектор (cosine)               | слова (BM25)                 | RRF (k=60)');
  for (let i = 0; i < 5; i += 1) {
    console.log(`${col(r.vector, i, 4).padEnd(30)}| ${col(r.words, i, 2).padEnd(29)}| ${col(r.fused, i, 5)}`);
  }
}

async function golden(): Promise<void> {
  const rows = readFileSync('docs/lab2/golden/queries.jsonl', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { id: string; query: string; must_cite: string[]; tags: string[] });
  console.log('id    теги                cos1   bm25max | ранг потрібного документа: вектор / слова / RRF');
  for (const q of rows) {
    const r = rankLists(index, words, await embedder.embedQuery(q.query), q.query);
    const v = docRank(r.vector, q.must_cite);
    const w = docRank(r.words, q.must_cite);
    const f = docRank(r.fused, q.must_cite);
    console.log(
      `${q.id}  ${q.tags.join(',').padEnd(18)} ${(r.vector[0]?.score ?? 0).toFixed(3)}  ${(r.words[0]?.score ?? 0).toFixed(2).padStart(6)} | ${fmt(v).padStart(3)} / ${fmt(w).padStart(3)} / ${fmt(f).padStart(3)}${v !== null && v > DEPTH ? '  (вектор поза топ-20)' : ''}`,
    );
  }
}

const args = process.argv.slice(2);
const run = args.includes('--golden') ? golden() : explain(args.filter((a) => !a.startsWith('--')).join(' '));
run.catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
