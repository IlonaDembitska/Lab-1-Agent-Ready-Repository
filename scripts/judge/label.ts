/**
 * Ручна розмітка для калібрування судді (Лаб. 3, крок 05). Розмічає ЛЮДИНА, ДО запуску судді.
 *   npx tsx scripts/judge/label.ts
 * Показує кожен артефакт із docs/lab3/judge-set.json і питає по кожному виміру: p / f / u і причину.
 * Пише docs/lab3/judge-cases.jsonl рядок за рядком — можна перервати (Ctrl+C) і продовжити: готові пропускаються.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { loadArtifact, loadJsonl, type JudgeCase, type Label } from './artifact';

interface JudgeSet {
  readonly dimensions: readonly { readonly id: string; readonly question: string }[];
  readonly artifacts: readonly { readonly case_id: string; readonly artifact: string; readonly holdout: boolean }[];
}

const OUT = 'docs/lab3/judge-cases.jsonl';
const set = JSON.parse(readFileSync('docs/lab3/judge-set.json', 'utf8')) as JudgeSet;
const done = new Set(loadJsonl<JudgeCase>(OUT).map((c) => `${c.case_id}|${c.dimension}`));
const rl = createInterface({ input: process.stdin, output: process.stdout });
const total = set.artifacts.length * set.dimensions.length;
const MAP: Record<string, Label> = { p: 'pass', f: 'fail', u: 'unknown' };

let n = done.size;
for (const a of set.artifacts) {
  if (set.dimensions.every((d) => done.has(`${a.case_id}|${d.id}`))) continue;
  const art = loadArtifact(a.artifact);
  const lines = art.patch.split('\n');
  console.log(`\n${'═'.repeat(70)}\n${a.case_id} · ${a.artifact} · статус прогону: ${art.status}`);
  console.log(`ЗАДАЧА ${art.task.id}: ${art.task.input.slice(0, 400)}${art.task.input.length > 400 ? ' …' : ''}`);
  console.log(`Дозволені файли: ${(art.task.files ?? []).join(', ') || '(немає)'}`);
  console.log(`Змінені файли: ${art.changedFiles.join(', ') || '(нічого)'}`);
  console.log(`Перевірки: ${art.checks.length === 0 ? 'НЕ ЗАПУСКАЛИСЬ' : art.checks.map((c) => `${c.cmd} → код ${c.code}`).join(' | ')}`);
  console.log(`--- patch.diff (${lines.length} рядк.) ---\n${lines.slice(0, 45).join('\n')}${lines.length > 45 ? '\n… (обрізано)' : ''}`);
  for (const d of set.dimensions) {
    if (done.has(`${a.case_id}|${d.id}`)) continue;
    let label: Label | undefined;
    while (label === undefined) label = MAP[(await rl.question(`\n[${n + 1}/${total}] ${d.id}: ${d.question}\n  p = pass, f = fail, u = unknown → `)).trim().toLowerCase()];
    let reason = '';
    while (reason.length < 5) reason = (await rl.question('  причина одним реченням → ')).trim();
    const row: JudgeCase = { case_id: a.case_id, artifact: a.artifact, dimension: d.id, mine: label, reason, holdout: a.holdout };
    appendFileSync(OUT, `${JSON.stringify(row)}\n`);
    n += 1;
  }
}
rl.close();
console.log(`\nготово: ${n}/${total} міток у ${OUT}. Закомітьте його ОКРЕМИМ комітом ДО запуску судді.`);
