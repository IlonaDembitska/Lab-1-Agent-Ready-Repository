/**
 * Оцінювання асистента з пошуком на еталонному наборі (крок 06).
 *   npx tsx --env-file=.env.local scripts/eval.ts
 * Та сама модель відповіді, що й базова лінія (gemini-3.1-flash-lite, temperature 0).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { priceUsd, type Usage } from '../src/cost';
import { CATALOG } from '../src/models';
import { ANSWER_SYSTEM, buildAnswerPrompt, REFUSAL, shouldRefuse } from '../src/rag/answer';
import { citedIds } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, retrieve } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

const MODEL = CATALOG['gemini-3.1-flash-lite'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Query {
  readonly id: string;
  readonly query: string;
  readonly must_cite: string[];
  readonly tags: string[];
}

async function main(): Promise<void> {
  const embedder = ollamaEmbedder();
  const index = loadIndex('data/index.json', embedder);
  const words = bm25From(index);
  const queries = readFileSync('docs/lab2/golden/queries.jsonl', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Query);

  const rows: Record<string, unknown>[] = [];
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(4000);
    const started = performance.now();
    const { hits, bestCosine } = await retrieve(index, words, embedder, q.query);
    const served = hits.map((h) => h.chunk.id);
    let answer = REFUSAL;
    let byThreshold = false;
    let usage: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    if (shouldRefuse(bestCosine)) {
      byThreshold = true;
    } else {
      const r = await generateText({
        model: google(MODEL.id),
        system: ANSWER_SYSTEM,
        prompt: buildAnswerPrompt(q.query, hits),
        temperature: 0,
      });
      answer = r.text.trim();
      usage = { inputTokens: r.usage.inputTokens ?? 0, cachedTokens: 0, outputTokens: r.usage.outputTokens ?? 0 };
    }
    const latencyMs = Math.round(performance.now() - started);
    const cited = citedIds(answer).filter((id) => served.includes(id));
    const refused = answer.includes(REFUSAL);
    const citesMust = q.must_cite.length > 0 && cited.some((id) => q.must_cite.includes(id.split('#')[0] ?? ''));
    const mustServed = q.must_cite.length > 0 && served.some((id) => q.must_cite.includes(id.split('#')[0] ?? ''));
    rows.push({
      id: q.id,
      tags: q.tags,
      bestCosine: Number(bestCosine.toFixed(3)),
      byThreshold,
      served,
      cited,
      citesMust,
      mustServed,
      refused,
      latencyMs,
      usage,
      costUsd: priceUsd(MODEL, usage),
      answer,
    });
    console.log(
      `${q.id.padEnd(5)} ${refused ? 'ВІДМОВА' : 'відповідь'}${byThreshold ? ' (поріг)' : ''} · цитат ${cited.length} · правильний док. ${citesMust ? 'так' : 'ні'} · ${latencyMs} мс`,
    );
  }
  writeFileSync('docs/lab2/eval-raw.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('\nзаписано docs/lab2/eval-raw.jsonl');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
