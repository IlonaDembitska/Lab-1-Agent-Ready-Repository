import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LanguageModel } from 'ai';
import { afterAll, describe, expect, it } from 'vitest';

import { add, addLost, DEFAULT_BUDGET, empty, overBudget, tokensUsed } from '../src/multi/budget';
import { fanOut, isQuotaError, type GenerateFn } from '../src/multi/fanout';
import { READ_ONLY_TOOLS, readerTools, safePath } from '../src/multi/reader-tools';
import { parseDraft, quality, type Question } from '../src/multi/synth';
import { isBlockedStrict, verifierModel } from '../src/multi/verifier';

const tmp = mkdtempSync(join(tmpdir(), 'multi-'));
const stopLog = join(tmp, 'budget-stop.jsonl');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fakeModel = 'fake' as unknown as LanguageModel;
const lanes = ['history', 'deps', 'module', 'tests'].map((lane) => ({ lane, prompt: lane }));

describe('budget', () => {
  it('невідомі токени не пишуться як нуль, а рахуються окремо', () => {
    let s = add(empty(), { inputTokens: 10, outputTokens: 5 }, 100, 3);
    s = add(s, { inputTokens: undefined, outputTokens: undefined }, 50);
    s = addLost(s, 20);
    expect(s).toEqual({ calls: 3, modelRequests: 5, input: 10, output: 5, unreported: 2, ms: 170 });
    expect(tokensUsed(s)).toBe(15);
  });

  it('перевірка перед раундом і на fan-in', () => {
    const b = { ...DEFAULT_BUDGET, maxTurns: 3, tokenCeiling: 100 };
    expect(overBudget(empty(), b, 4, false)).toBe('turn-budget');
    expect(overBudget(add(empty(), { inputTokens: 90, outputTokens: 20 }, 1), b, 0, false)).toBe('token-ceiling');
    expect(overBudget(empty(), b, 0, true)).toBe('wall-clock');
    expect(overBudget(empty(), b, 2, false)).toBe('none');
  });
});

describe('fanOut', () => {
  const ok: GenerateFn = async (a) => ({ text: `текст ${a.functionId}`, usage: { inputTokens: 100, outputTokens: 10 }, steps: 2 });

  it('чотири гілки паралельно, functionId = питання/смуга', async () => {
    const r = await fanOut({ model: fakeModel, system: '', readOnlyTools: {}, rounds: [lanes], budget: DEFAULT_BUDGET, taskId: 'q1', generate: ok, stopLog });
    expect(r.stop).toBe('none');
    expect(r.out.map((o) => o.text)).toEqual(['текст q1/history', 'текст q1/deps', 'текст q1/module', 'текст q1/tests']);
    expect(r.spent.calls).toBe(4);
    expect(r.spent.modelRequests).toBe(8);
  });

  it('стеля ходів нижча за кількість гілок — раунд не стартує', async () => {
    let called = 0;
    const gen: GenerateFn = async (a) => {
      called += 1;
      return ok(a);
    };
    const r = await fanOut({ model: fakeModel, system: '', readOnlyTools: {}, rounds: [lanes], budget: { ...DEFAULT_BUDGET, maxTurns: 3 }, taskId: 'q1', generate: gen, stopLog });
    expect(r.stop).toBe('turn-budget');
    expect(r.stopRound).toBe(0);
    expect(called).toBe(0);
  });

  it('стеля токенів спрацьовує на fan-in навіть при одному раунді', async () => {
    const r = await fanOut({ model: fakeModel, system: '', readOnlyTools: {}, rounds: [lanes], budget: { ...DEFAULT_BUDGET, tokenCeiling: 300 }, taskId: 'q1', generate: ok, stopLog });
    expect(r.stop).toBe('token-ceiling');
    expect(r.out).toHaveLength(4);
  });

  it('упала гілка списує хід і потрапляє у failed; 429 — брейкер', async () => {
    const gen: GenerateFn = async (a) => {
      if (a.functionId.endsWith('/deps')) throw new Error('boom');
      if (a.functionId.endsWith('/tests')) throw new Error('429 RESOURCE_EXHAUSTED');
      return ok(a);
    };
    const r = await fanOut({ model: fakeModel, system: '', readOnlyTools: {}, rounds: [lanes], budget: DEFAULT_BUDGET, taskId: 'q1', generate: gen, stopLog });
    expect(r.failed).toEqual(['deps', 'tests']);
    expect(r.spent.calls).toBe(4);
    expect(r.spent.unreported).toBe(2);
    expect(r.stop).toBe('quota-429');
    expect(isQuotaError('Gemini 429')).toBe(true);
  });

  it('гілок більше за maxBranches — помилка конфігурації', async () => {
    await expect(
      fanOut({ model: fakeModel, system: '', readOnlyTools: {}, rounds: [[...lanes, { lane: 'x', prompt: 'x' }]], budget: DEFAULT_BUDGET, taskId: 'q1', generate: ok, stopLog }),
    ).rejects.toThrow(/maxBranches/);
  });
});

describe('reader tools', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fork-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'x');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  symlinkSync(tmpdir(), join(root, 'out'));

  it('шлях лишається всередині форка; .env і вихід назовні заборонені', () => {
    expect(safePath(root, 'src/a.js')).toBe(join(root, 'src', 'a.js'));
    expect(() => safePath(root, '../etc/passwd')).toThrow();
    expect(() => safePath(root, '/etc/passwd')).toThrow(/абсолютний/);
    expect(() => safePath(root, '.env')).toThrow(/\.env/);
    expect(() => safePath(root, 'out')).toThrow(/за межі/);
  });

  it('у ролі читача лише читальні інструменти з файлу конфігурації', () => {
    const tools = readerTools(root);
    expect(Object.keys(tools).sort()).toEqual([...READ_ONLY_TOOLS].sort());
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, JSON.stringify({ role: 'reader', allow: ['read_file', 'write_file'] }));
    expect(() => readerTools(root, bad)).toThrow(/write_file/);
  });
});

describe('звід і верифікатор', () => {
  const q: Question = { id: 'q', question: '?', module: 'index.js', expect: ['index.js', '33cc74b'] };

  it('чернетка зі строгою схемою; якість — частка очікуваних фактів', () => {
    const d = parseDraft('```json\n{"answer":"Функція parse живе в index.js і змінювалась.","claims":[{"text":"parseInt додано","sha":"33cc74b"}]}\n```');
    expect(d).not.toBeNull();
    expect(quality(q, d)).toBe(1);
    expect(parseDraft('{"answer":"коротко","claims":[]}')).toBeNull();
    expect(quality(q, null)).toBe(0);
  });

  it('брама валить усе, що не pass, і порожній звіт', () => {
    expect(isBlockedStrict([{ id: 'C1', verdict: 'pass', reason: 'ok', evidence: '' }])).toBe(false);
    expect(isBlockedStrict([{ id: 'C1', verdict: 'unknown', reason: '?', evidence: '' }])).toBe(true);
    expect(isBlockedStrict([])).toBe(true);
  });

  it('верифікатор не може бути тієї ж родини, що гілки', () => {
    expect(() => verifierModel({ MULTI_VERIFIER_MODEL: 'gemini-3.5-flash-lite' })).toThrow(/родина/);
    expect(verifierModel({ MULTI_VERIFIER_MODEL: 'qwen3.5:4b' })).toBe('qwen3.5:4b');
  });
});
