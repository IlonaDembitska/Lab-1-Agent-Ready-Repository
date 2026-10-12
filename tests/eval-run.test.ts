import { describe, expect, it } from 'vitest';

import { citedDocs, withContext } from '../scripts/eval-run';

describe('eval-run', () => {
  it('контекст іде перед питанням, питання — останнім рядком', () => {
    const p = withContext('Скільки км/год?', []);
    expect(p.split('\n').at(-1)).toBe('Питання: Скільки км/год?');
    expect(p).toContain('[pdr-12#0001]');
  });
  it('витягує документи з цитат без повторів', () => {
    expect(citedDocs('А [pdr-12#0001], Б [pdr-12#0002], В [pdr-21#0003]')).toEqual(['pdr-12', 'pdr-21']);
  });
});
