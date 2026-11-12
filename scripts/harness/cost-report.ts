/**
 * Таблиці аудиту вартості з сирих записів (Лаб. 4, крок 07) — замість слів «я порахував».
 *   npx tsx scripts/harness/cost-report.ts docs/lab4/traces                         — друк Markdown
 *   npx tsx scripts/harness/cost-report.ts docs/lab4/traces --inject docs/lab4/cost.md
 *     — вставити між <!-- cost-report:start --> і <!-- cost-report:end --> (решта cost.md — рукою)
 * «Не повідомлено» (null у записі) друкується словами, а поруч із сумами — «повідомлено N/M».
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { summarise, type TaskCost } from './cost';

const dir = process.argv[2] ?? 'docs/lab4/traces';
const injIdx = process.argv.indexOf('--inject');
const inject = injIdx >= 0 ? process.argv[injIdx + 1] : undefined;
const files = readdirSync(dir).filter((f) => f.startsWith('cost-') && f.endsWith('.jsonl')).sort();
const load = (f: string): TaskCost[] =>
  readFileSync(join(dir, f), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as TaskCost);
const name = (f: string) => f.replace(/^cost-|\.jsonl$/g, '');
const nr = (v: number | null) => (v === null ? 'не повідомлено' : String(v));
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Сума з «повідомлено N/M»; якщо не повідомила жодна задача — словами, а не нулем. */
const sr = (v: number, rep: string) => (rep.startsWith('0/') ? `не повідомлено (${rep})` : `${v} (${rep})`);
const out: string[] = [];

out.push('### Зведення по конфігураціях', '');
out.push('| Конфігурація | Задач | Пройдено | Вхід (повідомлено) | Кеш-читання | Кеш-запис | Вихід | Reasoning | Інструментів | Повторів | Підняттів | Час, с | Токенів на пройдену |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of files) {
  const s = summarise(load(f));
  out.push(`| ${name(f)} | ${s.tasks} | ${s.passed} (${pct(s.pass_share)}) | ${sr(s.input_tokens, s.input_reported)} | ${sr(s.cache_read, s.cache_read_reported)} | ${sr(s.cache_write, s.cache_write_reported)} | ${sr(s.output_tokens, s.output_reported)} | ${sr(s.reasoning_tokens, s.reasoning_reported)} | ${s.tool_calls} | ${s.retries} | ${s.escalations} | ${Math.round(s.duration_s)} | ${s.tokens_per_passed ?? 'немає пройдених'} |`);
}

out.push('', '### Екстраполяція на ×10 задач (лінійно від цього прогону)', '');
out.push('| Конфігурація | Токенів ×10 | Час ×10 | Найдовша задача, с | Задач понад 300 с |');
out.push('|---|---|---|---|---|');
for (const f of files) {
  const rows = load(f);
  const s = summarise(rows);
  const longest = rows.reduce((m, r) => Math.max(m, r.duration_s), 0);
  out.push(`| ${name(f)} | ${(s.input_tokens + s.output_tokens) * 10} | ${Math.round(s.duration_s * 10)} с ≈ ${((s.duration_s * 10) / 3600).toFixed(1)} год | ${longest} | ${rows.filter((r) => r.duration_s > 300).length} з ${rows.length} |`);
}

for (const f of files) {
  out.push('', `### Задача за задачею: ${name(f)}`, '');
  out.push('| task_id | модель | кроків | викликів інстр. | повторів | вхід | кеш-читання | кеш-запис | вихід | reasoning | час, с | статус | пройдено |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of load(f)) {
    out.push(`| ${r.task_id} | ${r.model} | ${r.steps} | ${r.tool_calls} | ${r.retries} | ${nr(r.input_tokens)} | ${nr(r.cache_read)} | ${nr(r.cache_write)} | ${nr(r.output_tokens)} | ${nr(r.reasoning_tokens)} | ${r.duration_s} | ${r.exit_status} | ${r.passed ? 'так' : 'ні'} |`);
  }
}

const table = out.join('\n');
if (inject === undefined) console.log(table);
else {
  const START = '<!-- cost-report:start -->';
  const END = '<!-- cost-report:end -->';
  const doc = readFileSync(inject, 'utf8');
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`у ${inject} немає маркерів ${START} … ${END}`);
  writeFileSync(inject, `${doc.slice(0, a + START.length)}\n<!-- згенеровано: npx tsx scripts/harness/cost-report.ts ${dir} --inject ${inject} -->\n\n${table}\n\n${doc.slice(b)}`);
  console.log(`таблиці вставлено в ${inject} (${files.length} конфігурацій)`);
}
