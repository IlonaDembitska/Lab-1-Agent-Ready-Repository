/**
 * Базова лінія (крок 01, Лабораторна 2): модель відповідає БЕЗ документів.
 * Запуск: npx tsx --env-file=.env.local scripts/baseline.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { priceUsd, type Usage } from '../src/cost';
import { CATALOG } from '../src/models';

export const BASELINE_MODEL = CATALOG['gemini-3.1-flash-lite'];

export const BASELINE_SYSTEM =
  'Ти асистент із Правил дорожнього руху України. Відповідай коротко, українською. ' +
  'Якщо не знаєш відповіді точно, прямо скажи, що не знаєш.';

export interface BaselineRow {
  readonly id: string;
  readonly query: string;
  readonly tags: readonly string[];
  readonly answer: string | null;
  readonly error?: string;
  readonly latencyMs: number;
  readonly usage: Usage;
  readonly costUsd: number;
}

/** Медіана; для порожнього масиву — 0. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const lo = s[mid - 1] ?? 0;
  const hi = s[mid] ?? 0;
  return s.length % 2 === 0 ? (lo + hi) / 2 : hi;
}

export function summarize(rows: readonly BaselineRow[]) {
  const ok = rows.filter((r) => r.answer !== null);
  const totalCostUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
  return {
    total: rows.length,
    answered: ok.length,
    errors: rows.length - ok.length,
    medianLatencyMs: Math.round(median(ok.map((r) => r.latencyMs))),
    totalCostUsd,
    costPer100Usd: rows.length > 0 ? (totalCostUsd / rows.length) * 100 : 0,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const file = process.argv[2] ?? 'docs/lab2/golden/queries.jsonl';
  const delayMs = Number(process.env.BASELINE_DELAY_MS ?? 4000);
  const queries = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { id: string; query: string; tags: string[] });

  const rows: BaselineRow[] = [];
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(delayMs);
    const started = performance.now();
    try {
      const result = await generateText({
        model: google(BASELINE_MODEL.id),
        system: BASELINE_SYSTEM,
        prompt: q.query,
        temperature: 0,
      });
      const usage: Usage = {
        inputTokens: result.usage.inputTokens ?? 0,
        cachedTokens: 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
      const latencyMs = Math.round(performance.now() - started);
      rows.push({ ...q, answer: result.text, latencyMs, usage, costUsd: priceUsd(BASELINE_MODEL, usage) });
      console.log(`ok   ${q.id}  ${latencyMs} мс`);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : String(err);
      rows.push({
        ...q,
        answer: null,
        error: message,
        latencyMs,
        usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
        costUsd: 0,
      });
      console.log(`ERR  ${q.id}  ${message}`);
    }
  }

  mkdirSync('docs/lab2', { recursive: true });
  writeFileSync('docs/lab2/baseline-raw.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const summary = { model: BASELINE_MODEL.id, date: new Date().toISOString().slice(0, 10), ...summarize(rows) };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1]?.endsWith('baseline.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
