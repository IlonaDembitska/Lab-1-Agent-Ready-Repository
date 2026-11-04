import { describe, expect, it } from 'vitest';

import { gate, summarize, toBaseline, type EvalLine } from '../../scripts/evals/metrics';

const L = (task_id: string, bucket: string, pass: boolean, frozen_at = '2026-11-04'): EvalLine => ({ task_id, bucket, frozen_at, pass });

const run: EvalLine[] = [
  L('t-01', 'regression', true),
  L('t-01', 'regression', true),
  L('t-01', 'regression', true),
  L('t-02', 'regression', true),
  L('t-02', 'regression', false),
  L('t-02', 'regression', true),
  L('t-16', 'edge', false),
  L('t-16', 'edge', false),
  L('t-16', 'edge', false),
];

describe('pass@k і pass^k', () => {
  it('рахуються окремо по кошиках', () => {
    expect(summarize(run, 3)).toEqual([
      { bucket: 'regression', tasks: 2, pass_at_k: 1, pass_pow_k: 0.5 },
      { bucket: 'edge', tasks: 1, pass_at_k: 0, pass_pow_k: 0 },
    ]);
  });
});

describe('регресійна брама', () => {
  const base = toBaseline(run, 3);

  it('базовий рівень: pow_k = 1 лише для задач, що пройшли всі k', () => {
    expect(base['t-01']?.pow_k).toBe(1);
    expect(base['t-02']?.pow_k).toBeCloseTo(2 / 3);
  });

  it('той самий результат — регресії немає', () => {
    expect(gate(run, base).ok).toBe(true);
  });

  it('конкретна задача зламалась: t-01 було 3/3, стало 2/3 → регресія', () => {
    const now = run.map((l, i) => (i === 0 ? { ...l, pass: false } : l));
    const r = gate(now, base);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['t-01: було pass^k = 1, стало 2/3']);
  });

  it('середнє те саме, але впала інша задача — однаково регресія', () => {
    const now = run.map((l, i) => (i === 0 ? { ...l, pass: false } : i === 4 ? { ...l, pass: true } : l));
    expect(gate(now, base).ok).toBe(false);
  });

  it('edge у брамі не бере участі', () => {
    const now = run.map((l) => (l.bucket === 'edge' ? { ...l, pass: true } : l));
    expect(gate(now, base).checked).toBe(2);
  });

  it('інший frozen_at — інший банк, порівнювати не можна', () => {
    const now = run.map((l) => ({ ...l, frozen_at: '2026-11-10' }));
    expect(gate(now, base).problems[0]).toMatch(/інший банк/);
    const mixed = run.map((l, i) => (i === 0 ? { ...l, frozen_at: '2026-11-10' } : l));
    expect(gate(mixed, base).problems[0]).toMatch(/не заморожений/);
  });
});
