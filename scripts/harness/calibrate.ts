/**
 * Калібрування верифікатора (Лаб. 3, крок 02).
 * Бере ручну розмітку docs/lab3/calibration/labels.json (≥ 10 артефактів × V1–V4),
 * проганяє верифікатор на кожному артефакті, рахує raw agreement і Cohen's κ
 * (по клітинках і по рішенню брами «зливати / не зливати»), пише:
 *   docs/lab3/verdicts/calibration/<id>.json — сирі вердикти
 *   docs/lab3/calibration/comparison.md       — таблиця збігів і розходжень
 *
 *   npx tsx scripts/harness/calibrate.ts          — продовжує з місця зупинки (готові вердикти не перезапитує)
 *   npx tsx scripts/harness/calibrate.ts --fresh  — усе наново
 * VERIFIER_DELAY_MS — пауза між запитами (типово 4000: ліміт безкоштовного рівня).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { agreement, kappaLabel, type Agreement } from '../../src/verify/agreement';
import { blocks, HARNESS_CRITERIA, harnessReport, type HarnessReport } from '../../src/verify/harness-verdict';
import { loadTasks, verifyArtifact, VERIFIER_SPEC } from './verifier';

type Label = 'pass' | 'fail' | 'unknown';

export interface LabeledItem {
  readonly id: string;
  readonly task: string;
  readonly diff: string;
  readonly source: string;
  readonly labels: Readonly<Record<string, Label>>;
  readonly why: string;
}

export interface CellRow {
  readonly item: string;
  readonly criterion: string;
  readonly human: string;
  readonly model: string;
  readonly reason: string;
}

/** Розгортає розмітку й звіти в пари «людина — модель» по кожній клітинці. */
export function toCells(items: readonly LabeledItem[], reports: ReadonlyMap<string, HarnessReport>): CellRow[] {
  const rows: CellRow[] = [];
  for (const it of items) {
    const rep = reports.get(it.id);
    for (const c of HARNESS_CRITERIA) {
      const r = rep?.results.find((x) => x.criterion === c.id);
      rows.push({
        item: it.id,
        criterion: c.id,
        human: it.labels[c.id] ?? 'unknown',
        model: r?.verdict ?? 'error',
        reason: r?.reason ?? '',
      });
    }
  }
  return rows;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (a: Agreement) => `${a.agree}/${a.n} = ${pct(a.raw)} · κ = ${a.kappa.toFixed(3)} (${kappaLabel(a.kappa)})`;

export function renderComparison(items: readonly LabeledItem[], reports: ReadonlyMap<string, HarnessReport>): string {
  const cells = toCells(items, reports);
  const all = agreement(cells.map((c) => c.human), cells.map((c) => c.model));
  const gateHuman = items.map((it) => (blocks(HARNESS_CRITERIA.map((c) => ({ criterion: c.id, verdict: it.labels[c.id] ?? 'unknown', reason: '-', evidence: '' }))) ? 'block' : 'merge'));
  const gateModel = items.map((it) => ((reports.get(it.id)?.blocked ?? true) ? 'block' : 'merge'));
  const gate = agreement(gateHuman, gateModel);
  const cost = [...reports.values()].reduce((s, r) => s + r.costUsd, 0);
  const tokensIn = [...reports.values()].reduce((s, r) => s + r.usage.inputTokens, 0);
  const tokensOut = [...reports.values()].reduce((s, r) => s + r.usage.outputTokens, 0);

  const lines = [
    '# Калібрування верифікатора — людина проти моделі',
    '',
    `Верифікатор: \`${VERIFIER_SPEC.id}\` (Google) · виконавець, чию роботу судимо: OpenCode \`opencode/big-pickle\`.`,
    `Артефактів: ${items.length} · критеріїв: ${HARNESS_CRITERIA.length} · запитів: ${items.length * HARNESS_CRITERIA.length} (один критерій — один запит).`,
    `Токени: ${tokensIn} вх / ${tokensOut} вих · вартість ≈ $${cost.toFixed(4)}.`,
    '',
    '## Узгодженість',
    '',
    '| що порівнюємо | збіг (raw) і Cohen\'s κ |',
    '|---|---|',
    `| усі клітинки (артефакт × критерій) | ${fmt(all)} |`,
    ...HARNESS_CRITERIA.map((c) => {
      const cc = cells.filter((x) => x.criterion === c.id);
      return `| ${c.id} ${c.name} | ${fmt(agreement(cc.map((x) => x.human), cc.map((x) => x.model)))} |`;
    }),
    `| рішення брами (зливати / не зливати) | ${fmt(gate)} |`,
    '',
    '## Розходження',
    '',
  ];
  const diffs = cells.filter((c) => c.human !== c.model);
  if (diffs.length === 0) lines.push('Розходжень немає.');
  for (const d of diffs) lines.push(`- ${d.item} ${d.criterion}: людина=${d.human}, верифікатор=${d.model} — ${d.reason}`);
  lines.push('', '## Усі клітинки', '', '| артефакт | задача | критерій | людина | верифікатор | збіг |', '|---|---|---|---|---|---|');
  for (const c of cells) {
    const task = items.find((i) => i.id === c.item)?.task ?? '';
    lines.push(`| ${c.item} | ${task} | ${c.criterion} | ${c.human} | ${c.model} | ${c.human === c.model ? 'так' : '**ні**'} |`);
  }
  lines.push('', '## Рішення брами по артефактах', '', '| артефакт | джерело | людина | верифікатор |', '|---|---|---|---|');
  items.forEach((it, i) => lines.push(`| ${it.id} | ${it.source} | ${gateHuman[i]} | ${gateModel[i]} |`));
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  if (apiKey === '') throw new Error('немає GOOGLE_GENERATIVE_AI_API_KEY');
  const model = process.env.VERIFIER_MODEL ?? VERIFIER_SPEC.id;
  const delayMs = Number(process.env.VERIFIER_DELAY_MS ?? 4000);
  const dir = 'docs/lab3/calibration';
  const outDir = 'docs/lab3/verdicts/calibration';
  const { items } = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as { items: LabeledItem[] };
  const tasks = loadTasks();
  mkdirSync(outDir, { recursive: true });

  const fresh = process.argv.includes('--fresh');
  const reports = new Map<string, HarnessReport>();
  for (const it of items) {
    const task = tasks.find((t) => t.id === it.task);
    if (task === undefined) throw new Error(`${it.id}: задачі ${it.task} немає`);
    const file = join(outDir, `${it.id}.json`);
    if (!fresh && existsSync(file)) {
      const saved = harnessReport.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (saved.success && saved.data.model === model) {
        reports.set(it.id, saved.data);
        console.log(`${it.id} ${it.task} · вже є (${file})`);
        continue;
      }
    }
    const rep = await verifyArtifact(task, readFileSync(join(dir, it.diff), 'utf8'), { model, apiKey, delayMs });
    reports.set(it.id, rep);
    writeFileSync(file, `${JSON.stringify(rep, null, 2)}\n`);
    const row = rep.results.map((r) => `${r.criterion}=${r.verdict}${r.verdict === it.labels[r.criterion] ? '' : '≠'}`).join(' ');
    console.log(`${it.id} ${it.task} · ${row} · ${rep.blocked ? 'block' : 'merge'}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const md = renderComparison(items, reports);
  writeFileSync(join(dir, 'comparison.md'), md);
  console.log(md.split('\n').slice(0, 16).join('\n'));
  console.log(`→ ${join(dir, 'comparison.md')}`);
}

if (process.argv[1]?.endsWith('calibrate.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
