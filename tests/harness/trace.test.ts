import { describe, expect, it } from 'vitest';

import { extract, parseEvents, planSpans } from '../../scripts/harness/trace';
import { langfuseOtlpEnv } from '../../src/telemetry/otel';

const rec = (status: string, turns = 2) => ({
  id: 't-10',
  model: 'opencode/big-pickle',
  status,
  startedAt: '2026-11-06T13:00:00.000Z',
  finishedAt: '2026-11-06T13:07:00.000Z',
  turns,
  deniedToolCalls: 1,
});
const T = Date.parse('2026-11-06T13:00:00.000Z');
const ev = (o: object) => JSON.stringify(o);

const log = [
  ev({ type: 'step_start', timestamp: T + 1000 }),
  ev({ type: 'tool_use', timestamp: T + 2000, part: { tool: 'read', callID: 'c1', state: { status: 'completed', time: { start: T + 1500, end: T + 2000 } } } }),
  ev({ type: 'step_finish', timestamp: T + 3000, part: { reason: 'tool-calls', tokens: { input: 100, output: 10 } } }),
  ev({ type: 'step_start', timestamp: T + 4000 }),
  ev({
    type: 'tool_use',
    timestamp: T + 5000,
    part: { tool: 'bash', callID: 'c2', state: { status: 'error', error: 'The user has specified a rule which prevents you from using this specific tool call.' } },
  }),
  ev({ type: 'step_finish', timestamp: T + 6000, part: { reason: 'tool-calls', tokens: { input: 200, output: 20 } } }),
  ev({ type: 'step_start', timestamp: T + 7000 }),
  '[stderr] щось',
  '{"type":"text", обрізано',
];

describe('траса з подій OpenCode', () => {
  it('invoke_agent → chat → execute_tool з правильним часом і токенами', () => {
    const p = planSpans(rec('timeout', 3), parseEvents(log));
    expect(p.name).toBe('invoke_agent opencode/big-pickle');
    expect(p.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(p.attributes['gen_ai.usage.input_tokens']).toBe(300);
    expect(p.attributes['harness.stopped_by_harness']).toBe(true);
    expect(p.errorType).toBe('timeout');
    const chats = p.children;
    expect(chats).toHaveLength(3);
    expect(chats[0]?.children[0]?.name).toBe('execute_tool read');
    expect(chats[0]?.start).toBe(T + 1000);
    expect(chats[0]?.end).toBe(T + 3000);
  });

  it('відмова в дозволі — error.type permission_denied на спані інструмента', () => {
    const p = planSpans(rec('timeout', 3), parseEvents(log));
    expect(p.children[1]?.children[0]?.errorType).toBe('permission_denied');
  });

  it('крок без step_finish — chat зі error.type no_response до кінця прогону (ознака зависання)', () => {
    const p = planSpans(rec('timeout', 3), parseEvents(log));
    const last = p.children[2];
    expect(last?.errorType).toBe('no_response');
    expect(last?.end).toBe(Date.parse('2026-11-06T13:07:00.000Z'));
  });

  it('модель не відповіла жодного разу: жодного chat, лише корінь', () => {
    const p = planSpans(rec('stalled', 0), []);
    expect(p.children).toHaveLength(0);
    expect(p.attributes['harness.chat_spans']).toBe(0);
  });

  it('pass — без error.type; витяжка містить trace_id і поля', () => {
    const p = planSpans(rec('pass'), parseEvents(log.slice(0, 3)));
    expect(p.errorType).toBeNull();
    const text = extract(p, 'abc123');
    expect(text).toContain('trace_id: abc123');
    expect(text).toContain('gen_ai.response.finish_reasons = ["tool-calls"]');
  });
});

describe('OTLP для Langfuse', () => {
  it('Basic-авторизація з ключів і заголовок ingestion v4; без ключів — null', () => {
    const r = langfuseOtlpEnv({ LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk', LANGFUSE_BASE_URL: 'https://cloud.langfuse.com/' });
    expect(r?.endpoint).toBe('https://cloud.langfuse.com/api/public/otel');
    expect(r?.headers).toBe(`Authorization=Basic ${Buffer.from('pk:sk').toString('base64')},x-langfuse-ingestion-version=4`);
    expect(langfuseOtlpEnv({})).toBeNull();
  });
});
