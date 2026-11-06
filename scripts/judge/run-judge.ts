/**
 * Суддя (Лаб. 3, крок 05): Gemini (інша родина, ніж виконавець OpenCode Big Pickle).
 * Один вимір — один окремий запит; рубрика — scripts/judge/rubric-<версія>.json.
 *   npx tsx scripts/judge/run-judge.ts --rubric v1   → docs/lab3/verdicts/judge-v1.jsonl
 * Ручна розмітка (judge-cases.jsonl) має бути закомічена РАНІШЕ за перший запуск — скрипт це перевіряє.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { prepareDiff, VERIFIER_SPEC, type FetchLike } from '../harness/verifier';
import { loadArtifact, loadJsonl, type Artifact, type JudgeCase } from './artifact';

export interface DimensionRubric {
  readonly question: string;
  readonly pass: string;
  readonly fail: string;
  readonly unknown: string;
  /** Приклади з власних артефактів (з'являються в рубриці v2). */
  readonly examples?: readonly { readonly verdict: string; readonly case: string; readonly why: string }[];
}

export interface Rubric {
  readonly version: string;
  readonly dimensions: Readonly<Record<string, DimensionRubric>>;
}

export const judgeAnswer = z
  .object({
    verdict: z.enum(['pass', 'fail', 'unknown']),
    reason: z.string().min(1),
  })
  .strict();

export function buildJudgePrompt(dim: string, r: DimensionRubric, a: Artifact): string {
  const checks = a.checks.length === 0 ? 'НЕ ЗАПУСКАЛИСЬ' : a.checks.map((c) => `${c.cmd} → код виходу ${c.code}`).join('\n');
  return [
    'Ти — суддя, що оцінює артефакт роботи ШІ-агента РІВНО за одним виміром. Інші властивості ігноруй.',
    `Вимір «${dim}»: ${r.question}`,
    `- pass — ${r.pass}`,
    `- fail — ${r.fail}`,
    `- unknown — ${r.unknown}`,
    ...(r.examples && r.examples.length > 0
      ? ['', 'Приклади (з інших артефактів цього ж харнесу):', ...r.examples.map((e) => `- ${e.verdict}: ${e.case} — ${e.why}`)]
      : []),
    'Відповідай JSON: {"verdict":"pass|fail|unknown","reason":"одне речення українською"}.',
    '',
    `ЗАДАЧА ${a.task.id}: ${a.task.input}`,
    `Дозволені файли: ${(a.task.files ?? []).join(', ') || '(немає)'}`,
    `Команди acceptance задачі: ${a.task.acceptance.join(' ; ')}`,
    `Статус прогону: ${a.status}`,
    `Результати перевірок:\n${checks}`,
    `Змінені файли: ${a.changedFiles.join(', ') || '(нічого)'}`,
    '',
    'patch.diff:',
    prepareDiff(a.patch),
    '',
    'output.txt (обрізано до 3000 символів):',
    a.output.slice(0, 3000) || '(порожньо)',
  ].join('\n');
}

const SCHEMA = {
  type: 'OBJECT',
  properties: { verdict: { type: 'STRING', enum: ['pass', 'fail', 'unknown'] }, reason: { type: 'STRING' } },
  required: ['verdict', 'reason'],
  propertyOrdering: ['verdict', 'reason'],
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function askJudge(
  prompt: string,
  opts: { model: string; apiKey: string; fetchFn?: FetchLike; retryDelayMs?: number },
): Promise<{ verdict: 'pass' | 'fail' | 'unknown'; reason: string; modelVersion: string }> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchLike);
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  });
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body,
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      last = `Gemini ${res.status}`;
      if (attempt < 6) await sleep(Math.min((opts.retryDelayMs ?? 10_000) * 2 ** (attempt - 1), 120_000));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text) as { modelVersion?: string; candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const answer = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(answer);
    } catch {
      json = null;
    }
    const parsed = judgeAnswer.safeParse(json);
    if (parsed.success) return { ...parsed.data, modelVersion: data.modelVersion ?? opts.model };
    last = 'відповідь не пройшла схему';
  }
  throw new Error(last || 'немає валідної відповіді');
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--rubric');
  const version = i >= 0 ? (process.argv[i + 1] ?? 'v1') : 'v1';
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  if (apiKey === '') throw new Error('немає GOOGLE_GENERATIVE_AI_API_KEY');
  const model = process.env.JUDGE_MODEL ?? VERIFIER_SPEC.id;

  // Розмітка людини має бути закомічена ДО першого прогону судді.
  const committed = execFileSync('git', ['log', '-1', '--format=%h %cI', '--', 'docs/lab3/judge-cases.jsonl'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'docs/lab3/judge-cases.jsonl'], { encoding: 'utf8' }).trim();
  if (committed === '' || dirty !== '') throw new Error('docs/lab3/judge-cases.jsonl не закомічено (або змінено після коміту) — спершу закомітьте ручну розмітку');
  console.log(`розмітка закомічена: ${committed}`);

  const rubric = JSON.parse(readFileSync(`scripts/judge/rubric-${version}.json`, 'utf8')) as Rubric;
  const cases = loadJsonl<JudgeCase>('docs/lab3/judge-cases.jsonl');
  const out = `docs/lab3/verdicts/judge-${version}.jsonl`;
  const done = new Set(loadJsonl<{ case_id: string; dimension: string }>(out).map((v) => `${v.case_id}|${v.dimension}`));
  if (!existsSync(out)) writeFileSync(out, '');
  console.log(`суддя: ${model} · рубрика ${version} · випадків ${cases.length} (один вимір — один запит) · вже є ${done.size}`);

  for (const c of cases) {
    if (done.has(`${c.case_id}|${c.dimension}`)) continue;
    const r = rubric.dimensions[c.dimension];
    if (r === undefined) throw new Error(`у рубриці ${version} немає виміру ${c.dimension}`);
    const a = loadArtifact(c.artifact);
    const v = await askJudge(buildJudgePrompt(c.dimension, r, a), { model, apiKey });
    const row = {
      case_id: c.case_id,
      dimension: c.dimension,
      verdict: v.verdict,
      reason: v.reason,
      model,
      model_version: v.modelVersion,
      rubric: version,
      order: 'n/a — суддя оцінює один артефакт, порівняння двох варіантів немає',
      at: new Date().toISOString(),
    };
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    console.log(`${c.case_id} ${c.dimension}: ${v.verdict}${v.verdict === c.mine ? '' : ` (у тебе ${c.mine})`} — ${v.reason}`);
    await sleep(2000);
  }
  console.log(`→ ${out}`);
}

if (process.argv[1]?.endsWith('run-judge.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
