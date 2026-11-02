import { describe, expect, it } from 'vitest';

import { validateAnswer } from '../src/rag/cite';
import type { IndexedChunk } from '../src/rag/store';

const chunk = (id: string, text: string): IndexedChunk => ({
  id,
  docId: id.split('#')[0] ?? id,
  heading: '',
  start: 0,
  end: text.length,
  text,
  vector: [1],
});

describe('validateAnswer: додаткові випадки', () => {
  const served = [chunk('pdr-12#0001', 'текст')];

  it('відповідь без жодної цитати повертає непорожній перелік проблем', () => {
    const problems = validateAnswer('Не більше 70 км/год.', served);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('немає жодної цитати');
  });

  it('цитата на id, якого немає серед виданих фрагментів, дає проблему', () => {
    const problems = validateAnswer('Див. [pdr-99#0000].', served);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('pdr-99#0000');
    expect(problems.join(' ')).toContain('не давали');
  });
});
