/**
 * Прогін банку задач (Лаб. 3, крок 04): k спроб на задачу, кожна — у НОВОМУ git worktree
 * (executeTask → realDeps.prepare створює чисте дерево на кожен виклик, тобто на кожну спробу).
 * Пише docs/lab3/evals.jsonl (одна спроба = один рядок) і docs/lab3/evals-summary.json.
 *   EVAL_K=3 npx tsx scripts/evals/run-evals.ts docs/lab3/tasks.jsonl
 *   EVAL_BUCKET=regression EVAL_K=1 …   — у CI: лише регресійний кошик
 *   EVAL_ONLY=t-16,t-18 …               — лише вибрані задачі
 *   EVAL_APPEND=1 …                     — дописати в наявний журнал (продовжити перерваний прогін тим самим комітом);
 *                                         разом з EVAL_ONLY старі рядки цих задач спершу видаляються (повтор після збою моделі)
 *   EVAL_BREAKER=3 …                    — circuit breaker: після N поспіль збоїв середовища (timeout / agent_error) зупинитися
 * Код виходу: 0 — прогін завершено; 3 — розімкнувся запобіжник (результати неповні, у браму не годяться).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startHarnessTelemetry } from '../../src/telemetry/otel';
import { executeTask, realDeps, type Task } from '../harness/run-task';
import { emitPlan, parseEvents, planSpans } from '../harness/trace';
import { grade } from './graders';
import { summarize, type EvalLine } from './metrics';

const K = Number(process.env.EVAL_K ?? 3);
const BUCKET = process.env.EVAL_BUCKET ?? '';
const ONLY = (process.env.EVAL_ONLY ?? '').split(',').filter((x) => x !== '');
const BANK = process.argv[2] ?? 'docs/lab3/tasks.jsonl';
const LOG = process.env.EVAL_LOG ?? 'docs/lab3/evals.jsonl';
const model = process.env.HARNESS_MODEL ?? 'opencode/big-pickle';
const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const SHA = git(['rev-parse', '--short', 'HEAD']);
const read = (dir: string, name: string): string => {
  try {
    return readFileSync(join(dir, name), 'utf8');
  } catch {
    return '';
  }
};

const tasks: Task[] = readFileSync(BANK, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task)
  .filter((t) => BUCKET === '' || t.bucket === BUCKET)
  .filter((t) => ONLY.length === 0 || ONLY.includes(t.id));

if (tasks.some((t) => t.bucket === undefined || t.frozen_at === undefined || t.label === undefined)) {
  console.error('у банку є задачі без bucket / frozen_at / label — банк не готовий до evals');
  process.exit(2);
}

const BREAKER = Number(process.env.EVAL_BREAKER ?? 3);
if (process.env.EVAL_APPEND !== '1') writeFileSync(LOG, '');
else if (ONLY.length > 0) {
  // Повтор задач після збою моделі: їхні старі рядки прибираємо, решту журналу лишаємо як є.
  const kept = readFileSync(LOG, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !ONLY.includes((JSON.parse(l) as { task_id: string }).task_id));
  writeFileSync(LOG, kept.length > 0 ? `${kept.join('\n')}\n` : '');
}
let infraFailures = 0;
let tripped = false;
const deps = realDeps(resolve('.'), { model, push: false });
// Крок 06: траса на кожну спробу, якщо є ключі Langfuse (інакше trace_id = null, як раніше).
const tel = await startHarnessTelemetry();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const lines: EvalLine[] = [];
console.log(`evals: ${BANK} · задач ${tasks.length}${BUCKET ? ` (кошик ${BUCKET})` : ''} · k=${K} · агент ${model} · sha ${SHA}`);

for (const task of tasks) {
  if (tripped) break;
  for (let attempt = 1; attempt <= K; attempt += 1) {
    const out = join('runs', 'evals', stamp, `${task.id}-${attempt}`);
    const rec = await executeTask(task, deps, out);
    if (rec.branch !== null) {
      try {
        git(['branch', '-D', rec.branch]);
      } catch {
        /* гілки могло не бути — не страшно */
      }
    }
    const results = grade({
      task,
      patch: read(out, 'patch.diff'),
      output: read(out, 'output.txt'),
      acceptance: rec.checks.map((c) => ({ cmd: c.cmd, exit: c.code })),
    });
    const pass = results.length > 0 && results.every((r) => r.pass);
    let traceId: string | null = null;
    if (tel.enabled) {
      traceId = emitPlan(planSpans(rec, parseEvents(read(out, 'agent.log').split('\n'))));
      writeFileSync(join(out, 'run.json'), `${JSON.stringify({ ...rec, trace_id: traceId }, null, 2)}\n`);
    }
    const line = {
      task_id: task.id,
      bucket: task.bucket ?? '',
      frozen_at: task.frozen_at ?? '',
      attempt,
      sha: SHA,
      pass,
      graders: results,
      exit_status: rec.status,
      turns: rec.turns,
      duration_s: Math.round(rec.durationMs / 100) / 10,
      input_tokens: rec.inputTokens,
      output_tokens: rec.outputTokens,
      cost_usd_estimate: rec.costUsd,
      trace_id: traceId,
      at: new Date().toISOString(),
    };
    appendFileSync(LOG, `${JSON.stringify(line)}\n`);
    lines.push(line);
    const bad = results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.detail}`);
    console.log(`${task.id} [${task.bucket}] #${attempt} · ${pass ? 'PASS' : 'fail'} · ${rec.status} · ${line.duration_s} с${bad.length ? ` · ${bad.join(' · ')}` : ''}`);
    // Збій середовища — модель/мережа не відповідає: зупинено за часом або процес агента впав.
    // stalled ПІСЛЯ хоча б одного ходу (агент замовк після відмови в дозволі) — НЕ збій середовища, а результат харнесу.
    // Звичайний fail (агент працював, але перевірки червоні) — це результат, а не збій, і лічильник обнуляє.
    // stalled із 0 ходів — модель не відповіла жодного разу: це теж збій середовища (прогін 2026-11-07, з t-09).
    const infra = rec.status === 'timeout' || rec.status === 'agent_error' || (rec.status === 'stalled' && rec.turns === 0);
    infraFailures = infra ? infraFailures + 1 : 0;
    if (infraFailures >= BREAKER) {
      tripped = true;
      console.error(`⛔ CIRCUIT BREAKER: ${BREAKER} збої середовища поспіль (timeout / agent_error) — модель або мережа недоступні; прогін зупинено, результати неповні`);
      break;
    }
  }
}

await tel.shutdown();
if (tripped) process.exitCode = 3;
const all: EvalLine[] = readFileSync(LOG, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as EvalLine);
const summary = summarize(all, K);
writeFileSync(
  LOG.replace(/\.jsonl$/, '-summary.json'),
  `${JSON.stringify({ at: new Date().toISOString(), sha: SHA, bank: BANK, k: K, bucket: BUCKET || 'all', agent: model, complete: !tripped, summary }, null, 2)}\n`,
);
console.log('\n| кошик | задач | pass@k | pass^k |\n|---|---|---|---|');
for (const s of summary) console.log(`| ${s.bucket} | ${s.tasks} | ${s.pass_at_k} | ${s.pass_pow_k} |`);
