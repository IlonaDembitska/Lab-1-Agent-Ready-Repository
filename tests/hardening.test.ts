import { describe, expect, it } from 'vitest';

import { checkDailyBudget, DEFAULT_LIMITS, readLimits, recordUsage, today, type CounterStore, type DayCounters } from '../src/budget';
import { isAgentEnabled, probeFlagStore, type FlagReader } from '../src/flags';
import { guard, readiness } from '../src/lab4/guard';
import { withTaskSpan } from '../src/telemetry/task-span';

const reader = (v: Record<string, unknown>): FlagReader => async (k) => v[k];
const broken: FlagReader = async () => {
  throw new Error('edge config down');
};

function memStore(start: Partial<DayCounters> = {}): CounterStore & { c: DayCounters } {
  const s = { c: { date: today(), requests: 0, inputTokens: 0, outputTokens: 0, ...start } as DayCounters } as CounterStore & { c: DayCounters };
  s.load = async () => s.c;
  s.add = async (_d, x) => {
    s.c = { ...s.c, requests: s.c.requests + x.requests, inputTokens: s.c.inputTokens + x.inputTokens, outputTokens: s.c.outputTokens + x.outputTokens };
  };
  return s;
}

describe('вимикач', () => {
  it('лише явне true вмикає; збій сховища = вимкнено', async () => {
    expect(await isAgentEnabled(reader({ agentEnabled: true }))).toBe(true);
    expect(await isAgentEnabled(reader({ agentEnabled: 'true' }))).toBe(false);
    expect(await isAgentEnabled(reader({}))).toBe(false);
    expect(await isAgentEnabled(broken)).toBe(false);
  });
  it('перевірка досяжності не глушить збій', async () => {
    expect(await probeFlagStore(reader({ agentEnabled: false }))).toBe(true);
    expect(await probeFlagStore(broken)).toBe(false);
  });
});

describe('стеля витрат', () => {
  it('межі з Edge Config перевизначають типові лише додатними числами', async () => {
    expect(await readLimits(reader({ dailyLimits: { requests: 1 } }))).toEqual({ ...DEFAULT_LIMITS, requests: 1 });
    expect(await readLimits(reader({ dailyLimits: { requests: -5, inputTokens: 'x' } }))).toEqual(DEFAULT_LIMITS);
    expect(await readLimits(broken)).toEqual(DEFAULT_LIMITS);
  });
  it('спрацьовує по запитах і токенах; облік — totalUsage з undefined як 0', async () => {
    const s = memStore();
    const lim = { requests: 2, inputTokens: 1000, outputTokens: 100 };
    expect((await checkDailyBudget(s, lim)).ok).toBe(true);
    await recordUsage({ inputTokens: 600, outputTokens: undefined }, s);
    await recordUsage({ inputTokens: 500, outputTokens: 10 }, s);
    const r = await checkDailyBudget(s, lim);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toBe('requests');
    expect(s.c).toMatchObject({ requests: 2, inputTokens: 1100, outputTokens: 10 });
  });
  it('недосяжне сховище лічильників = відмова, а не пропуск', async () => {
    const bad: CounterStore = { load: async () => { throw new Error('redis down'); }, add: async () => undefined };
    const r = await checkDailyBudget(bad, DEFAULT_LIMITS);
    expect(r.ok).toBe(false);
  });
});

describe('guard і ready', () => {
  it('503 на вимкненому прапорці, 429 на вичерпаному бюджеті, null — коли можна', async () => {
    expect((await guard({ read: reader({ agentEnabled: false }), store: memStore() }))?.status).toBe(503);
    const full = memStore({ requests: DEFAULT_LIMITS.requests });
    const r = await guard({ read: reader({ agentEnabled: true }), store: full });
    expect(r?.status).toBe(429);
    expect(await r?.json()).toMatchObject({ error: 'budget_exhausted', reason: 'requests' });
    expect(await guard({ read: reader({ agentEnabled: true }), store: memStore() })).toBeNull();
  });
  it('ready не кличе модель і падає, якщо хоч одна перевірка не пройшла', async () => {
    const ok = await readiness({ env: { GOOGLE_GENERATIVE_AI_API_KEY: 'x' }, probe: async () => true, budget: async () => ({ ok: true }) });
    expect(ok.ok).toBe(true);
    const bad = await readiness({ env: {}, probe: async () => false, budget: async () => ({ ok: false, reason: 'requests' }) });
    expect(bad).toMatchObject({ ok: false, checks: { key: false, flagStore: false, budget: false }, budgetReason: 'requests' });
  });
});

describe('спан задачі', () => {
  it('повертає trace_id (32 hex) і пропускає результат', async () => {
    const r = await withTaskSpan('t-1', async (traceId) => traceId);
    expect(r).toMatch(/^[0-9a-f]{32}$/);
  });
});
