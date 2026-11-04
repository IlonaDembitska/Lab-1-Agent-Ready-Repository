/**
 * Регресійна брама evals (Лаб. 3, крок 04). Ненульовий код виходу — єдиний спосіб,
 * яким GitHub Actions дізнається, що щось зламалося.
 *   npx tsx scripts/evals/gate.ts                    — порівняти docs/lab3/evals.jsonl з базовим рівнем
 *   npx tsx scripts/evals/gate.ts --write-baseline   — записати базовий рівень (РІВНО раз, навмисно, окремим комітом)
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { gate, toBaseline, type Baseline, type EvalLine } from './metrics';

const K = Number(process.env.EVAL_K ?? 3);
const LOG = process.env.EVAL_LOG ?? 'docs/lab3/evals.jsonl';
const BASE = 'docs/lab3/evals-baseline.json';
const lines: EvalLine[] = readFileSync(LOG, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as EvalLine);

if (lines.length === 0) {
  console.error(`${LOG} порожній — прогону не було`);
  process.exit(1);
}

if (process.argv.includes('--write-baseline')) {
  const out = toBaseline(lines, K);
  writeFileSync(BASE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`базовий рівень записано на ${Object.keys(out).length} задач (k=${K}) — закомітьте його НАВМИСНО окремим комітом`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, 'utf8')) as Baseline;
const r = gate(lines, base);
if (!r.ok) {
  console.error(`РЕГРЕСІЯ (${r.problems.length}):\n${r.problems.join('\n')}`);
  process.exit(1);
}
console.log(`регресії немає: перевірено regression-задач ${r.checked}, спроб у журналі ${lines.length}`);
