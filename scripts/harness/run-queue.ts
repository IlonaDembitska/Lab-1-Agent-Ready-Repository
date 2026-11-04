/**
 * Черга задач (Лаб. 3, кроки 00 і 03). Задачі виконуються по одній.
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl            — уся черга
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01  — одна задача (перезапуск)
 *   … --push         — запушити гілку harness/<id>-<час> з артефактом
 *   … --breaker 2    — circuit breaker: після 2 невдач поспіль решту черги не запускати (типово 3)
 * Підсумок черги — runs/queue-<час>.json (статус кожної задачі + стан запобіжника).
 * Код виходу: 0 — усе pass; 1 — були невдачі; 3 — запобіжник розімкнувся.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CircuitBreaker } from './breaker';
import { executeTask, realDeps, type Status, type Task } from './run-task';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? 'docs/lab3/tasks.jsonl';
const idIdx = args.indexOf('--id');
const only = idIdx >= 0 ? args[idIdx + 1] : undefined;
const brIdx = args.indexOf('--breaker');
const threshold = Number(brIdx >= 0 ? args[brIdx + 1] : (process.env.HARNESS_BREAKER ?? 3));
const model = process.env.HARNESS_MODEL ?? 'opencode/big-pickle';

const tasks: Task[] = readFileSync(file, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task)
  .filter((t) => only === undefined || t.id === only);

if (tasks.length === 0) {
  console.error(`немає задач${only === undefined ? '' : ` з id ${only}`} у ${file}`);
  process.exit(1);
}

const root = resolve('.');
const deps = realDeps(root, { model, push: args.includes('--push') });
const breaker = new CircuitBreaker(threshold);
const queueStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const results: { id: string; status: Status | 'skipped_breaker_open'; durationMs: number; turns: number; costUsd: number; out: string | null }[] = [];

console.log(`черга: ${file} · задач ${tasks.length} · модель ${model} · circuit breaker: ${threshold} невдач поспіль`);
for (const task of tasks) {
  if (!breaker.allows()) {
    console.log(`⏭ ${task.id} — пропущено: запобіжник розімкнений`);
    results.push({ id: task.id, status: 'skipped_breaker_open', durationMs: 0, turns: 0, costUsd: 0, out: null });
    continue;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join('runs', task.id, stamp);
  console.log(`▶ ${task.id} … (бюджет: ходів ${task.budget.max_turns}, $${task.budget.max_usd}, ${task.budget.timeout_s} с)`);
  const r = await executeTask(task, deps, out);
  console.log(`  ${r.status} · ${(r.durationMs / 1000).toFixed(1)} с · ходів ${r.turns} · $${r.costUsd} · файлів ${r.changedFiles.length} → ${out}`);
  results.push({ id: task.id, status: r.status, durationMs: r.durationMs, turns: r.turns, costUsd: r.costUsd, out });
  const state = breaker.record(task.id, r.status);
  if (state === 'open') console.log(`⛔ CIRCUIT BREAKER: ${threshold} невдач поспіль (${breaker.snapshot().trippedBy.join(', ')}) — решту черги зупинено`);
}

const summary = { queue: file, startedAt: queueStamp, model, tasks: results, breaker: breaker.snapshot() };
mkdirSync('runs', { recursive: true });
const summaryFile = join('runs', `queue-${queueStamp}.json`);
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`підсумок черги → ${summaryFile}`);
process.exitCode = breaker.state === 'open' ? 3 : results.every((r) => r.status === 'pass') ? 0 : 1;
