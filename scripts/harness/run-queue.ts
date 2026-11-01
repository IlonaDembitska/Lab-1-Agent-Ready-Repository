/**
 * Черга задач (Лаб. 3, крок 00). Задачі виконуються по одній.
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl            — уся черга
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01  — одна задача (перезапуск)
 *   … --push  — запушити гілку harness/<id>-<час> з артефактом
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { executeTask, realDeps, type Task } from './run-task';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? 'docs/lab3/tasks.jsonl';
const idIdx = args.indexOf('--id');
const only = idIdx >= 0 ? args[idIdx + 1] : undefined;
const model = process.env.HARNESS_MODEL ?? 'opencode/big-pickle';

const tasks: Task[] = readFileSync(file, 'utf8')
  .replace(/^\uFEFF/, '')
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
for (const task of tasks) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join('runs', task.id, stamp);
  console.log(`▶ ${task.id} …`);
  const r = await executeTask(task, deps, out);
  console.log(`  ${r.status} · ${(r.durationMs / 1000).toFixed(1)} с · ходів ${r.turns} · $${r.costUsd} · файлів ${r.changedFiles.length} → ${out}`);
}
