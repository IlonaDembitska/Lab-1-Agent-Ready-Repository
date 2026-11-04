import { describe, expect, it } from 'vitest';

import { CircuitBreaker } from '../../scripts/harness/breaker';

describe('CircuitBreaker', () => {
  it('розмикається після N невдач поспіль і далі не пускає задачі', () => {
    const b = new CircuitBreaker(2);
    expect(b.record('s-01', 'max_turns')).toBe('closed');
    expect(b.allows()).toBe(true);
    expect(b.record('s-02', 'timeout')).toBe('open');
    expect(b.allows()).toBe(false);
    expect(b.snapshot()).toEqual({
      threshold: 2,
      state: 'open',
      consecutiveFailures: 2,
      openedAfter: 's-02',
      trippedBy: ['max_turns', 'timeout'],
    });
  });

  it('pass обнуляє лічильник: невдачі не поспіль запобіжник не розмикають', () => {
    const b = new CircuitBreaker(2);
    b.record('a', 'fail');
    b.record('b', 'pass');
    b.record('c', 'agent_error');
    expect(b.state).toBe('closed');
    expect(b.snapshot().consecutiveFailures).toBe(1);
  });

  it('розімкнений запобіжник сам не замикається — навіть після pass', () => {
    const b = new CircuitBreaker(1);
    b.record('a', 'max_usd');
    expect(b.record('b', 'pass')).toBe('open');
    expect(b.snapshot().openedAfter).toBe('a');
  });

  it('поріг — ціле ≥ 1', () => {
    expect(() => new CircuitBreaker(0)).toThrow(RangeError);
    expect(() => new CircuitBreaker(1.5)).toThrow(RangeError);
  });
});
