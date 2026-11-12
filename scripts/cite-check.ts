/**
 * Детермінована перевірка цитат дослідження (Лаб. 4, крок 04). Запускається ДО будь-якої моделі.
 *   FORK_DIR=~/lab4/bytes.js npx tsx scripts/cite-check.ts [docs/lab4/research-cites.json]
 * Код виходу 1, якщо хоч одна цитата не існує.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { checkCite, cite } from '../src/multi/cite';
import { forkDir } from '../src/multi/reader-tools';

function main(): void {
  const file = process.argv[2] ?? 'docs/lab4/research-cites.json';
  const root = forkDir();
  const cites = z.array(cite).parse(JSON.parse(readFileSync(file, 'utf8')));
  const bad = cites.map((c) => ({ c, why: checkCite(root, c) })).filter((r) => r.why !== null);
  for (const r of bad) console.error(`${JSON.stringify(r.c)} — ${r.why}`);
  console.log(`цитат: ${cites.length}, не підтверджено: ${bad.length}`);
  if (bad.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith('cite-check.ts')) main();
