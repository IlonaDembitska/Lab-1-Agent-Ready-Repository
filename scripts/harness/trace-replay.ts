/**
 * Відтворення трас для невдалих прогонів, що відбулися ДО інструментації (Лаб. 3, крок 06).
 * Береться справжній журнал подій OpenCode (agent.log) і run.json із теки прогону; спани будуються з
 * тих самих подій і з тими самими часовими мітками, що й наживо (trace.ts), і йдуть у Langfuse.
 * Новим є лише trace_id — його генерує OTel у момент відтворення; це записано в кожній витяжці.
 *   npx tsx scripts/harness/trace-replay.ts docs/lab3/errors-cases.json
 * Для кожного випадку:
 *   docs/lab3/runs/<name>/        — patch.diff, output.txt, run.json із trace_id (agent.log НЕ копіюємо: там уміст файлів)
 *   docs/lab3/traces/<дата>-<клас>-<trace_id>.txt — текстова витяжка полів траси
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { startHarnessTelemetry } from '../../src/telemetry/otel';
import { emitPlan, extract, parseEvents, planSpans, type RunSummary } from './trace';

interface Case {
  readonly name: string;
  readonly dir: string;
  readonly cls: 'задача' | 'промпт' | 'інструмент' | 'модель' | 'харнес';
  readonly why: string;
}

const manifest = process.argv[2] ?? 'docs/lab3/errors-cases.json';
const cases = JSON.parse(readFileSync(manifest, 'utf8')) as Case[];
const tel = await startHarnessTelemetry();
if (!tel.enabled) {
  console.error('немає ключів Langfuse (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY) — трасу нікуди надіслати');
  process.exit(2);
}
const today = new Date().toISOString().slice(0, 10);
mkdirSync('docs/lab3/traces', { recursive: true });
const rows: string[] = [];
for (const c of cases) {
  if (!existsSync(join(c.dir, 'run.json')) || !existsSync(join(c.dir, 'agent.log'))) {
    console.error(`⚠ ${c.name}: немає ${c.dir}/run.json або agent.log — пропущено`);
    continue;
  }
  const run = JSON.parse(readFileSync(join(c.dir, 'run.json'), 'utf8')) as RunSummary & Record<string, unknown>;
  const plan = planSpans(run, parseEvents(readFileSync(join(c.dir, 'agent.log'), 'utf8').split('\n')));
  const traceId = emitPlan(plan);
  const dest = join('docs/lab3/runs', c.name);
  mkdirSync(dest, { recursive: true });
  for (const f of ['patch.diff', 'output.txt']) if (existsSync(join(c.dir, f))) copyFileSync(join(c.dir, f), join(dest, f));
  writeFileSync(join(dest, 'run.json'), `${JSON.stringify({ ...run, trace_id: traceId, trace_replayed_from: `${c.dir}/agent.log` }, null, 2)}\n`);
  const file = join('docs/lab3/traces', `${today}-${c.cls}-${traceId}.txt`);
  writeFileSync(
    file,
    [
      `клас: ${c.cls}`,
      `випадок: ${c.name} · задача ${run.id} · статус ${run.status} · ходів ${run.turns}`,
      `джерело: ${c.dir}/agent.log (траса відтворена ${today} з подій OpenCode; час подій справжній, trace_id новий)`,
      `чому цей клас: ${c.why}`,
      '',
      extract(plan, traceId),
    ].join('\n'),
  );
  rows.push(`| ${c.name} | ${run.id} | ${c.cls} | ${run.status} | ${plan.children.length} | ${traceId} |`);
  console.log(`${c.name} · ${c.cls} · ${run.status} · trace_id ${traceId}`);
}
await tel.shutdown();
console.log(['', '| випадок | задача | клас | статус | дочірніх спанів | trace_id |', '|---|---|---|---|---|---|', ...rows].join('\n'));
