/**
 * Збирає докази прогону red-team у docs/lab3/ (крок 07):
 *  - повторно перевіряє ВСІ інваріанти на збережених артефактах (у т.ч. доданих після прогону);
 *  - копіює patch.diff, output.txt, run.json і agent.log у docs/lab3/runs/redteam-<мітка>/<сценарій>/,
 *    причому в agent.log значення змінних середовища з дампу замінено на <прибрано> (канарку лишаємо —
 *    вона фальшива і є доказом), а відомі формати ключів затерто;
 *  - пише текстову витяжку траси в docs/lab3/traces/<дата>-redteam-<мітка>-<сценарій>-<trace_id>.txt;
 *  - ЗУПИНЯЄТЬСЯ без запису, якщо в будь-якій копії знайдено значення справжнього секрету із середовища.
 *
 *   npx tsx --env-file=.env.local scripts/redteam/collect.ts runs/redteam/<час>-before
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { extract, parseEvents, planSpans, type RunSummary } from '../harness/trace';
import { CANARY_VAR } from './cases';
import { INVARIANTS } from './invariants';

const runDir = process.argv[2];
if (runDir === undefined || !existsSync(runDir)) throw new Error('вкажіть теку прогону: runs/redteam/<час>-<мітка>');
const label = basename(runDir).replace(/^.*-(\w+)$/, '$1');
const today = new Date().toISOString().slice(0, 10);

const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD|AUTH|OTEL_EXPORTER_OTLP_HEADERS/i;
const secrets = Object.entries(process.env)
  .filter(([k, v]) => SECRETISH.test(k) && v !== undefined && v.length >= 8)
  .map(([, v]) => v as string);

export function redact(log: string): string {
  return log
    .replace(/\\"([A-Z_][A-Z0-9_]*)\\":\\"(.*?)\\"(?=,\\"|\})/g, (m, name: string) => (name === CANARY_VAR ? m : `\\"${name}\\":\\"<прибрано>\\"`))
    .replace(/\b(sk-lf-|pk-lf-|sk-ant-|sk-proj-|AIza)[A-Za-z0-9_-]{8,}/g, '$1<прибрано>');
}

const base = JSON.parse(
  readFileSync('docs/lab3/tasks.jsonl', 'utf8')
    .split('\n')
    .find((l) => l.includes(`"id": "${process.env.REDTEAM_BASE ?? 't-07'}"`)) ?? '{}',
) as { files?: string[] };

const staged: Array<{ path: string; text: string } | { path: string; from: string }> = [];
const rows: string[] = [];
for (const c of readdirSync(runDir).sort()) {
  const src = join(runDir, c);
  if (!existsSync(join(src, 'run.json'))) continue;
  const run = JSON.parse(readFileSync(join(src, 'run.json'), 'utf8')) as RunSummary & { trace_id?: string | null };
  const ev = { worktree: join('..', 'harness-runs', '_'), artifactDir: src, root: '.', secrets, allowed: base.files ?? [] };
  const res = INVARIANTS.map((i) => ({ id: i.id, ...i.check(ev) }));
  appendFileSync('docs/lab3/redteam-recheck.jsonl', `${JSON.stringify({ case: c, label, trace_id: run.trace_id ?? null, status: run.status, invariants: res, at: new Date().toISOString() })}\n`);
  rows.push(`| ${c} | ${run.status} | ${res.filter((r) => !r.ok).map((r) => r.id).join(', ') || '—'} | ${run.trace_id ?? '—'} |`);

  const dest = join('docs/lab3/runs', `redteam-${label}`, c);
  for (const f of ['patch.diff', 'output.txt', 'run.json']) if (existsSync(join(src, f))) staged.push({ path: join(dest, f), from: join(src, f) });
  const log = readFileSync(join(src, 'agent.log'), 'utf8');
  staged.push({ path: join(dest, 'agent.log'), text: redact(log) });
  if (run.trace_id) {
    const plan = planSpans(run, parseEvents(log.split('\n')));
    staged.push({
      path: join('docs/lab3/traces', `${today}-redteam-${label}-${c}-${run.trace_id}.txt`),
      text: [`red-team ${label} · сценарій ${c} · статус ${run.status}`, `порушені інваріанти: ${res.filter((r) => !r.ok).map((r) => `${r.id} (${r.detail})`).join('; ') || 'немає'}`, '', extract(plan, run.trace_id)].join('\n'),
    });
  }
}

// перевірка ДО запису: жодного справжнього секрету в жодній копії
for (const s of staged) {
  const text = 'text' in s ? s.text : readFileSync(s.from, 'utf8');
  if (secrets.some((v) => text.includes(v))) {
    console.error(`СТОП: у ${s.path} знайдено значення справжнього секрету — нічого не записано`);
    process.exit(2);
  }
}
for (const s of staged) {
  mkdirSync(join(s.path, '..'), { recursive: true });
  if ('text' in s) writeFileSync(s.path, s.text);
  else copyFileSync(s.from, s.path);
}
console.log([`перевірено ${secrets.length} секретів середовища — у копіях їх немає`, '', '| сценарій | статус | порушені інваріанти | trace_id |', '|---|---|---|---|', ...rows].join('\n'));
