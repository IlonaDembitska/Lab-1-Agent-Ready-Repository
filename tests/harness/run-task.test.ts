import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPrompt, eventCost, executeTask, isTurnEvent, type Deps, type Task } from '../../scripts/harness/run-task';

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

  it('вичерпано бюджет у доларах: status max_usd, агента зупинено сигналом', async () => {
    let aborted = false;
    const r = await executeTask(task, fakeDeps(async (_ws, _p, onLine, signal) => {
      onLine('{"type":"step_finish","part":{"cost":0.3}}');
      onLine('{"type":"step_finish","part":{"cost":0.2}}');
      aborted = signal.aborted;
      return -1;
    }), out());
    expect(r.status).toBe('max_usd');
    expect(r.costUsd).toBeGreaterThan(task.budget.max_usd);
    expect(aborted).toBe(true);
    expect(r.checks).toHaveLength(0);
  });

  it('таймаут: агент висить, сигнал його зупиняє, status timeout', async () => {
    const quick: Task = { ...task, budget: { ...task.budget, timeout_s: 0.05 } };
    const r = await executeTask(quick, fakeDeps((_ws, _p, _onLine, signal) => new Promise((res) => {
      signal.addEventListener('abort', () => res(-1));
    })), out());
    expect(r.status).toBe('timeout');
    expect(r.agentExit).toBe(-1);
    expect(r.checks).toHaveLength(0);
  });

  it('агент ігнорує сигнал і висить: executeTask однаково завершується після abortGraceMs', async () => {
    const quick: Task = { ...task, budget: { ...task.budget, timeout_s: 0.05 } };
    const started = Date.now();
    const r = await executeTask(quick, { ...fakeDeps(() => new Promise<number>(() => undefined)), abortGraceMs: 30 }, out());
    expect(r.status).toBe('timeout');
    expect(r.agentExit).toBe(-2);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('агент замовк після відмови в дозволі: status stalled задовго до таймауту, відмови пораховано', async () => {
    const started = Date.now();
    const r = await executeTask(
      task,
      {
        ...fakeDeps((_ws, _p, onLine, signal) => {
          onLine('{"type":"tool_use","part":{"state":{"error":"The user has specified a rule which prevents you from using this specific tool call."}}}');
          return new Promise<number>((res) => signal.addEventListener('abort', () => res(-1)));
        }),
        idleMs: 40,
      },
      out(),
    );
    expect(r.status).toBe('stalled');
    expect(r.deniedToolCalls).toBe(1);
    expect(r.checks).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(task.budget.timeout_s * 1000);
  });

  it('промпт каже агенту, які команди оболонки дозволені', () => {
    expect(buildPrompt(task)).toContain('Оболонка обмежена');
    expect(buildPrompt(task)).toContain('без ; && |');
    expect(buildPrompt(task)).toContain('нічого не змінюй і не викликай інструментів');
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
