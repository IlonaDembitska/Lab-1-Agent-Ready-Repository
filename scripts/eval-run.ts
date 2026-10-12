/**
 * Прогін еталонного набору З ПОШУКОМ (крок 06). Методика — та сама, що в scripts/baseline.ts:
 * модель і системна інструкція ІМПОРТОВАНІ з baseline.ts, temperature 0, ті самі запити, та сама пауза.
 * Змінено рівно одне: у промпт додано знайдений контекст (withContext).
 *   npx tsx --env-file=.env.local scripts/eval-run.ts             — мережа; пише docs/lab2/eval-run.json
 *   npx tsx scripts/eval-run.ts --summary docs/lab2/eval-run.json  — без мережі; рядки для eval-report.md
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { priceUsd, type Usage } from '../src/cost';
import { mean, proportionCI95, recallAtK, reciprocalRank, transitions, type Hit, type Verdict } from '../src/metrics';
import { renderContext } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, retrieve } from '../src/rag/search';
import { loadIndex, type IndexedChunk } from '../src/rag/store';

import { BASELINE_MODEL, BASELINE_SYSTEM, median } from './baseline';

/** Те саме k, що в застосунку (src/rag/search.ts, topK = 8). */
export const K = 8;
const OUT = 'docs/lab2/eval-run.json';

/** ЄДИНА змістова відмінність від baseline.ts: знайдений контекст перед питанням. */
export function withContext(query: string, chunks: readonly IndexedChunk[]): string {
  return [
    'Фрагменти ПДР — спирайся на них; після кожного твердження став id фрагмента у квадратних дужках, напр. [pdr-12#0001]:',
    '',
    renderContext(chunks),
    '',
    `Питання: ${query}`,
  ].join('\n');
}

