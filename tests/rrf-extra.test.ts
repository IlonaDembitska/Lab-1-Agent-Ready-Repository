import { describe, expect, it } from 'vitest';

import { rrf } from '../src/rag/rrf';

describe('rrf extra', () => {
  it('порожній вхід повертає порожній масив', () => {
    expect(rrf([])).toEqual([]);
  });
  it('для одного списку порядок id зберігається', () => {
    expect(rrf([['A', 'B', 'C']]).map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });
});
