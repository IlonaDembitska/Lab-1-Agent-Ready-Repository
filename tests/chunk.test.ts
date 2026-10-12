import { describe, expect, it } from 'vitest';

import { chunkDocument, normalize, RULE } from '../src/rag/chunk';

const doc = `# Інструкція\n\n## Розділ 1\n${'А'.repeat(900)}\n\n${'Б'.repeat(900)}\n\n## Розділ 2\nКоротко.\n`;

describe('chunkDocument', () => {
  it('тримає інваріант зсувів', () => {
    const text = normalize(doc);
    for (const c of chunkDocument('doc-01', doc)) {
      expect(c.text).toBe(text.slice(c.start, c.end));
    }
  });

  it('не перевищує максимум', () => {
    for (const c of chunkDocument('doc-01', doc)) {
      expect(c.end - c.start).toBeLessThanOrEqual(RULE.maxChars);
    }
  });

  it('веде шлях заголовків', () => {
    const headings = chunkDocument('doc-01', doc).map((c) => c.heading);
    expect(headings).toContain('Інструкція › Розділ 1');
    expect(headings).toContain('Інструкція › Розділ 2');
  });

  it('детермінований: ті самі id на тому самому вході', () => {
    const a = chunkDocument('doc-01', doc).map((c) => c.id);
    const b = chunkDocument('doc-01', doc).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
