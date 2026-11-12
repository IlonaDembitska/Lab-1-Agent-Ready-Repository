import { describe, expect, it } from 'vitest';

import { summarise, toTaskCost, usageFromEvents, type TaskCost } from '../../scripts/harness/cost';
import { costOf, isConfig, runConfig, type Attempt } from '../../scripts/harness/escalate';
import type { RunRecord, Status } from '../../scripts/harness/run-task';

const step = (tokens: object) => JSON.stringify({ type: 'step_finish', part: { tokens } });
const ev = (type: string) => JSON.stringify({ type });

describe('usageFromEvents — еквівалент totalUsage з подій OpenCode', () => {
  it('сумує ВСІ кроки (а не останній), кеш-читання — у вхід, reasoning — у вихід', () => {
    const u = usageFromEvents([
      ev('step_start'),
      ev('tool_use'),
      step({ total: 11232, input: 10999, output: 81, reasoning: 152, cache: { read: 0, write: 0 } }),
      ev('step_start'),
      step({ total: 11710, input: 954, output: 261, reasoning: 15, cache: { read: 10480, write: 0 } }),
    ]);
    expect(u.steps).toBe(2);
    expect(u.toolCalls).toBe(1);
    expect(u.usage.inputTokens).toBe(10999 + 954 + 10480);
    expect(u.usage.inputTokenDetails.cacheReadTokens).toBe(10480);
    expect(u.usage.outputTokens).toBe(81 + 152 + 261 + 15);
    expect(u.usage.outputTokenDetails.reasoningTokens).toBe(167);
    expect(u.usage.totalTokens).toBe(11232 + 11710);
    expect(u.totalMismatch).toBe(false);
  });

  it('поле, якого жоден крок не повідомив, лишається undefined, а не 0', () => {
    const u = usageFromEvents([ev('step_start'), step({ input: 100, output: 5 })]);
    expect(u.usage.inputTokenDetails.cacheReadTokens).toBeUndefined();
    expect(u.usage.inputTokenDetails.cacheWriteTokens).toBeUndefined();
    expect(u.usage.outputTokenDetails.reasoningTokens).toBeUndefined();
    expect(u.usage.inputTokens).toBe(100);
  });

  it('прогін без жодної step_finish — вхід і вихід «не повідомлено»', () => {
    const u = usageFromEvents([ev('step_start'), '[stderr] boom']);
    expect(u.usage.inputTokens).toBeUndefined();
    expect(u.usage.outputTokens).toBeUndefined();
  });

  it('повтори рахує харнес: подія з retry або рядок stderr з retry', () => {
    const u = usageFromEvents([ev('session.retry'), '[stderr] Retrying request in 2s', '[stderr] other']);
    expect(u.retries).toBe(2);
  });

  it('розбіжність total по кроках і вхід+вихід помічається', () => {
    expect(usageFromEvents([step({ total: 999, input: 10, output: 1 })]).totalMismatch).toBe(true);
  });
});

const base = { task_id: 't', config: 'B-strong', model: 'm', trace_id: null, steps: 1, tool_calls: 0, retries: 0, escalated: false, exit_status: 'pass', duration_s: 1, passed: true };

describe('toTaskCost / summarise', () => {
  it('null лишається null, а не 0; дві спроби (підняття) сумуються', () => {
    const a = usageFromEvents([step({ input: 100, output: 10 })]).usage;
    const b = usageFromEvents([step({ input: 50, output: 5, cache: { read: 7 } })]).usage;
    const one = toTaskCost(base, [a]);
    expect(one.cache_read).toBeNull();
    expect(one.reasoning_tokens).toBeNull();
    const two = toTaskCost(base, [a, b]);
    expect(two.input_tokens).toBe(100 + 57);
    expect(two.cache_read).toBe(7);
    expect(two.output_tokens).toBe(15);
  });

  it('токенів на пройдену — лише по пройдених; «повідомлено N/M» окремо від суми', () => {
    const rows: TaskCost[] = [
      { ...base, passed: true, input_tokens: 100, output_tokens: 10, cache_read: null, cache_write: null, reasoning_tokens: null },
      { ...base, passed: false, input_tokens: 300, output_tokens: 30, cache_read: 5, cache_write: null, reasoning_tokens: null },
    ];
    const s = summarise(rows);
    expect(s.pass_share).toBe(0.5);
    expect(s.tokens_per_passed).toBe(440);
    expect(s.cache_read_reported).toBe('1/2');
    expect(s.cache_write_reported).toBe('0/2');
  });

  it('жодної пройденої — tokens_per_passed = null, а не ділення на нуль', () => {
    expect(summarise([{ ...base, passed: false, input_tokens: 1, output_tokens: 1, cache_read: null, cache_write: null, reasoning_tokens: null }]).tokens_per_passed).toBeNull();
  });
});

const rec = (model: string, status: Status, durationMs: number): RunRecord => ({
  id: 't', agent: 'fake', model, startedAt: '', finishedAt: '', durationMs, status, turns: 1, costUsd: 0,
  inputTokens: 0, outputTokens: 0, budget: { max_turns: 1, max_usd: 0, timeout_s: 1 }, agentExit: 0, agentError: null,
  deniedToolCalls: 0, checks: [], changedFiles: [], branch: null,
});
const attempt = (model: string, status: Status, input: number): Attempt => ({
  rec: rec(model, status, 1000),
  usage: usageFromEvents([step({ input, output: 1 })]).usage,
  steps: 2,
  toolCalls: 1,
  retries: 0,
  traceId: `trace-${model}`,
});

describe('конфігурації A / B', () => {
  it('невідома конфігурація не приймається', () => {
    expect(isConfig('A-cheap-escalate')).toBe(true);
    expect(isConfig('C')).toBe(false);
    expect(isConfig(undefined)).toBe(false);
  });

  it('B — рівно одна спроба сильною моделлю', async () => {
    const seen: string[] = [];
    const r = await runConfig('B-strong', async (m) => {
      seen.push(m);
      return attempt(m, 'fail', 10);
    });
    expect(seen).toEqual(['opencode/big-pickle']);
    expect(r.escalated).toBe(false);
  });

  it('A — дешева пройшла брами: підняття немає', async () => {
    const r = await runConfig('A-cheap-escalate', async (m) => attempt(m, 'pass', 10));
    expect(r.attempts).toHaveLength(1);
    expect(costOf('t', 'A-cheap-escalate', r).escalated).toBe(false);
  });

  it('A — дешева впала: підняття, і вартість = токени ОБОХ спроб', async () => {
    const r = await runConfig('A-cheap-escalate', async (m) => attempt(m, m.includes('nemotron') ? 'max_turns' : 'pass', m.includes('nemotron') ? 300 : 100));
    const c = costOf('t', 'A-cheap-escalate', r);
    expect(c.escalated).toBe(true);
    expect(c.passed).toBe(true);
    expect(c.input_tokens).toBe(400);
    expect(c.output_tokens).toBe(2);
    expect(c.steps).toBe(4);
    expect(c.duration_s).toBe(2);
    expect(c.model).toBe('opencode/nemotron-3.5-lightning-free → opencode/big-pickle');
    expect(c.trace_id).toBe('trace-opencode/big-pickle');
  });
});
