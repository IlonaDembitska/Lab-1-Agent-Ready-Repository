/**
 * Вимір паралельності (крок 07). ХОДИТЬ У МЕРЕЖУ — запускається вручну:
 *   npx tsx --env-file=.env.local scripts/parallel-eval.ts 1    «до»: послідовно
 *   npx tsx --env-file=.env.local scripts/parallel-eval.ts 4    «після»: чотири гілки
 * Паралелиться ЧИТАННЯ (запити набору). Запис однопотоковий: гілки повертають результат
 * у памʼять, у docs/lab2/parallel-run.json пише головний потік один раз після пулу.
 * Методика запиту та сама, що в eval-run.ts: модель і промпт baseline + 8 фрагментів контексту.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { priceUsd, type Usage } from '../src/cost';
import { startTracing } from '../src/otel/script-tracing';
import type { Embedder } from '../src/rag/embed';
import { bm25From, retrieve } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

import { BASELINE_MODEL, BASELINE_SYSTEM, median } from './baseline';
import { K, withContext } from './eval-run';

/** БЮДЖЕТ. Записано ДО запуску і дослівно перенесено в docs/lab2/budget.md. */
export interface Budget {
  /** Максимум гілок, що виконуються одночасно. */
  readonly maxBranches: number;
  /** Стеля токенів на весь прогін: нова гілка не стартує, коли її перетнуто. */
  readonly maxTokens: number;
  /** Стеля часу стіни на весь прогін, мс. */
  readonly maxWallMs: number;
}

export const BUDGET: Budget = { maxBranches: 4, maxTokens: 100_000, maxWallMs: 600_000 };

/** Лічильники Ollama з відповіді /api/embed, наносекунди → мс. */
export interface OllamaCounters {
  readonly totalMs: number;
  readonly loadMs: number;
  readonly promptEvalCount: number;
}

export interface BranchResult {
  readonly id: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ms: number;
  readonly embedMs: number;
  readonly genMs: number;
  readonly ollama: OllamaCounters | null;
}

/**
 * Пул фіксованої ширини, без зовнішніх залежностей. Кожна гілка ловить свою помилку сама,
 * тож облік гілок, що вже відпрацювали, не зникає (на відміну від голого Promise.all).
 */
