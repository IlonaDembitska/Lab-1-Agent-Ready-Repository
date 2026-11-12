/**
 * Верифікатор на fan-in (Лаб. 4, крок 03). Без інструментів, модель ІНШОЇ родини, ніж гілки:
 * гілки й звід — Gemini, верифікатор — локальна Ollama (Qwen). Той самий підхід, що в Лаб. 3:
 * строга схема, один запит на один критерій (тут критерій = одне твердження зводу),
 * і брама, яка валить усе, що не pass — unknown теж.
 */
import { MODELS } from '../models';
import { criterionVerdict, type CriterionVerdict } from '../verify/schema';
import { extractJson, VERDICT_JSON_SCHEMA } from '../../scripts/verify';

import type { Usage } from './budget';

export function verifierModel(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const id = (env.MULTI_VERIFIER_MODEL ?? '').trim() || MODELS.local.id;
  if (/^gemini/i.test(id)) throw new Error(`верифікатор ${id} — та сама родина, що й гілки (Gemini); потрібна інша`);
  return id;
}

/** СТРОГА брама кроку 03: блокує все, що не pass. (src/verify/schema.isBlocked з Лаб. 2 валить лише fail — тут цього мало.) */
export function isBlockedStrict(results: readonly CriterionVerdict[]): boolean {
  return results.length === 0 || results.some((r) => r.verdict !== 'pass');
}

export function claimPrompt(id: string, claim: string, evidence: string): string {
  return [
    'Ти — суворий верифікатор. Тобі дано ОДНЕ твердження про репозиторій і ДОКАЗ — фрагмент цього репозиторію.',
    'Оціни лише одне: чи ДОКАЗ прямо підтверджує твердження.',
    '- pass — доказ прямо підтверджує твердження;',
    '- fail — доказ суперечить твердженню або говорить про інше;',
    '- unknown — доказу недостатньо. Не вгадуй.',
    'Поверни ЛИШЕ JSON без іншого тексту:',
    `{"id":"${id}","verdict":"pass|fail|unknown","reason":"одне речення українською","evidence":"коротка цитата з доказу"}`,
    '',
    `Твердження ${id}: ${claim}`,
    '',
    'Доказ:',
    evidence,
  ].join('\n');
}

interface OllamaChat {
  readonly message?: { readonly content?: string };
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
}

export async function judgeClaim(
  id: string,
  claim: string,
  evidence: string,
  model: string,
): Promise<{ verdict: CriterionVerdict; usage: Usage; ms: number }> {
  const base = MODELS.local.baseUrl;
  const t0 = performance.now();
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: VERDICT_JSON_SCHEMA,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: 'user', content: claimPrompt(id, claim, evidence) }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as OllamaChat;
  const usage: Usage = { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count };
  const parsed = criterionVerdict.safeParse({ ...(extractJson(data.message?.content ?? '') as object), id });
  // невалідна відповідь — це не «майже pass», а unknown, і брама її валить
  const verdict: CriterionVerdict = parsed.success
    ? parsed.data
    : { id, verdict: 'unknown', reason: 'відповідь верифікатора не пройшла схему', evidence: '' };
  return { verdict, usage, ms: performance.now() - t0 };
}
