/**
 * Калібрування судді (Лаб. 3, крок 05): сира згода + каппа Коена + матриця невідповідностей 3×3,
 * окремо на кожен вимір і окремо на робочих / ВІДКЛАДЕНИХ / усіх випадках.
 * agreement() — той самий, що на кроці 02 (src/verify/agreement.ts).
 *   npx tsx scripts/judge/calibrate.ts --rubric v1   → docs/lab3/judge-calibration-v1.md
 */
import { writeFileSync } from 'node:fs';

import { agreement } from '../../src/verify/agreement';
import { LABELS, loadJsonl, type JudgeCase, type Label } from './artifact';

export type Matrix = Record<Label, Record<Label, number>>;

/** Матриця 3×3: рядок — моя мітка, стовпець — вердикт судді. */
export function confusion(mine: readonly Label[], judge: readonly Label[]): Matrix {
  const m: Matrix = {
    pass: { pass: 0, fail: 0, unknown: 0 },
    fail: { pass: 0, fail: 0, unknown: 0 },
    unknown: { pass: 0, fail: 0, unknown: 0 },
  };
  mine.forEach((l, i) => {
    const j = judge[i];
    if (j !== undefined) m[l][j] += 1;
  });
  return m;
}

export interface SubsetReport {
  readonly name: string;
  readonly n: number;
  readonly raw: number;
  readonly expected: number;
  /** null — каппа не визначена (очікувана випадкова згода = 1: усі мітки однакові). */
  readonly kappa: number | null;
  readonly matrix: Matrix;
}

export function report(name: string, pairs: readonly { mine: Label; judge: Label }[]): SubsetReport | null {
  if (pairs.length === 0) return null;
  const mine = pairs.map((p) => p.mine);
  const judge = pairs.map((p) => p.judge);
  const a = agreement(mine, judge);
  return { name, n: a.n, raw: a.raw, expected: a.expected, kappa: a.expected === 1 ? null : a.kappa, matrix: confusion(mine, judge) };
}

const f3 = (x: number) => x.toFixed(3);

export function renderReport(r: SubsetReport): string[] {
  const m = r.matrix;
  return [
    `**${r.name}** · n = ${r.n} · сира згода ${f3(r.raw)} · очікувана випадкова ${f3(r.expected)} · каппа ${r.kappa === null ? 'не визначена (усі мітки однакові)' : f3(r.kappa)}`,
    '',
    '| мій ↓ / суддя → | pass | fail | unknown |',
    '|---|---|---|---|',
    ...LABELS.map((l) => `| **${l}** | ${m[l].pass} | ${m[l].fail} | ${m[l].unknown} |`),
    '',
    `- пропускає погане (мій fail → суддя pass): **${m.fail.pass}**`,
    `- марна робота (мій pass → суддя fail): **${m.pass.fail}**`,
    '',
  ];
}

function main(): void {
  const i = process.argv.indexOf('--rubric');
  const version = i >= 0 ? (process.argv[i + 1] ?? 'v1') : 'v1';
  const cases = loadJsonl<JudgeCase>('docs/lab3/judge-cases.jsonl');
  const verdicts = loadJsonl<{ case_id: string; dimension: string; verdict: Label; model_version: string }>(`docs/lab3/verdicts/judge-${version}.jsonl`);
  const byKey = new Map(verdicts.map((v) => [`${v.case_id}|${v.dimension}`, v]));
  const pair = (cs: readonly JudgeCase[]) =>
    cs.filter((c) => byKey.has(`${c.case_id}|${c.dimension}`)).map((c) => ({ mine: c.mine, judge: byKey.get(`${c.case_id}|${c.dimension}`)!.verdict }));

  const lines = [
    `# Калібрування судді — рубрика ${version}`,
    '',
    `Модель судді: ${[...new Set(verdicts.map((v) => v.model_version))].join(', ') || '—'} · вердиктів ${verdicts.length} з ${cases.length}`,
    '',
  ];
  const dims = [...new Set(cases.map((c) => c.dimension))];
  for (const d of [...dims, 'УСІ ВИМІРИ']) {
    const cs = d === 'УСІ ВИМІРИ' ? cases : cases.filter((c) => c.dimension === d);
    lines.push(`## ${d}`, '');
    for (const [name, sub] of [
      ['робочі', cs.filter((c) => !c.holdout)],
      ['ВІДКЛАДЕНІ', cs.filter((c) => c.holdout)],
      ['усі', cs],
    ] as const) {
      const r = report(name, pair(sub));
      if (r !== null) lines.push(...renderReport(r));
    }
  }
  const disagreements = cases.filter((c) => {
    const v = byKey.get(`${c.case_id}|${c.dimension}`);
    return v !== undefined && v.verdict !== c.mine;
  });
  lines.push('## Розбіжності', '');
  for (const c of disagreements) {
    lines.push(`- ${c.case_id}${c.holdout ? ' (відкладений)' : ''} ${c.dimension}: я=${c.mine}, суддя=${byKey.get(`${c.case_id}|${c.dimension}`)?.verdict} · ${c.artifact}`);
  }
  const md = `${lines.join('\n')}\n`;
  writeFileSync(`docs/lab3/judge-calibration-${version}.md`, md);
  console.log(md);
}

if (process.argv[1]?.endsWith('calibrate.ts')) main();
