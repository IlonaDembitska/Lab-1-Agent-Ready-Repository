import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { eventCost, executeTask, isTurnEvent, type Deps, type Task } from '../../scripts/harness/run-task';

const task: Task = {
  id: 't-test',
  input: 'тестова задача',
  acceptance: ['true'],
  budget: { max_turns: 2, max_usd: 0.4, timeout_s: 30 },
};

function fakeDeps(runAgent: Deps['runAgent'], checkCode = 0): Deps {
  return {
    agent: 'fake',
    model: 'fake/model',
    prepare: async () => ({
      dir: '/tmp/fake',
      branch: null,
      collect: async () => ({ diff: 'diff --git a/x b/x\n', files: ['x'] }),
      cleanup: async () => undefined,
    }),
    runAgent,
    runCheck: async () => ({ code: checkCode, output: 'ok' }),
  };
}

const out = (): string => mkdtempSync(join(tmpdir(), 'harness-'));
const files = ['patch.diff', 'output.txt', 'agent.log', 'run.json'];
const record = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as Record<string, unknown>;

describe('executeTask (підроблений агент, без мережі)', () => {
  it('успіх: чотири файли, status pass, тривалість > 0', async () => {
    const dir = out();
    const r = await executeTask(task, fakeDeps(async (_ws, _p, onLine) => {
      onLine('{"type":"step_start"}');
      return 0;
    }), dir);
    expect(r.status).toBe('pass');
    for (const f of files) expect(existsSync(join(dir, f))).toBe(true);
    expect(record(dir).durationMs).toBeGreaterThan(0);
  });

  it('агент упав: журнал однаково записано, status agent_error', async () => {
    const dir = out();
    const r = await executeTask(task, fakeDeps(async () => {
      throw new Error('агент упав');
    }), dir);
    expect(r.status).toBe('agent_error');
    expect(record(dir).agentError).toBe('агент упав');
  });

  it('вичерпано ліміт ходів: status max_turns, перевірки не запускались', async () => {
    const dir = out();
    const r = await executeTask(task, fakeDeps(async (_ws, _p, onLine) => {
      for (let i = 0; i < 5; i += 1) onLine('{"type":"step_start"}');
      return 0;
    }), dir);
    expect(r.status).toBe('max_turns');
    expect(r.turns).toBeGreaterThan(task.budget.max_turns);
    expect(r.checks).toHaveLength(0);
    expect(existsSync(join(dir, 'run.json'))).toBe(true);
  });

  it('перевірка не пройшла: status fail', async () => {
    const r = await executeTask(task, fakeDeps(async () => 0, 1), out());
    expect(r.status).toBe('fail');
  });

  it('ходи й вартість рахуються з подій', () => {
    expect(isTurnEvent({ type: 'step_start' })).toBe(true);
    expect(isTurnEvent({ type: 'text' })).toBe(false);
    expect(eventCost({ part: { cost: 0.01, tokens: { cost: 0.02 } } })).toBeCloseTo(0.03, 10);
  });
});
