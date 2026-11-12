/**
 * Стеля витрат на рівні застосунку (Лаб. 4, крок 06): Spend Management на Hobby — N/A, тож межа лише тут.
 * Лічильники — СПІЛЬНІ для всіх інстансів, у Redis (Upstash, Vercel Marketplace), операція HINCRBY атомарна —
 * не «прочитав → додав → записав». Ключ дня живе 2 доби (EXPIRE).
 * Межі: типові нижче + перевизначення з Edge Config (ключ dailyLimits) — щоб довести спрацювання без деплою.
 * Властивість, яку не ховаю: перевірка стоїть ПЕРЕД викликом, тож перевищення можливе на
 * «запити в польоті × токени одного запиту» — тому межі взято з запасом проти квоти AI Studio.
 */
import { Redis } from '@upstash/redis';

import { edgeConfigReader, type FlagReader } from './flags';

export interface DayCounters {
  readonly date: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}
export interface DayLimits {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}
export interface UsageLike {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}
export interface CounterStore {
  load(date: string): Promise<DayCounters>;
  add(date: string, d: { requests: number; inputTokens: number; outputTokens: number }): Promise<void>;
}

/**
 * Типові межі: квота AI Studio для gemini-3.5-flash-lite — 500 запитів/добу, 250K токенів/хв (зчитано 2026-11-12);
 * свої межі — помітно нижче: 150 запитів, 300K вхідних, 30K вихідних токенів на добу.
 */
export const DEFAULT_LIMITS: DayLimits = { requests: 150, inputTokens: 300_000, outputTokens: 30_000 };

export const today = (): string => new Date().toISOString().slice(0, 10);

export function redisStore(env: Readonly<Record<string, string | undefined>> = process.env): CounterStore {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? '';
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? '';
  if (url === '' || token === '') throw new Error('сховище лічильників не налаштовано (UPSTASH_REDIS_REST_URL / KV_REST_API_URL)');
  const redis = new Redis({ url, token });
  const key = (date: string) => `lab4:budget:${date}`;
  return {
    async load(date) {
      const h = (await redis.hgetall<Record<string, number | string>>(key(date))) ?? {};
      const n = (v: number | string | undefined) => Number(v ?? 0);
      return { date, requests: n(h.requests), inputTokens: n(h.inputTokens), outputTokens: n(h.outputTokens) };
    },
    async add(date, d) {
      await Promise.all([
        redis.hincrby(key(date), 'requests', d.requests),
        redis.hincrby(key(date), 'inputTokens', d.inputTokens),
        redis.hincrby(key(date), 'outputTokens', d.outputTokens),
        redis.expire(key(date), 2 * 24 * 3600),
      ]);
    },
  };
}

/** Межі: типові, перевизначені тим, що лежить в Edge Config під dailyLimits (лише додатні числа). */
export async function readLimits(read: FlagReader = edgeConfigReader): Promise<DayLimits> {
  try {
    const raw = (await read('dailyLimits')) as Partial<Record<keyof DayLimits, unknown>> | undefined;
    const pick = (k: keyof DayLimits) => (typeof raw?.[k] === 'number' && (raw[k] as number) > 0 ? (raw[k] as number) : DEFAULT_LIMITS[k]);
    return { requests: pick('requests'), inputTokens: pick('inputTokens'), outputTokens: pick('outputTokens') };
  } catch {
    return DEFAULT_LIMITS;
  }
}

export type BudgetCheck = { ok: true; counters: DayCounters; limits: DayLimits } | { ok: false; reason: string; counters?: DayCounters; limits: DayLimits };

/** Перед викликом моделі. Сховище недосяжне → відмова (закрито), а не «пропустимо». */
export async function checkDailyBudget(store?: CounterStore, limits?: DayLimits): Promise<BudgetCheck> {
  const lim = limits ?? (await readLimits());
  let c: DayCounters;
  try {
    c = await (store ?? redisStore()).load(today());
  } catch (err) {
    return { ok: false, reason: `counter_store_unavailable: ${err instanceof Error ? err.message : String(err)}`, limits: lim };
  }
  if (c.requests >= lim.requests) return { ok: false, reason: 'requests', counters: c, limits: lim };
  if (c.inputTokens >= lim.inputTokens) return { ok: false, reason: 'input_tokens', counters: c, limits: lim };
  if (c.outputTokens >= lim.outputTokens) return { ok: false, reason: 'output_tokens', counters: c, limits: lim };
  return { ok: true, counters: c, limits: lim };
}

/** Після прогону: агентний цикл звітує totalUsage, а не usage одного кроку. Кожне поле — number | undefined. */
export async function recordUsage(u: UsageLike, store?: CounterStore): Promise<void> {
  await (store ?? redisStore()).add(today(), { requests: 1, inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 });
}
