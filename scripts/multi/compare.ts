/**
 * Зводить дві колонки чисел кроку 03 (один агент проти розгалуження) з docs/lab4/multi-runs.jsonl.
 * Береться ОСТАННІЙ прогін кожного питання в кожному режимі, без прогонів зі свідомо заниженим бюджетом.
 *   npx tsx scripts/multi/compare.ts
 */
import { readFileSync } from 'node:fs';

type Row = {
  taskId: string;
  mode: 'multi' | 'single';
  budgetOverride: boolean;
  status: string;
  wallMs: number;
  computeMs: number;
  calls: number;
  modelRequests: number;
  inputTokens: number;
  outputTokens: number;
  unreported: number;
  quality: number;
  verdicts: { verdict: string }[];
};

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export function latest(rows: readonly Row[], mode: Row['mode']): Row[] {
  const by = new Map<string, Row>();
  for (const r of rows) if (r.mode === mode && !r.budgetOverride) by.set(r.taskId, r);
  return [...by.values()];
}

function main(): void {
  const rows = readFileSync('docs/lab4/multi-runs.jsonl', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Row);
  const a = latest(rows, 'single');
  const b = latest(rows, 'multi');
  const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((n, r) => n + f(r), 0);
  const passRate = (xs: Row[]) => {
    const v = xs.flatMap((r) => r.verdicts);
    return v.length === 0 ? 0 : v.filter((x) => x.verdict === 'pass').length / v.length;
  };
  const line = (name: string, x: string, y: string) => `| ${name} | ${x} | ${y} |`;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} с`;
  console.log(`N: один агент — ${a.length} питань, розгалуження — ${b.length} питань\n`);
  console.log('| Вимір | Один агент | Розгалуження |');
  console.log('|---|---|---|');
  console.log(line('час ДО ВІДПОВІДІ, медіана', secs(median(a.map((r) => r.wallMs))), secs(median(b.map((r) => r.wallMs)))));
  console.log(line('сумарний час обчислення (сума по ходах)', secs(sum(a, (r) => r.computeMs)), secs(sum(b, (r) => r.computeMs))));
  console.log(line('вхідні токени, сума', String(sum(a, (r) => r.inputTokens)), String(sum(b, (r) => r.inputTokens))));
  console.log(line('вихідні токени, сума', String(sum(a, (r) => r.outputTokens)), String(sum(b, (r) => r.outputTokens))));
  console.log(line('ходів (generateText + верифікатор), разом з упалими', String(sum(a, (r) => r.calls)), String(sum(b, (r) => r.calls))));
  console.log(line('HTTP-запитів до моделей (кроки)', String(sum(a, (r) => r.modelRequests)), String(sum(b, (r) => r.modelRequests))));
  console.log(line('токенів не повідомлено (ходів)', String(sum(a, (r) => r.unreported)), String(sum(b, (r) => r.unreported))));
  console.log(line('якість за еталоном (частка очікуваних фактів), середня', (sum(a, (r) => r.quality) / Math.max(1, a.length)).toFixed(2), (sum(b, (r) => r.quality) / Math.max(1, b.length)).toFixed(2)));
  console.log(line('тверджень pass у верифікатора', `${(passRate(a) * 100).toFixed(0)}%`, `${(passRate(b) * 100).toFixed(0)}%`));
  console.log(line('статуси', a.map((r) => `${r.taskId}:${r.status}`).join(' '), b.map((r) => `${r.taskId}:${r.status}`).join(' ')));
}

if (process.argv[1]?.endsWith('compare.ts')) main();
