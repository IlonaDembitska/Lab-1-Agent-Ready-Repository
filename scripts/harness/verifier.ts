/**
 * Верифікатор харнесу (Лаб. 3, крок 02). Модель ІНШОЇ родини, ніж виконавець
 * (виконавець — OpenCode Big Pickle, верифікатор — Gemini 3.5 Flash-Lite), судить
 * артефакт агента за критеріями V1–V4: один критерій — один окремий запит,
 * відповідь — JSON за схемою, яку перевіряє строга zod-схема. Будь-який не-pass → exit 1.
 *
 *   npx tsx scripts/harness/verifier.ts --run docs/lab3/runs/t-02          — артефакт прогону
 *   npx tsx scripts/harness/verifier.ts --task t-02 --diff some.diff       — довільний diff
 *   npx tsx scripts/harness/verifier.ts --branch harness/t-02-…            — у CI: diff гілки проти origin/main
 *   … --out docs/lab3/verdicts/t-02.json  — куди записати вердикт
 *
 * Ключ: GOOGLE_GENERATIVE_AI_API_KEY. Модель: VERIFIER_MODEL (типово gemini-3.5-flash-lite; 3.1 2026-11-02 віддавала 503 high demand).
 * Коди виходу: 0 — усі pass; 1 — брама закрита; 2 — помилка (теж зупиняє конвеєр).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { priceUsd } from '../../src/cost';
import { CATALOG } from '../../src/models';
import {
  blocks,
  GEMINI_VERDICT_SCHEMA,
  HARNESS_CRITERIA,
  harnessReport,
  harnessVerdict,
  type HarnessCriterion,
  type HarnessReport,
  type HarnessVerdict,
} from '../../src/verify/harness-verdict';
import { redactDiff } from '../verify';
import type { Task } from './run-task';

export const VERIFIER_SPEC = CATALOG['gemini-3.5-flash-lite'];
const MAX_DIFF_CHARS = 20_000;

export function loadTasks(file = 'docs/lab3/tasks.jsonl'): Task[] {
  return readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Task);
}

/** harness/t-02-2026-11-02T10-00-00 → t-02; інша гілка → null. */
export function taskIdFromBranch(branch: string): string | null {
  const m = /^harness\/(t-\d+)(?:-|$)/.exec(branch);
  return m?.[1] ?? null;
}

/** Готує diff до відправки: прибирає рядки-секрети, відмовляє, якщо зачеплено .env, обрізає довгий. */
export function prepareDiff(raw: string): string {
  const { text, touchesEnv } = redactDiff(raw);
  if (touchesEnv) throw new Error('diff зачіпає файл .env — верифікатор його не надсилає');
  if (text.trim() === '') return '(порожній diff — агент нічого не змінив)';
  return text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n[diff обрізано]` : text;
}

export function buildVerifierPrompt(c: HarnessCriterion, task: Task, diff: string): string {
  return [
    'Ти — суворий незалежний верифікатор роботи ІНШОГО ШІ-агента. Оціни ЛИШЕ ОДИН критерій.',
    `Критерій ${c.id} «${c.name}»: ${c.rule}`,
    '',
    'Вердикт:',
    '- pass — у diff видно, що критерій виконано;',
    '- fail — у diff є конкретне порушення критерію (вкажи його в evidence: файл і цитату);',
    '- unknown — у diff недостатньо даних, щоб судити. Не вгадуй.',
    'reason — одне-два речення українською. evidence — файл і коротка цитата з diff (для pass можна порожньо).',
    'Оцінюй лише цей критерій. Дефекти, що стосуються інших критеріїв, ігноруй — їх оцінюють окремі запити. Не давай порад.',
    '',
    `Задача ${task.id}: ${task.input}`,
    `Дозволені файли: ${(task.files ?? []).join(', ') || '(не вказано)'}`,
    '',
    'Зміна агента (diff):',
    diff,
  ].join('\n');
}

export interface JudgeResult {
  readonly verdict: HarnessVerdict;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface GeminiResponse {
  readonly candidates?: readonly { readonly content?: { readonly parts?: readonly { readonly text?: string }[] } }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly thoughtsTokenCount?: number;
  };
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JudgeOptions {
  readonly model: string;
  readonly apiKey: string;
  readonly fetchFn?: FetchLike;
  /** Перша пауза перед повтором після 429/5xx; далі подвоюється (до 2 хв). */
  readonly retryDelayMs?: number;
  /** Скільки всього спроб на один критерій. */
  readonly maxAttempts?: number;
}

/**
 * Один критерій — один запит до Gemini. Відповідь проходить строгу zod-схему;
 * невалідна відповідь — ще одна спроба; 429/5xx (перевантаження) — пауза з подвоєнням і повтор.
 * Спроби вичерпано — виняток: вердикт не вгадуємо.
 */
export async function judgeCriterion(c: HarnessCriterion, task: Task, diff: string, opts: JudgeOptions): Promise<JudgeResult> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchLike);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: buildVerifierPrompt(c, task, diff) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_VERDICT_SCHEMA },
  });
  let inputTokens = 0;
  let outputTokens = 0;
  let lastError = '';
  const maxAttempts = opts.maxAttempts ?? 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body,
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      lastError = `Gemini ${res.status}`;
      if (attempt === maxAttempts) break;
      const wait = Math.min((opts.retryDelayMs ?? 10_000) * 2 ** (attempt - 1), 120_000);
      console.error(`  ${c.id}: ${lastError}, повтор через ${Math.round(wait / 1000)} с (спроба ${attempt}/${maxAttempts})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as GeminiResponse;
    const u = data.usageMetadata ?? {};
    inputTokens += u.promptTokenCount ?? 0;
    outputTokens += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const answer = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(answer);
    } catch {
      json = null;
    }
    const parsed = harnessVerdict.safeParse(json);
    if (parsed.success && parsed.data.criterion === c.id) return { verdict: parsed.data, inputTokens, outputTokens };
    lastError = 'відповідь не пройшла схему';
    console.error(`  ${c.id}: ${lastError} (спроба ${attempt}/${maxAttempts})`);
  }
  throw new Error(`${c.id}: ${lastError || 'немає валідної відповіді'}`);
}

