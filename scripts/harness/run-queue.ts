/**
 * Черга задач (Лаб. 3, кроки 00 і 03; Лаб. 4, крок 07 — конфігурації й вартість).
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl            — уся черга
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01  — одна задача (перезапуск)
 *   … --push         — запушити гілку harness/<id>-<час> з артефактом
 *   … --breaker 2    — circuit breaker: після 2 невдач поспіль решту черги не запускати (типово 3)
 *   … --config A-cheap-escalate | B-strong — модель(і) за іменем конфігурації (scripts/harness/escalate.ts);
 *       гілки harness/<config>/<id>-<час>, теки runs/<config>/…, рядок TaskCost на задачу
 *       у docs/lab4/traces/cost-<config>.jsonl (файл перезаписується; --append — дописати).
 *       Невідома конфігурація — вихід з кодом 2, а не тихе ігнорування.
 * Підсумок черги — runs/queue-<час>.json (статус кожної задачі + стан запобіжника).
 * Код виходу: 0 — усе pass; 1 — були невдачі; 2 — невідома конфігурація; 3 — запобіжник розімкнувся.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startHarnessTelemetry } from '../../src/telemetry/otel';
import { CircuitBreaker } from './breaker';
import { usageFromEvents } from './cost';
import { CONFIGS, costOf, isConfig, runConfig, type Attempt } from './escalate';
import { executeTask, realDeps, type Deps, type Status, type Task } from './run-task';
import { emitPlan, parseEvents, planSpans } from './trace';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? 'docs/lab3/tasks.jsonl';
const idIdx = args.indexOf('--id');
const only = idIdx >= 0 ? args[idIdx + 1] : undefined;
const brIdx = args.indexOf('--breaker');
const threshold = Number(brIdx >= 0 ? args[brIdx + 1] : (process.env.HARNESS_BREAKER ?? 3));
const cfgIdx = args.indexOf('--config');
const config = cfgIdx >= 0 ? args[cfgIdx + 1] : undefined;
if (cfgIdx >= 0 && !isConfig(config)) {
  console.error(`невідома конфігурація «${config ?? ''}»; відомі: ${Object.keys(CONFIGS).join(', ')}`);
  process.exit(2);
}
const model = isConfig(config) ? CONFIGS[config].join(' → ') : (process.env.HARNESS_MODEL ?? 'opencode/big-pickle');

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
const push = args.includes('--push');
const depsCache = new Map<string, Deps>();
const depsFor = (m: string): Deps => {
  let d = depsCache.get(m);
  if (d === undefined) {
    d = isConfig(config) ? realDeps(root, { model: m, push, label: config }) : realDeps(root, { model: m, push });
    depsCache.set(m, d);
  }
  return d;
};
const breaker = new CircuitBreaker(threshold);
const queueStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const results: { id: string; status: Status | 'skipped_breaker_open'; durationMs: number; turns: number; costUsd: number; out: string | null }[] = [];
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Крок 07: траса на кожну спробу (як у кроці 06) і файл вартості конфігурації.
const tel = isConfig(config) ? await startHarnessTelemetry() : { enabled: false, shutdown: async () => undefined };
const costFile = isConfig(config) ? join('docs', 'lab4', 'traces', `cost-${config}.jsonl`) : null;
if (costFile !== null) {
  mkdirSync(join('docs', 'lab4', 'traces'), { recursive: true });
  if (!args.includes('--append')) writeFileSync(costFile, '');
}

console.log(`черга: ${file} · задач ${tasks.length} · ${config === undefined ? '' : `конфігурація ${config} · `}модель ${model} · circuit breaker: ${threshold} невдач поспіль`);
for (const task of tasks) {
  if (!breaker.allows()) {
    console.log(`⏭ ${task.id} — пропущено: запобіжник розімкнений`);
    results.push({ id: task.id, status: 'skipped_breaker_open', durationMs: 0, turns: 0, costUsd: 0, out: null });
    continue;
  }
  console.log(`▶ ${task.id} … (бюджет: ходів ${task.budget.max_turns}, $${task.budget.max_usd}, ${task.budget.timeout_s} с)`);

  if (isConfig(config) && costFile !== null) {
    let lastOut = '';
    const run = await runConfig(config, async (m): Promise<Attempt> => {
      const out = join('runs', config, task.id, `${stampNow()}-${m.replace(/[^a-z0-9.-]+/gi, '_')}`);
      lastOut = out;
      const rec = await executeTask(task, depsFor(m), out);
      const lines = readFileSync(join(out, 'agent.log'), 'utf8').split('\n');
      const u = usageFromEvents(lines);
      const traceId = tel.enabled ? emitPlan(planSpans(rec, parseEvents(lines))) : null;
      if (u.totalMismatch) console.log(`  ⚠ ${task.id}: сума total по кроках ≠ вхід + вихід — перевір події step_finish`);
      console.log(`  ${m}: ${rec.status} · ${(rec.durationMs / 1000).toFixed(1)} с · кроків ${u.steps} · інструментів ${u.toolCalls} · вхід ${u.usage.inputTokens ?? 'не повідомлено'} · вихід ${u.usage.outputTokens ?? 'не повідомлено'} → ${out}`);
      return { rec, usage: u.usage, steps: u.steps, toolCalls: u.toolCalls, retries: u.retries, traceId };
    });
    const cost = costOf(task.id, config, run);
    appendFileSync(costFile, `${JSON.stringify(cost)}\n`);
    if (run.escalated) console.log(`  ↑ підняття: ${cost.model} · разом ${cost.duration_s} с`);
    const r = run.final.rec;
    results.push({ id: task.id, status: r.status, durationMs: Math.round(cost.duration_s * 1000), turns: cost.steps, costUsd: r.costUsd, out: lastOut });
    const state = breaker.record(task.id, r.status);
    if (state === 'open') console.log(`⛔ CIRCUIT BREAKER: ${threshold} невдач поспіль (${breaker.snapshot().trippedBy.join(', ')}) — решту черги зупинено`);
    continue;
  }

  const out = join('runs', task.id, stampNow());
  const r = await executeTask(task, depsFor(model), out);
  console.log(`  ${r.status} · ${(r.durationMs / 1000).toFixed(1)} с · ходів ${r.turns} · $${r.costUsd} · файлів ${r.changedFiles.length} → ${out}`);
  results.push({ id: task.id, status: r.status, durationMs: r.durationMs, turns: r.turns, costUsd: r.costUsd, out });
  const state = breaker.record(task.id, r.status);
  if (state === 'open') console.log(`⛔ CIRCUIT BREAKER: ${threshold} невдач поспіль (${breaker.snapshot().trippedBy.join(', ')}) — решту черги зупинено`);
}

await tel.shutdown();
const summary = { queue: file, startedAt: queueStamp, config: config ?? null, model, tasks: results, breaker: breaker.snapshot() };
mkdirSync('runs', { recursive: true });
const summaryFile = join('runs', `queue-${queueStamp}.json`);
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`підсумок черги → ${summaryFile}${costFile === null ? '' : ` · вартість → ${costFile}`}`);
process.exitCode = breaker.state === 'open' ? 3 : results.every((r) => r.status === 'pass') ? 0 : 1;
