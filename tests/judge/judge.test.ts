import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../scripts/judge/artifact';
import { confusion, renderReport, report } from '../../scripts/judge/calibrate';
import { askJudge, buildJudgePrompt } from '../../scripts/judge/run-judge';
import type { FetchLike } from '../../scripts/harness/verifier';

const artifact = {
  dir: 'docs/lab3/runs/x',
  task: { id: 't-01', input: 'додай тест', acceptance: ['npx vitest run a.test.ts'], budget: { max_turns: 1, max_usd: 0, timeout_s: 1 }, files: ['a.test.ts'] },
  status: 'timeout',
  checks: [],
  changedFiles: [],
  patch: '',
  output: '',
};

describe('калібрування судді', () => {
  it('матриця 3×3: рядок — мій, стовпець — суддя', () => {
    const m = confusion(['pass', 'fail', 'fail', 'unknown'], ['pass', 'pass', 'fail', 'fail']);
    expect(m.fail.pass).toBe(1);
    expect(m.fail.fail).toBe(1);
    expect(m.unknown.fail).toBe(1);
    expect(m.pass.pass).toBe(1);
  });

  it('каппа не визначена, коли всі мітки однакові', () => {
    const r = report('усі', [{ mine: 'pass', judge: 'pass' }, { mine: 'pass', judge: 'pass' }]);
    expect(r?.kappa).toBeNull();
    expect(renderReport(r!)[0]).toContain('не визначена');
  });

  it('звіт окремо називає «пропускає погане» і «марна робота»', () => {
    const r = report('робочі', [
      { mine: 'fail', judge: 'pass' },
      { mine: 'pass', judge: 'fail' },
      { mine: 'pass', judge: 'pass' },
      { mine: 'unknown', judge: 'unknown' },
    ]);
    const text = renderReport(r!).join('\n');
    expect(text).toContain('пропускає погане (мій fail → суддя pass): **1**');
    expect(text).toContain('марна робота (мій pass → суддя fail): **1**');
    expect(r!.raw).toBe(0.5);
  });

  it('промпт: один вимір, рубрика і «НЕ ЗАПУСКАЛИСЬ» для зупиненого прогону', () => {
    const p = buildJudgePrompt('acceptance_met', { question: 'q?', pass: 'P', fail: 'F', unknown: 'U' }, artifact);
    expect(p).toContain('Вимір «acceptance_met»');
    expect(p).toContain('НЕ ЗАПУСКАЛИСЬ');
    expect(p).toContain('- unknown — U');
  });

  it('суддя: строга схема, повтор після невалідної відповіді, версія моделі з відповіді', async () => {
    const answers = ['не json', JSON.stringify({ verdict: 'unknown', reason: 'перевірки не запускались' })];
    let i = 0;
    const fetchFn: FetchLike = async () => {
      const text = answers[Math.min(i++, answers.length - 1)];
      return { ok: true, status: 200, text: async () => JSON.stringify({ modelVersion: 'gemini-x-001', candidates: [{ content: { parts: [{ text }] } }] }) };
    };
    const v = await askJudge('p', { model: 'm', apiKey: 'k', fetchFn });
    expect(v).toEqual({ verdict: 'unknown', reason: 'перевірки не запускались', modelVersion: 'gemini-x-001' });
  });

  it('прибирає кольорові коди терміналу', () => {
    expect(stripAnsi(`${String.fromCharCode(27)}[32m✓${String.fromCharCode(27)}[39m ok`)).toBe('✓ ok');
  });
});
