import { describe, expect, it } from 'vitest';

import { median, summarize, type BaselineRow } from '../scripts/baseline';

const row = (over: Partial<BaselineRow>): BaselineRow => ({
  id: 'q-01',
  query: 'питання',
  tags: ['easy'],
  answer: 'відповідь',
  latencyMs: 1000,
  usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 50 },
  costUsd: 0.001,
  ...over,
});

describe('median', () => {
  it('порожній масив дає 0', () => expect(median([])).toBe(0));
  it('непарна кількість', () => expect(median([3, 1, 2])).toBe(2));
  it('парна кількість', () => expect(median([4, 1, 3, 2])).toBe(2.5));
});

describe('summarize', () => {
  it('рахує помилки, медіану й вартість на 100 запитів', () => {
    const s = summarize([
      row({ latencyMs: 1000 }),
      row({ id: 'q-02', latencyMs: 3000 }),
      row({ id: 'q-03', answer: null, error: 'rate limit', costUsd: 0, latencyMs: 50 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.medianLatencyMs).toBe(2000);
    expect(s.costPer100Usd).toBeCloseTo((0.002 / 3) * 100);
  });
});
