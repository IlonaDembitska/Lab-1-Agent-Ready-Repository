import { describe, expect, it } from 'vitest';

import { runPool, type Budget } from '../scripts/parallel-eval';

const budget = (maxBranches: number, maxTokens = 1_000_000): Budget => ({ maxBranches, maxTokens, maxWallMs: 60_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('не перевищує ширину пулу', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return 1;
    });
    await runPool(tasks, budget(3), () => 0);
    expect(peak).toBe(3);
  });

  it('помилка однієї гілки не валить решту', async () => {
    const tasks = [async () => 1, async () => { throw new Error('429'); }, async () => 3];
    const { results } = await runPool(tasks, budget(2), () => 0);
    expect(results[0]).toBe(1);
    expect(results[1]).toBeInstanceOf(Error);
    expect(results[2]).toBe(3);
  });

  it('правило зупинки: нова гілка не стартує після стелі токенів', async () => {
    let started = 0;
    const tasks = Array.from({ length: 5 }, () => async () => {
      started += 1;
      return 1;
    });
    const { stoppedEarly } = await runPool(tasks, budget(1, 100), () => 100);
    expect(stoppedEarly).toBe(true);
    expect(started).toBe(0);
  });
});