/** Документи, на які посилається відповідь: [pdr-12#0001] → pdr-12. */
export function citedDocs(answer: string): string[] {
  const docs = [...answer.matchAll(/\[([a-z0-9-]+)#\d{4}]/gi)].map((m) => m[1] ?? '');
  return [...new Set(docs.filter(Boolean))];
}

interface Entry {
  id: string;
  query: string;
  must_cite: string[];
  tags: string[];
}

export interface Row {
  id: string;
  query: string;
  tags: string[];
  must_cite: string[];
  hits: Hit[];
  recallAtK: number | null;
  reciprocalRank: number | null;
  /** Діагностика: recall при k = 20 (скільки дав би сам відбір без обрізання до K). */
  recallAt20: number | null;
  answer: string | null;
  error?: string;
  citedDocs: string[];
  latencyMs: number;
  usage: Usage;
  costUsd: number;
  /** Заповнюється РУКОЮ за правилом baseline.md. */
  verdict: Verdict | null;
  /** Переписується РУКОЮ з таблиці baseline.md. */
  baselineVerdict: Verdict | null;
  /** Чи процитовано правильне джерело (так / ні / null — цитати немає). */
  citationCorrect: boolean | null;
  /** Лише для tag=injection: чи НЕ виконано вказівку із запиту. */
  injectionResisted: boolean | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (x: number | null) => (x === null ? '—' : x.toFixed(2));

async function run(file: string): Promise<void> {
  const delayMs = Number(process.env.BASELINE_DELAY_MS ?? 4000);
  const embedder = ollamaEmbedder();
  const index = loadIndex('data/index.json', embedder);
  const words = bm25From(index);
  const queries = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Entry);

  const rows: Row[] = [];
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(delayMs);
    const started = performance.now();
    const { hits: top20 } = await retrieve(index, words, embedder, q.query, 20);
    const chunks = top20.slice(0, K).map((h) => h.chunk);
    const hits: Hit[] = chunks.map((c) => ({ docId: c.docId, chunkId: c.id }));
    const hits20: Hit[] = top20.map((h) => ({ docId: h.chunk.docId, chunkId: h.chunk.id }));
    const answerable = q.must_cite.length > 0;
    const base = {
      id: q.id,
      query: q.query,
      tags: q.tags,
      must_cite: q.must_cite,
      hits,
      recallAtK: answerable ? recallAtK(hits, q.must_cite, K) : null,
      reciprocalRank: answerable ? reciprocalRank(hits, q.must_cite, K) : null,
      recallAt20: answerable ? recallAtK(hits20, q.must_cite, 20) : null,
      verdict: null,
      baselineVerdict: null,
      citationCorrect: null,
      injectionResisted: null,
    };
    try {
      const result = await generateText({
        model: google(BASELINE_MODEL.id),
        system: BASELINE_SYSTEM,
        prompt: withContext(q.query, chunks),
        temperature: 0,
      });
      const usage: Usage = {
        inputTokens: result.usage.inputTokens ?? 0,
        cachedTokens: 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
      const latencyMs = Math.round(performance.now() - started);
      rows.push({ ...base, answer: result.text, citedDocs: citedDocs(result.text), latencyMs, usage, costUsd: priceUsd(BASELINE_MODEL, usage) });
      console.log(`ok   ${q.id}  recall@${K}=${fmt(base.recallAtK)}  rr=${fmt(base.reciprocalRank)}  recall@20=${fmt(base.recallAt20)}  ${latencyMs} мс`);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : String(err);
      rows.push({ ...base, answer: null, error: message, citedDocs: [], latencyMs, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, costUsd: 0 });
      console.log(`ERR  ${q.id}  ${message}`);
    }
  }
  writeFileSync(OUT, `${JSON.stringify({ runAt: new Date().toISOString(), k: K, setFile: file, model: BASELINE_MODEL.id, rows }, null, 2)}\n`);
  console.log(`\nЗаписано ${OUT}. Далі: verdict, baselineVerdict, citationCorrect, injectionResisted — рукою; потім --summary.`);
}

function summary(file: string): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { k: number; rows: Row[] };
  const missing = data.rows.filter((r) => r.verdict === null).map((r) => r.id);
  if (missing.length > 0) {
    console.error(`x не поставлено verdict: ${missing.join(', ')} — підсумок був би неповним`);
    process.exit(1);
  }
  const answerable = data.rows.filter((r) => r.must_cite.length > 0);
  const unanswerable = data.rows.filter((r) => r.must_cite.length === 0);
  const injection = data.rows.filter((r) => r.tags.includes('injection'));
  const n = answerable.length;
  const correct = answerable.filter((r) => r.verdict === 'correct').length;
  const ci = proportionCI95(correct, n);
  const pct = (a: number, b: number) => `${a}/${b} = ${((100 * a) / b).toFixed(1)}%`;
  const sum = (f: (r: Row) => number) => data.rows.reduce((s, r) => s + f(r), 0);
  const cost = sum((r) => r.costUsd);

  console.log(`| Точність на відповідних запитах (correct / ${n}) | ${pct(correct, n)} |`);
  console.log(`| Правильні відмови (unanswerable) | ${unanswerable.filter((r) => r.verdict === 'refused').length} із ${unanswerable.length} |`);
  console.log(`| Стійкість до injection | ${injection.filter((r) => r.injectionResisted === true).length} із ${injection.length} |`);
  console.log(`| Частка відповідей із цитатою | ${pct(answerable.filter((r) => r.citedDocs.length > 0).length, n)} |`);
  console.log(`| Частка відповідей із правильною цитатою | ${pct(answerable.filter((r) => r.citationCorrect === true).length, n)} |`);
  console.log(`| Токени (вхід / вихід) | ${sum((r) => r.usage.inputTokens)} / ${sum((r) => r.usage.outputTokens)} |`);
  console.log(`| Вартість: факт / за прайсом | $0 / $${cost.toFixed(4)} (≈ $${((cost / data.rows.length) * 100).toFixed(4)} на 100) |`);
  console.log(`| Медіана затримки | ${(median(data.rows.map((r) => r.latencyMs)) / 1000).toFixed(1)} с |`);
  console.log(`| recall@${data.k} | ${mean(answerable.map((r) => r.recallAtK ?? 0)).toFixed(2)} |`);
  console.log(`| MRR@${data.k} | ${mean(answerable.map((r) => r.reciprocalRank ?? 0)).toFixed(2)} |`);
  console.log(`| recall@20 (діагностика) | ${mean(answerable.map((r) => r.recallAt20 ?? 0)).toFixed(2)} |`);
  console.log(`\nІнтервал точності: ${(100 * ci.p).toFixed(0)}% ± ${(100 * ci.halfWidth).toFixed(0)} п. п. (нормальне наближення, n = ${n}, ОБЧИСЛЕНО)`);

  const before: Record<string, Verdict> = {};
  const after: Record<string, Verdict> = {};
  for (const r of data.rows) {
    if (r.baselineVerdict !== null) before[r.id] = r.baselineVerdict;
    if (r.verdict !== null) after[r.id] = r.verdict;
  }
  console.log('\n| було | стало | скільки | запити |');
  console.log('|---|---|---|---|');
  for (const t of transitions(before, after)) console.log(`| ${t.from} | ${t.to} | ${t.ids.length} | ${t.ids.join(', ')} |`);
}

if (process.argv[1]?.endsWith('eval-run.ts')) {
  const [first, second] = process.argv.slice(2);
  if (first === '--summary') {
    summary(second ?? OUT);
  } else {
    run(first ?? 'docs/lab2/golden/queries.jsonl').catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
  }
}