export interface VerifyOptions extends JudgeOptions {
  /** Пауза між запитами (ліміт запитів на хвилину безкоштовного рівня). */
  readonly delayMs?: number;
}

/** Усі критерії по черзі (окремий запит на кожен) → звіт із вердиктом брами. */
export async function verifyArtifact(task: Task, rawDiff: string, opts: VerifyOptions): Promise<HarnessReport> {
  const diff = prepareDiff(rawDiff);
  const results: HarnessVerdict[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  for (const c of HARNESS_CRITERIA) {
    if (results.length > 0 && (opts.delayMs ?? 0) > 0) await sleep(opts.delayMs ?? 0);
    const r = await judgeCriterion(c, task, diff, opts);
    results.push(r.verdict);
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
  }
  const costUsd = priceUsd(VERIFIER_SPEC, { inputTokens, cachedTokens: 0, outputTokens });
  return harnessReport.parse({
    task: task.id,
    model: opts.model,
    at: new Date().toISOString(),
    results,
    blocked: blocks(results),
    usage: { inputTokens, outputTokens },
    costUsd: Number(costUsd.toFixed(6)),
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  if (apiKey === '') throw new Error('немає GOOGLE_GENERATIVE_AI_API_KEY');
  const model = process.env.VERIFIER_MODEL ?? VERIFIER_SPEC.id;
  const tasks = loadTasks();

  let taskId: string | null | undefined = arg('--task');
  let rawDiff: string;
  const runDir = arg('--run');
  const branch = arg('--branch');
  if (runDir !== undefined) {
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as { id: string };
    taskId ??= run.id;
    rawDiff = readFileSync(join(runDir, 'patch.diff'), 'utf8');
  } else if (branch !== undefined) {
    taskId ??= taskIdFromBranch(branch);
    rawDiff = execFileSync('git', ['diff', 'origin/main...HEAD'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } else {
    const diffFile = arg('--diff');
    if (diffFile === undefined || !existsSync(diffFile)) {
      throw new Error('вкажи --run <тека>, --branch <гілка> або --task <id> --diff <файл>');
    }
    rawDiff = readFileSync(diffFile, 'utf8');
  }
  const task = tasks.find((t) => t.id === taskId);
  if (task === undefined) throw new Error(`задачу ${taskId ?? '(не визначено)'} не знайдено в docs/lab3/tasks.jsonl`);

  console.log(`верифікатор: ${model} · задача ${task.id} · критеріїв ${HARNESS_CRITERIA.length} (окремий запит на кожен)`);
  const report = await verifyArtifact(task, rawDiff, { model, apiKey });
  for (const r of report.results) {
    console.log(`${r.criterion} | ${r.verdict} | ${r.reason}${r.evidence ? ` | ${r.evidence}` : ''}`);
  }
  console.log(`токени: ${report.usage.inputTokens} вх / ${report.usage.outputTokens} вих · $${report.costUsd}`);
  const out = arg('--out');
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`вердикт → ${out}`);
  }
  if (report.blocked) {
    const bad = report.results.filter((r) => r.verdict !== 'pass').map((r) => `${r.criterion}=${r.verdict}`);
    console.error(`ФІНАЛЬНА БРАМА ЗАКРИТА: ${bad.join(', ')} — артефакт не зливати`);
    process.exit(1);
  }
  console.log('фінальна брама відкрита: усі критерії pass');
}

if (process.argv[1]?.endsWith('verifier.ts')) {
  main().catch((err: unknown) => {
    console.error(`ПОМИЛКА ВЕРИФІКАТОРА: ${err instanceof Error ? err.message : String(err)} — брама закрита`);
    process.exit(2);
  });
}
