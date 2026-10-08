import { describe, expect, it } from 'vitest';

import { buildPrompt, extractJson, parseCriteria, redactDiff } from '../scripts/verify';
import { criterionVerdict, isBlocked } from '../src/verify/schema';

const SPEC = [
  '## 6. Критерії приймання',
  '| # | Критерій | Чим перевіряється |',
  '|---|---|---|',
  '| A1 | npm test зелений | прогін CI |',
  '| A2 | ≥ 20 запитів | валідатор |',
  '',
  '### Правило оцінювання відповіді',
  '| A9 | не критерій | — |',
  '## 7. Обмеження',
].join('\n');

describe('parseCriteria', () => {
  it('бере рядки A* лише з розділу 6 до підрозділу', () => {
    expect(parseCriteria(SPEC).map((c) => c.id)).toEqual(['A1', 'A2']);
  });
  it('порожньо, якщо розділу 6 немає', () => {
    expect(parseCriteria('# інше')).toEqual([]);
  });
});

describe('extractJson', () => {
  it('ігнорує блок <think> і зайвий текст', () => {
    const raw = '<think>міркую</think> ось: {"id":"A1","verdict":"pass","reason":"ок","evidence":"x"} кінець';
    expect(extractJson(raw)).toMatchObject({ verdict: 'pass' });
  });
  it('повертає null для не-JSON', () => {
    expect(extractJson('немає json')).toBeNull();
  });
});

describe('redactDiff', () => {
  it('вирізає рядки з ключами', () => {
    const { text } = redactDiff('+GEMINI_API_KEY=abc123\n+нормальний рядок');
    expect(text).not.toContain('abc123');
    expect(text).toContain('нормальний рядок');
  });
  it('помічає зміни .env, але не .env.example', () => {
    expect(redactDiff('+++ b/.env.local').touchesEnv).toBe(true);
    expect(redactDiff('+++ b/.env.example').touchesEnv).toBe(false);
  });
});

describe('схема й брама', () => {
  it('строга схема не приймає зайвих полів і чужих вердиктів', () => {
    expect(criterionVerdict.safeParse({ id: 'A1', verdict: 'maybe', reason: 'r', evidence: '' }).success).toBe(false);
    expect(criterionVerdict.safeParse({ id: 'A1', verdict: 'pass', reason: 'r', evidence: '', x: 1 }).success).toBe(false);
  });
  it('брама червона лише за наявності fail', () => {
    const r = (v: 'pass' | 'fail' | 'unknown') => ({ id: 'A1', verdict: v, reason: 'r', evidence: '' });
    expect(isBlocked({ results: [r('pass'), r('unknown')] })).toBe(false);
    expect(isBlocked({ results: [r('pass'), r('fail')] })).toBe(true);
  });
  it('промпт містить рівно один критерій і варіант unknown', () => {
    const p = buildPrompt({ id: 'A3', text: 'індексація', check: 'команда' }, 'diff');
    expect(p).toContain('Критерій A3');
    expect(p).toContain('unknown');
  });
});
