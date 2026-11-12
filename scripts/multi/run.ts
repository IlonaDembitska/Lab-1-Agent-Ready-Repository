/**
 * Прогін мультиагентної функціональності (Лаб. 4, крок 03). ХОДИТЬ У МЕРЕЖУ (Gemini) і в локальну Ollama.
 *
 *   FORK_DIR=~/lab4/bytes.js npx tsx --env-file=.env.local scripts/multi/run.ts --mode multi
 *   FORK_DIR=~/lab4/bytes.js npx tsx --env-file=.env.local scripts/multi/run.ts --mode single
 *   … --only q1                   — одне питання
 *   … --max-turns 3               — свідомо занизька стеля ходів (прогін, зупинений бюджетом)
 *   … --pause 20000               — пауза між питаннями, мс (ліміт запитів/хв безкоштовного рівня; у вимір не входить)
 *
 * Ролі: читачі (Gemini, лише читальні інструменти, паралельно) → fan-in (перевірка меж) →
 * звідник (Gemini, без інструментів) → детермінована перевірка цитат → верифікатор (Ollama/Qwen,
 * без інструментів, інша родина) → ЄДИНА смуга запису writeAnswer (лише якщо брама пройдена).
 * Правило зупинки: межа бюджету спрацювала → решта гілок скасовується (AbortController), звід НЕ
 * робиться, питання падає закрито (статус stopped:<межа>), рядок — у docs/lab4/traces/budget-stop.jsonl.
 * Гілка впала без межі → звід із того, що є, відповідь позначена «НЕПОВНА» з переліком смуг.
 * Коди виходу: 0 — усе відпрацювало; 3 — брейкер квоти (429); 4 — хоч одне питання зупинене бюджетом.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { google } from '@ai-sdk/google';
import type { CriterionVerdict } from '../../src/verify/schema';

import { CATALOG } from '../../src/models';
import { startTracing } from '../../src/otel/script-tracing';
import { add, DEFAULT_BUDGET, overBudget, type Budget, type Spent, type Stop } from '../../src/multi/budget';
import { checkCite, citeEvidence, permalink } from '../../src/multi/cite';
import { fanOut, logStop, realGenerate, type LaneTrace } from '../../src/multi/fanout';
import { forkDir, readerTools } from '../../src/multi/reader-tools';
import { lanesFor, parseDraft, quality, READER_SYSTEM, singlePrompt, synthPrompt, writeAnswer, type Draft, type Question } from '../../src/multi/synth';
import { isBlockedStrict, judgeClaim, verifierModel } from '../../src/multi/verifier';

const RUNS = 'docs/lab4/multi-runs.jsonl';
const FORK_URL = process.env.FORK_URL ?? 'https://github.com/IlonaDembitska/bytes.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadQuestions(file = 'docs/lab4/multi-questions.jsonl'): Question[] {
  return readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Question);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  at: string;
  taskId: string;
  mode: 'multi' | 'single';
  budget: Budget;
  budgetOverride: boolean;
  branchModel: string;
  verifierModel: string;
  status: 'ok' | 'blocked' | `stopped:${Stop}` | 'no-draft';
  wallMs: number;
  computeMs: number;
  calls: number;
  modelRequests: number;
  inputTokens: number;
  outputTokens: number;
  unreported: number;
  failedLanes: string[];
  incomplete: boolean;
  claims: number;
  citeBad: number;
  verdicts: CriterionVerdict[];
  quality: number;
  answerFile: string | null;
  lanes: LaneTrace[];
  stopRound: number | null;
};

async function runOne(q: Question, mode: 'multi' | 'single', budget: Budget, override: boolean): Promise<Row> {
  const root = forkDir();
  const tools = readerTools(root);
  const branchModelId = process.env.BRANCH_MODEL ?? CATALOG['gemini-3.5-flash-lite'].id;
  const model = google(branchModelId);
  const vModel = verifierModel();
  const taskId = `${q.id}-${mode}`;

  const wall0 = performance.now(); // ЧАС ДО ВІДПОВІДІ — навколо всього питання
  let spent: Spent;
  let stop: Stop = 'none';
  let stopRound: number | null = null;
  let failed: string[] = [];
  let lanes: LaneTrace[] = [];
  let draftText = '';

  if (mode === 'multi') {
    const fan = await fanOut({ model, system: READER_SYSTEM, readOnlyTools: tools, rounds: [lanesFor(q)], budget, taskId });
    ({ spent, stop, stopRound, failed, lanes } = fan);
    if (stop === 'none' && fan.out.length > 0) {
      // звід — ще один хід; межі перевіряються і перед ним
      stop = overBudget(spent, budget, 1, false);
      if (stop !== 'none') {
        stopRound = 1;
        logStop(taskId, stop, 1, spent);
      } else {
        const t0 = performance.now();
        const r = await realGenerate({ model, system: 'Ти — звідник. Без інструментів.', prompt: synthPrompt(q, fan.out, failed), tools: {}, steps: 1, signal: AbortSignal.timeout(budget.wallClockMs), functionId: `${taskId}/synth` });
        spent = add(spent, r.usage, performance.now() - t0, r.steps);
        draftText = r.text;
      }
    }
  } else {
    // БАЗОВА ЛІНІЯ: один агент, послідовно, усі читальні інструменти, кроків стільки ж, скільки в усіх гілках разом
    const fan = await fanOut({
      model,
      system: READER_SYSTEM,
      readOnlyTools: tools,
      rounds: [[{ lane: 'single', prompt: singlePrompt(q) }]],
      budget: { ...budget, stepsPerBranch: budget.stepsPerBranch * budget.maxBranches },
      taskId,
    });
    ({ spent, stop, stopRound, failed, lanes } = fan);
    draftText = fan.out[0]?.text ?? '';
  }

  const d: Draft | null = stop === 'none' ? parseDraft(draftText) : null;
  const verdicts: CriterionVerdict[] = [];
  let citeBad = 0;
  if (d !== null) {
    for (const [i, c] of d.claims.entries()) {
      const id = `C${i + 1}`;
      const cite = { sha: c.sha, ...(c.file !== undefined ? { file: c.file } : {}), ...(c.line !== undefined ? { line: c.line } : {}) };
      const why = checkCite(root, cite);
      if (why !== null) {
        // цитати немає — модель це твердження навіть не бачить
        citeBad += 1;
        verdicts.push({ id, verdict: 'fail', reason: `детермінована перевірка: ${why}`, evidence: '' });
        continue;
      }
      if (overBudget(spent, budget, 1, false) !== 'none') {
        verdicts.push({ id, verdict: 'unknown', reason: 'бюджет ходів вичерпано до верифікації', evidence: '' });
        continue;
      }
      const v = await judgeClaim(id, c.text, citeEvidence(root, cite), vModel);
      spent = add(spent, v.usage, v.ms, 1);
      verdicts.push(v.verdict);
    }
  }

  const blocked = d === null || isBlockedStrict(verdicts);
  const incomplete = failed.length > 0;
  let answerFile: string | null = null;
  if (d !== null && !blocked) {
    const md = [
      `# ${q.id} (${mode}) — ${q.question}`,
      '',
      incomplete ? `> **НЕПОВНА ВІДПОВІДЬ:** смуг ${failed.join(', ')} немає.\n` : '',
      d.answer,
      '',
      ...d.claims.map((c, i) => `${i + 1}. ${c.text} — ${permalink(FORK_URL, { sha: c.sha, ...(c.file !== undefined ? { file: c.file } : {}), ...(c.line !== undefined ? { line: c.line } : {}) })}`),
      '',
      `Верифікатор (${vModel}): усі ${verdicts.length} тверджень — pass.`,
      '',
    ].join('\n');
    answerFile = writeAnswer(taskId, 'answer', md); // ЄДИНА смуга запису
  }

  const wallMs = Math.round(performance.now() - wall0);
  const status: Row['status'] = stop !== 'none' ? `stopped:${stop}` : d === null ? 'no-draft' : blocked ? 'blocked' : 'ok';
  return {
    at: new Date().toISOString(),
    taskId: q.id,
    mode,
    budget,
    budgetOverride: override,
    branchModel: branchModelId,
    verifierModel: vModel,
    status,
    wallMs,
    computeMs: Math.round(spent.ms),
    calls: spent.calls,
    modelRequests: spent.modelRequests,
    inputTokens: spent.input,
    outputTokens: spent.output,
    unreported: spent.unreported,
    failedLanes: failed,
    incomplete,
    claims: d?.claims.length ?? 0,
    citeBad,
    verdicts,
    quality: Number(quality(q, d).toFixed(2)),
    answerFile,
    lanes,
    stopRound,
  };
}

async function main(): Promise<void> {
  const mode = arg('--mode') === 'single' ? 'single' : 'multi';
  const only = arg('--only');
  const maxTurns = arg('--max-turns');
  const pause = Number(arg('--pause') ?? '15000');
  const budget: Budget = maxTurns !== undefined ? { ...DEFAULT_BUDGET, maxTurns: Number(maxTurns) } : DEFAULT_BUDGET;
  const questions = loadQuestions().filter((q) => only === undefined || q.id === only);
  if (questions.length === 0) throw new Error('немає питань (перевір --only)');

  const stopTracing = await startTracing();
  mkdirSync('docs/lab4/traces', { recursive: true });
  let anyStopped = false;
  try {
    for (const [i, q] of questions.entries()) {
      if (i > 0 && pause > 0) await sleep(pause);
      const row = await runOne(q, mode, budget, maxTurns !== undefined);
      appendFileSync(RUNS, `${JSON.stringify(row)}\n`);
      const trace = `docs/lab4/traces/multi-${q.id}-${mode}${maxTurns !== undefined ? `-maxturns${maxTurns}` : ''}.json`;
      writeFileSync(trace, `${JSON.stringify(row, null, 2)}\n`);
      console.log(
        `${q.id} ${mode}: ${row.status} · ${(row.wallMs / 1000).toFixed(1)} с до відповіді · ходів ${row.calls} (запитів ${row.modelRequests}) · ` +
          `токени ${row.inputTokens}/${row.outputTokens} (не повідомлено: ${row.unreported}) · якість ${row.quality} · ` +
          `цитат погано ${row.citeBad}/${row.claims} · вердикти ${row.verdicts.map((v) => `${v.id}:${v.verdict}`).join(' ') || '—'}` +
          (row.failedLanes.length > 0 ? ` · упали смуги: ${row.failedLanes.join(',')}` : ''),
      );
      if (row.status === 'stopped:quota-429') {
        console.error('БРЕЙКЕР: відмова за квотою (429) — прогін зупинено');
        process.exitCode = 3;
        return;
      }
      if (row.status.startsWith('stopped:')) anyStopped = true;
    }
  } finally {
    await stopTracing();
  }
  if (anyStopped) process.exitCode = 4;
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
