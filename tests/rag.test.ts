import { describe, expect, it } from 'vitest';

import { buildBm25, searchBm25, tokenize } from '../src/rag/bm25';
import { citedIds, validateAnswer } from '../src/rag/cite';
import { fakeEmbedder } from '../src/rag/embed';
import { rrf } from '../src/rag/rrf';
import { bm25From, cosine, hybridSearch } from '../src/rag/search';
import type { IndexedChunk, IndexFile } from '../src/rag/store';

describe('rrf', () => {
  it('той самий розбір, що в методичці', () => {
    const fused = rrf([['A', 'B', 'C'], ['C', 'A', 'D']]);
    expect(fused.map((r) => r.id)).toEqual(['A', 'C', 'B', 'D']);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });
  it('ранги рахуються з одиниці', () => {
    expect(rrf([['A']])[0]?.score).toBeCloseTo(1 / 61, 10);
  });
  it('відсутній у списку документ не додає нічого', () => {
    expect(rrf([['A', 'B'], ['A']]).find((r) => r.id === 'B')?.score).toBeCloseTo(1 / 62, 10);
  });
});

describe('bm25', () => {
  const index = buildBm25([
    { id: 'c-1', text: 'Мопедам поза населеними пунктами — не більше 60 км/год.' },
    { id: 'c-2', text: 'Дальнє світло перемикають на ближнє не менш як за 250 м.' },
    { id: 'c-3', text: 'Зупинка забороняється ближче 30 м від зупинки.' },
  ]);
  it('кирилиця токенізується', () => {
    expect(tokenize('Мопедам поза містом')).toEqual(['мопедам', 'поза', 'містом']);
  });
  it('знаходить фрагмент за точним словом', () => {
    expect(searchBm25(index, 'мопедам')[0]?.id).toBe('c-1');
  });
  it('не повертає фрагментів без жодного слова запиту', () => {
    expect(searchBm25(index, 'космос')).toEqual([]);
  });
});

describe('cosine', () => {
  it('однакові вектори дають 1, ортогональні — 0', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
});

const chunk = (id: string, text: string, vector: number[]): IndexedChunk => ({
  id,
  docId: id.split('#')[0] ?? id,
  heading: '',
  start: 0,
  end: text.length,
  text,
  vector,
});

describe('validateAnswer', () => {
  const served = [chunk('pdr-12#0001', 'текст', [1])];
  it('цитата на виданий фрагмент — зелено', () => {
    expect(validateAnswer('Не більше 70 км/год [pdr-12#0001].', served)).toEqual([]);
  });
  it('немає цитати — помилка', () => {
    expect(validateAnswer('Не більше 70 км/год.', served).join(' ')).toContain('немає жодної цитати');
  });
  it('цитата на невиданий фрагмент — помилка', () => {
    expect(validateAnswer('Див. [pdr-99#0000].', served).join(' ')).toContain('не давали');
  });
  it('витягує id з тексту', () => {
    expect(citedIds('[pdr-12#0001] і [pdr-21#0002]')).toEqual(['pdr-12#0001', 'pdr-21#0002']);
  });
});

describe('hybridSearch (підроблений ембедер, без мережі)', () => {
  it('знаходить фрагмент і повертає ранги обох гілок', async () => {
    const embedder = fakeEmbedder(64);
    const texts = [
      ['m-1#0000', 'мопедам поза населеними пунктами не більше 60 км/год'],
      ['m-2#0000', 'дальнє світло перемикають на ближнє за 250 метрів'],
      ['m-3#0000', 'зупинка заборонена ближче 30 метрів від зупинки'],
    ];
    const vectors = await embedder.embedDocuments(texts.map((t) => t[1] ?? ''));
    const index: IndexFile = {
      version: 1,
      builtAt: '2026-01-01T00:00:00Z',
      embedder: embedder.id,
      dimensions: embedder.dimensions,
      rule: { maxChars: 1200, minChars: 200, overlapChars: 120 },
      normalization: 'test',
      documents: [],
      chunks: texts.map((t, i) => chunk(t[0] ?? '', t[1] ?? '', vectors[i] ?? [])),
    };
    const hits = await hybridSearch(index, bm25From(index), embedder, 'дальнє світло', 2);
    expect(hits[0]?.chunk.id).toBe('m-2#0000');
    expect(hits[0]?.rankWords).toBe(1);
  });
});
