/**
 * Запобіжники перед будь-яким викликом моделі (Лаб. 4, крок 06): вимикач → стеля витрат.
 * Повертає готову відмову (Response) або null, якщо можна йти далі. Модель тут не викликається.
 */
import { checkDailyBudget, type CounterStore } from '../budget';
import { isAgentEnabled, type FlagReader } from '../flags';

import { json } from './http';

export async function guard(deps: { read?: FlagReader; store?: CounterStore } = {}): Promise<Response | null> {
  if (!(await isAgentEnabled(deps.read))) {
    // 503 і причина — щоб у трасі й журналі було видно, що це вимикач, а не падіння
    return json({ ok: false, error: 'agent_disabled' }, 503);
  }
  const b = await checkDailyBudget(deps.store);
  if (!b.ok) {
    return json({ ok: false, error: 'budget_exhausted', reason: b.reason, counters: b.counters ?? null, limits: b.limits }, 429);
  }
  return null;
}

/** /api/ready: ключ на місці, сховище прапорця досяжне, бюджет не вичерпано. БЕЗ виклику моделі. */
export async function readiness(deps: { env?: Readonly<Record<string, string | undefined>>; probe: () => Promise<boolean>; budget: () => Promise<{ ok: boolean; reason?: string }> }) {
  const env = deps.env ?? process.env;
  const b = await deps.budget();
  const checks = {
    key: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
    flagStore: await deps.probe(),
    budget: b.ok,
  };
  return { ok: Object.values(checks).every(Boolean), checks, ...(b.ok ? {} : { budgetReason: b.reason ?? 'unknown' }) };
}