export async function runPool<T>(
  tasks: readonly (() => Promise<T>)[],
  budget: Budget,
  spentTokens: () => number,
): Promise<{ results: (T | Error)[]; stoppedEarly: boolean }> {
  const results: (T | Error)[] = new Array<T | Error>(tasks.length);
  const startedAt = performance.now();
  let next = 0;
  let stoppedEarly = false;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      // ПРАВИЛО ЗУПИНКИ: перевіряється перед стартом нової гілки, а не всередині неї.
      if (spentTokens() >= budget.maxTokens || performance.now() - startedAt >= budget.maxWallMs) {
        stoppedEarly = true;
        return;
      }
      const i = next;
      next += 1;
      const task = tasks[i];
      if (task === undefined) continue;
      try {
        results[i] = await task();
      } catch (error) {
        results[i] = error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  const width = Math.max(1, Math.min(budget.maxBranches, tasks.length));
  await Promise.all(Array.from({ length: width }, worker));
  return { results, stoppedEarly };
}

/** Ембедер запиту, що записує лічильники Ollama. Той самий id, що в індексі, — loadIndex його прийме. */
function countingEmbedder(log: OllamaCounters[]): Embedder {
  const envBase = process.env.OLLAMA_BASE_URL;
  const base = envBase !== undefined && envBase !== '' ? envBase : 'http://localhost:11434';
  const model = 'embeddinggemma-2:270m';
  return {
    id: `ollama:${model}`,
    dimensions: 768,
    embedDocuments: async () => {
      throw new Error('parallel-eval: ембедінг документів тут не потрібен');
    },
    embedQuery: async (text) => {
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: [text], dimensions: 768, truncate: false }),
      });
      if (!res.ok) throw new Error(`/api/embed ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        embeddings?: number[][];
        total_duration?: number;
        load_duration?: number;
        prompt_eval_count?: number;
      };
      const v = data.embeddings?.[0];
      if (!v) throw new Error('/api/embed: порожня відповідь');
      log.push({
        totalMs: (data.total_duration ?? 0) / 1e6,
        loadMs: (data.load_duration ?? 0) / 1e6,
        promptEvalCount: data.prompt_eval_count ?? 0,
      });
      return v;
    },
  };
}

const OUT = 'docs/lab2/parallel-run.json';

async function main(): Promise<void> {
  const width = Number(process.argv[2] ?? 1);
  const budget: Budget = { ...BUDGET, maxBranches: Number.isFinite(width) && width > 0 ? width : 1 };
  const stopTracing = await startTracing();
  const index = loadIndex('data/index.json', countingEmbedder([]));
  const words = bm25From(index);
  const entries = readFileSync('docs/lab2/golden/queries.jsonl', 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { id: string; query: string });

  let spent = 0;
  const tasks = entries.map((entry) => async (): Promise<BranchResult> => {
    const started = performance.now();
    const counters: OllamaCounters[] = [];
    const { hits } = await retrieve(index, words, countingEmbedder(counters), entry.query, K);
    const retrieved = performance.now();
    const result = await generateText({
      model: google(BASELINE_MODEL.id),
      system: BASELINE_SYSTEM,
      prompt: withContext(entry.query, hits.map((h) => h.chunk)),
      temperature: 0,
      experimental_telemetry: {
        isEnabled: process.env.LANGFUSE_PUBLIC_KEY !== undefined,
        functionId: `lab2-parallel-w${budget.maxBranches}`,
      },
    });
    const done = performance.now();
    // generateText без інструментів — один крок, тож result.usage і є підсумок за виклик.
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    spent += inputTokens + outputTokens;
    return {
      id: entry.id,
      inputTokens,
      outputTokens,
      ms: Math.round(done - started),
      embedMs: Math.round(retrieved - started),
      genMs: Math.round(done - retrieved),
      ollama: counters[0] ?? null,
    };
  });

  // ЧАС СТІНИ міряється саме тут — навколо пулу.
  const wallStart = performance.now();
  const { results, stoppedEarly } = await runPool(tasks, budget, () => spent);
  const wallMs = Math.round(performance.now() - wallStart);
  await stopTracing();

  const ok = results.filter((r): r is BranchResult => r !== undefined && !(r instanceof Error));
  const failed = results.filter((r): r is Error => r instanceof Error);
  const sum = (f: (r: BranchResult) => number) => ok.reduce((n, r) => n + f(r), 0);
  const usage: Usage = { inputTokens: sum((r) => r.inputTokens), cachedTokens: 0, outputTokens: sum((r) => r.outputTokens) };
  const run = {
    runAt: new Date().toISOString(),
    width: budget.maxBranches,
    budget,
    wallMs,
    sumBranchMs: sum((r) => r.ms),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: priceUsd(BASELINE_MODEL, usage),
    done: ok.length,
    failed: failed.map((e) => e.message),
    stoppedEarly,
    medianEmbedMs: ok.length > 0 ? median(ok.map((r) => r.embedMs)) : 0,
    medianGenMs: ok.length > 0 ? median(ok.map((r) => r.genMs)) : 0,
    ollamaTotalMsSum: Math.round(sum((r) => r.ollama?.totalMs ?? 0)),
    ollamaLoadMsSum: Math.round(sum((r) => r.ollama?.loadMs ?? 0)),
    ollamaPromptEvalCountSum: sum((r) => r.ollama?.promptEvalCount ?? 0),
    branches: ok,
  };

  // ЄДИНИЙ запис — головний потік, після пулу. Прогін іншої ширини лишається у файлі.
  const all = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { runs: { width: number }[] }) : { runs: [] };
  const runs = [...all.runs.filter((r) => r.width !== run.width), run].sort((a, b) => a.width - b.width);
  writeFileSync(OUT, `${JSON.stringify({ runs }, null, 2)}\n`, 'utf8');

  const { branches: _omit, budget: _b, ...brief } = run;
  console.log(brief);
}

if (process.argv[1]?.endsWith('parallel-eval.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
