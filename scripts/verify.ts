/**
 * Верифікатор (крок 03, Лабораторна 2): локальна модель Ollama судить одну зміну
 * за критеріями приймання A1–A5 зі spec.md. Один критерій — один запит.
 * Звертається до Ollama /api/chat напряму: think=false, format = JSON-схема вердикту.
 * Запуск: npm run verify  (або npx tsx scripts/verify.ts <файл.diff>)
 */
import { readFileSync } from 'node:fs';

import { MODELS } from '../src/models';
import { criterionVerdict, isBlocked, verifyReport, type CriterionVerdict } from '../src/verify/schema';

export interface Criterion {
  readonly id: string;
  readonly text: string;
  readonly check: string;
}

/** Критерії з таблиці розділу «## 6.» специфікації. */
export function parseCriteria(spec: string): Criterion[] {
  const start = spec.indexOf('## 6.');
  if (start === -1) return [];
  const rest = spec.slice(start);
  const end = rest.indexOf('\n### ');
  const section = end === -1 ? rest : rest.slice(0, end);
  const out: Criterion[] = [];
  for (const line of section.split(/\r?\n/)) {
    const m = /^\|\s*(A\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (m) out.push({ id: m[1] ?? '', text: m[2] ?? '', check: m[3] ?? '' });
  }
  return out;
}

const SECRET_LINE = /(api[_-]?key|secret|token|password)\s*[:=]/i;
const ENV_FILE = /^(\+\+\+|---) [ab]\/(?:.*\/)?\.env(?!\.example)/m;

/** Прибирає з diff рядки, схожі на секрети; повідомляє, чи зачеплено .env. */
export function redactDiff(diff: string): { text: string; touchesEnv: boolean } {
  const text = diff
    .split(/\r?\n/)
    .map((line) => (SECRET_LINE.test(line) ? '[вилучено: можливий секрет]' : line))
    .join('\n');
  return { text, touchesEnv: ENV_FILE.test(diff) };
}

/** Дістає перший JSON-обʼєкт із відповіді моделі (без блоків міркувань <think>). */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  try {
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    return null;
  }
}

export function buildPrompt(c: Criterion, diff: string): string {
  return [
    'Ти — суворий суддя змін коду. Оціни ЛИШЕ ОДИН критерій приймання за наданою зміною.',
    `Критерій ${c.id}: ${c.text}`,
    `Чим він перевіряється: ${c.check}`,
    'Правила:',
    '- pass — у зміні є прямий доказ, що критерій виконано;',
    '- fail — у зміні є доказ, що критерій порушено;',
    '- unknown — даних у зміні недостатньо, щоб судити. Не вгадуй.',
    '- evidence — файл і рядок або коротка цитата зі зміни; для unknown може бути порожнім рядком.',
    'Поверни ЛИШЕ JSON без жодного іншого тексту:',
    `{"id":"${c.id}","verdict":"pass|fail|unknown","reason":"одне-два речення","evidence":"…"}`,
    '',
    'Зміна (diff):',
    diff,
  ].join('\n');
}

/** JSON-схема для параметра format в Ollama: модель не може повернути іншу форму. */
export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
    reason: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['id', 'verdict', 'reason', 'evidence'],
} as const;

const MAX_DIFF_CHARS = 12_000;

interface OllamaChatResponse {
  readonly message?: { readonly content?: string };
}

async function judge(c: Criterion, diff: string, modelId: string): Promise<CriterionVerdict> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${MODELS.local.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        think: false,
        format: VERDICT_JSON_SCHEMA,
        options: { temperature: 0, num_ctx: 8192 },
        messages: [{ role: 'user', content: buildPrompt(c, diff) }],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as OllamaChatResponse;
    const parsed = criterionVerdict.safeParse({
      ...(extractJson(data.message?.content ?? '') as object),
      id: c.id,
    });
    if (parsed.success) return parsed.data;
    console.error(`  ${c.id}: невалідна відповідь моделі (спроба ${attempt})`);
  }
  throw new Error(`${c.id}: модель двічі повернула невалідну відповідь`);
}

async function main(): Promise<void> {
  const diffFile = process.argv[2] ?? 'docs/lab2/verify-input.diff';
  const modelId = process.env.VERIFIER_MODEL ?? MODELS.local.id;
  const criteria = parseCriteria(readFileSync('docs/lab2/spec.md', 'utf8'));
  if (criteria.length === 0) throw new Error('у docs/lab2/spec.md не знайдено критеріїв розділу 6');

  const { text, touchesEnv } = redactDiff(readFileSync(diffFile, 'utf8'));
  if (touchesEnv) throw new Error('diff зачіпає файл .env — верифікатор його не надсилає');
  const diff = text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n[diff обрізано]` : text;

  console.log(`верифікатор: ${modelId} · критеріїв: ${criteria.length} · diff: ${diffFile}`);
  const results: CriterionVerdict[] = [];
  for (const c of criteria) {
    const started = performance.now();
    const v = await judge(c, diff, modelId);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    results.push(v);
    console.log(`${v.id} | ${v.verdict} | ${v.reason}${v.evidence ? ` | ${v.evidence}` : ''} (${secs} с)`);
  }
  const report = verifyReport.parse({ results });
  if (isBlocked(report)) {
    console.error('БРАМА: є fail — зміну не зливати');
    process.exit(1);
  }
  console.log('брама пройдена: fail немає');
}

if (process.argv[1]?.endsWith('verify.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
