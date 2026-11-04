import { describe, expect, it } from 'vitest';

import { confusionMatrix, renderComparison, toCells, type LabeledItem } from '../../scripts/harness/calibrate';
import type { Task } from '../../scripts/harness/run-task';
import {
  buildVerifierPrompt,
  judgeCriterion,
  prepareDiff,
  taskIdFromBranch,
  verifyArtifact,
  type FetchLike,
} from '../../scripts/harness/verifier';
import { agreement } from '../../src/verify/agreement';
import { blocks, HARNESS_CRITERIA, harnessVerdict, type HarnessReport } from '../../src/verify/harness-verdict';

const task: Task = {
  id: 't-02',
  input: 'Додай median у src/metrics.ts і тести.',
  acceptance: ['true'],
  budget: { max_turns: 5, max_usd: 0.1, timeout_s: 30 },
  files: ['src/metrics.ts', 'tests/median.test.ts'],
};

const DIFF = 'diff --git a/src/metrics.ts b/src/metrics.ts\n+export function median() {}\n';

/** Підроблений Gemini: повертає наперед задані тексти відповіді по черзі. */
function fakeGemini(answers: readonly (string | { status: number })[]): { fetchFn: FetchLike; bodies: string[] } {
  const bodies: string[] = [];
  let i = 0;
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (typeof a !== 'string') return { ok: false, status: a?.status ?? 500, text: async () => 'err' };
    const payload = {
      candidates: [{ content: { parts: [{ text: a }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
    };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  return { fetchFn, bodies };
}

const v = (criterion: string, verdict: string) => JSON.stringify({ criterion, verdict, reason: 'бо так', evidence: '' });

describe('agreement (Cohen κ)', () => {
  it('повний збіг → raw 1, κ 1', () => {
    expect(agreement(['pass', 'fail'], ['pass', 'fail'])).toMatchObject({ raw: 1, kappa: 1 });
  });

  it('рахує κ за формулою (p_o − p_e) / (1 − p_e)', () => {
    const a = ['pass', 'pass', 'pass', 'fail'];
    const b = ['pass', 'pass', 'fail', 'fail'];
    // p_o = 3/4; p_e = 0.75·0.5 + 0.25·0.5 = 0.5; κ = 0.25 / 0.5 = 0.5
    const r = agreement(a, b);
    expect(r.raw).toBe(0.75);
    expect(r.expected).toBeCloseTo(0.5);
    expect(r.kappa).toBeCloseTo(0.5);
  });

  it('збіг на рівні випадковості → κ ≈ 0, хоча raw високий', () => {
    const a = ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail'];
    const b = ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'pass'];
    const r = agreement(a, b);
    expect(r.raw).toBe(0.8);
    expect(r.kappa).toBeLessThan(0);
  });

  it('відмовляє на різній довжині і порожньому переліку', () => {
    expect(() => agreement(['pass'], [])).toThrow(RangeError);
    expect(() => agreement([], [])).toThrow(RangeError);
  });
});

describe('схема й брама', () => {
  it('строга схема відкидає зайве поле і чужий вердикт', () => {
    expect(harnessVerdict.safeParse({ criterion: 'V1', verdict: 'pass', reason: 'ок', evidence: '' }).success).toBe(true);
    expect(harnessVerdict.safeParse({ criterion: 'V1', verdict: 'pass', reason: 'ок', evidence: '', score: 9 }).success).toBe(false);
    expect(harnessVerdict.safeParse({ criterion: 'V1', verdict: 'maybe', reason: 'ок', evidence: '' }).success).toBe(false);
  });

  it('брама блокує будь-який не-pass, зокрема unknown', () => {
    const ok = HARNESS_CRITERIA.map((c) => ({ criterion: c.id, verdict: 'pass' as const, reason: 'ок', evidence: '' }));
    expect(blocks(ok)).toBe(false);
    expect(blocks([...ok.slice(1), { ...ok[0]!, verdict: 'unknown' }])).toBe(true);
    expect(blocks([...ok.slice(1), { ...ok[0]!, verdict: 'fail' }])).toBe(true);
    expect(blocks([])).toBe(true);
  });
});

describe('верифікатор', () => {
  it('id задачі з гілки харнесу', () => {
    expect(taskIdFromBranch('harness/t-02-2026-11-02T10-00-00')).toBe('t-02');
    expect(taskIdFromBranch('harness/red-2026-11-02')).toBeNull();
    expect(taskIdFromBranch('main')).toBeNull();
  });

  it('не надсилає diff, що зачіпає .env, і вирізає рядки-секрети', () => {
    expect(() => prepareDiff('+++ b/.env\n+KEY=1\n')).toThrow(/\.env/);
    expect(prepareDiff('+const apiKey = "abc";\n')).toContain('[вилучено: можливий секрет]');
    expect(prepareDiff('')).toMatch(/порожній diff/);
  });

  it('промпт містить один критерій, задачу і дозволені файли', () => {
    const p = buildVerifierPrompt(HARNESS_CRITERIA[1]!, task, DIFF);
    expect(p).toContain('V2');
    expect(p).not.toContain('Критерій V1');
    expect(p).toContain('tests/median.test.ts');
    expect(p).toContain('Дефекти, що стосуються інших критеріїв, ігноруй');
  });

  it('рубрика r2: кожен критерій каже, чого він НЕ оцінює', () => {
    for (const c of HARNESS_CRITERIA) expect(c.rule).toMatch(/НЕ оцінюй тут/);
  });

  it('один критерій — один запит; усі pass → брама відкрита, вартість порахована', async () => {
    const { fetchFn, bodies } = fakeGemini([v('V1', 'pass'), v('V2', 'pass'), v('V3', 'pass'), v('V4', 'pass')]);
    const rep = await verifyArtifact(task, DIFF, { model: 'm', apiKey: 'k', fetchFn });
    expect(bodies).toHaveLength(4);
    expect(bodies.every((b, i) => b.includes(`Критерій V${i + 1}`))).toBe(true);
    expect(rep.blocked).toBe(false);
    expect(rep.usage).toEqual({ inputTokens: 400, outputTokens: 40 });
    expect(rep.costUsd).toBeGreaterThan(0);
  });

  it('один fail → брама закрита', async () => {
    const { fetchFn } = fakeGemini([v('V1', 'pass'), v('V2', 'fail'), v('V3', 'pass'), v('V4', 'pass')]);
    const rep = await verifyArtifact(task, DIFF, { model: 'm', apiKey: 'k', fetchFn });
    expect(rep.blocked).toBe(true);
  });

  it('невалідна відповідь → повтор; відповідь не про той критерій теж невалідна', async () => {
    const { fetchFn, bodies } = fakeGemini(['не json', v('V2', 'pass'), v('V1', 'pass')]);
    const r = await judgeCriterion(HARNESS_CRITERIA[0]!, task, DIFF, { model: 'm', apiKey: 'k', fetchFn });
    expect(bodies).toHaveLength(3);
    expect(r.verdict.verdict).toBe('pass');
  });

  it('503 щоразу → після maxAttempts виняток, вердикт не вгадується', async () => {
    const down = fakeGemini([{ status: 503 }]);
    await expect(
      judgeCriterion(HARNESS_CRITERIA[0]!, task, DIFF, { model: 'm', apiKey: 'k', fetchFn: down.fetchFn, retryDelayMs: 1, maxAttempts: 3 }),
    ).rejects.toThrow(/503/);
    expect(down.bodies).toHaveLength(3);
  });

  it('429 → пауза й повтор; постійно невалідно → виняток', async () => {
    const retry = fakeGemini([{ status: 429 }, v('V1', 'fail')]);
    const r = await judgeCriterion(HARNESS_CRITERIA[0]!, task, DIFF, { model: 'm', apiKey: 'k', fetchFn: retry.fetchFn, retryDelayMs: 1 });
    expect(r.verdict.verdict).toBe('fail');
    const broken = fakeGemini(['{}']);
    await expect(judgeCriterion(HARNESS_CRITERIA[0]!, task, DIFF, { model: 'm', apiKey: 'k', fetchFn: broken.fetchFn })).rejects.toThrow(/V1/);
  });

  it('400 від API → одразу виняток (без вгадування вердикту)', async () => {
    const bad = fakeGemini([{ status: 400 }]);
    await expect(judgeCriterion(HARNESS_CRITERIA[0]!, task, DIFF, { model: 'm', apiKey: 'k', fetchFn: bad.fetchFn })).rejects.toThrow(/400/);
  });
});

describe('калібрування', () => {
  const items: LabeledItem[] = [
    { id: 'c01', task: 't-02', diff: 'x', source: 's', labels: { V1: 'pass', V2: 'pass', V3: 'pass', V4: 'pass' }, why: '' },
    { id: 'c02', task: 't-02', diff: 'x', source: 's', labels: { V1: 'fail', V2: 'pass', V3: 'pass', V4: 'pass' }, why: '' },
  ];
  const rep = (verdicts: string[]): HarnessReport => ({
    task: 't-02',
    model: 'm',
    at: 'now',
    results: HARNESS_CRITERIA.map((c, i) => ({ criterion: c.id, verdict: verdicts[i] as 'pass', reason: 'r', evidence: '' })),
    blocked: verdicts.some((x) => x !== 'pass'),
    usage: { inputTokens: 1, outputTokens: 1 },
    costUsd: 0.001,
  });
  const reports = new Map([
    ['c01', rep(['pass', 'pass', 'pass', 'pass'])],
    ['c02', rep(['pass', 'pass', 'pass', 'pass'])],
  ]);

  it('розгортає артефакти в клітинки людина/модель', () => {
    const cells = toCells(items, reports);
    expect(cells).toHaveLength(8);
    expect(cells.filter((c) => c.human !== c.model)).toEqual([expect.objectContaining({ item: 'c02', criterion: 'V1' })]);
  });

  it('матриця розбіжностей: людина × верифікатор', () => {
    const m = confusionMatrix(toCells(items, reports));
    expect(m[0]).toBe('| людина ↓ / верифікатор → | pass | fail |');
    expect(m).toContain('| **pass** | 7 | 0 |');
    expect(m).toContain('| **fail** | 1 | 0 |');
  });

  it('звіт містить raw, κ і розходження', () => {
    const md = renderComparison(items, reports);
    expect(md).toContain('7/8 = 87.5%');
    expect(md).toContain('κ =');
    expect(md).toContain('c02 V1: людина=fail, верифікатор=pass');
  });
});
