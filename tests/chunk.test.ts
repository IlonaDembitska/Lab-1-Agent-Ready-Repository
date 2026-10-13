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

describe('правило v2: межа перед новим пунктом ПДР', () => {
  const doc = `${'А'.repeat(500)}\n\n12.1. ${'Б'.repeat(300)}:\n\nа) ${'В'.repeat(300)}\n\nб) ${'Г'.repeat(300)}\n\n12.2. ${'Д'.repeat(200)}\n`;
  it('пункт разом із підпунктами потрапляє в один фрагмент', () => {
    const chunks = chunkDocument('doc-01', doc);
    expect(chunks.some((c) => c.text.includes('12.1.') && c.text.includes('б)'))).toBe(true);
  });
  it('інваріант зсувів тримається', () => {
    const text = normalize(doc);
    for (const c of chunkDocument('doc-01', doc)) expect(c.text).toBe(text.slice(c.start, c.end));
  });
});
