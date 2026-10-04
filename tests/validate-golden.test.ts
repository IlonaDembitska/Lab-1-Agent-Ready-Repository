import { describe, expect, it } from 'vitest';

import { validateGolden } from '../scripts/validate-golden';

const LOOSE = { total: 1, unanswerable: 0, injection: 0 };
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const ok = {
  id: 'q-01',
  query: 'Яка максимальна швидкість у житловій зоні?',
  expected: ['20 км/год'],
  must_cite: ['pdr-12'],
  tags: ['easy'],
};

describe('validateGolden', () => {
  it('приймає коректний рядок', () => {
    expect(validateGolden(line(ok), LOOSE)).toEqual([]);
  });

  it('не приймає порожній must_cite поза unanswerable', () => {
    expect(validateGolden(line({ ...ok, must_cite: [] }), LOOSE).join(' ')).toContain('must_cite');
  });

  it('не приймає must_cite у unanswerable', () => {
    const bad = { ...ok, tags: ['unanswerable'] };
    expect(validateGolden(line(bad), LOOSE).join(' ')).toContain('unanswerable не може');
  });

  it('ловить повтор id', () => {
    expect(validateGolden(`${line(ok)}\n${line(ok)}`, LOOSE).join(' ')).toContain('повторюється');
  });

  it('ловить витік відповіді в текст запиту', () => {
    const leaky = {
      ...ok,
      query: 'Чи правда, що у житловій зоні швидкість до 20 км/год?',
      expected: ['швидкість до 20 км/год'],
    };
    expect(validateGolden(line(leaky), LOOSE).join(' ')).toContain('дослівно');
  });

  it('ловить невідомий тег', () => {
    expect(validateGolden(line({ ...ok, tags: ['medium'] }), LOOSE).join(' ')).toContain('tags');
  });

  it('ловить рядок, що не є JSON', () => {
    expect(validateGolden('{не json', LOOSE).join(' ')).toContain('не JSON');
  });

  it('вимагає порогів подання', () => {
    expect(validateGolden(line(ok)).join(' ')).toContain('потрібно ≥ 20');
  });

  it('переживає CRLF і BOM', () => {
    expect(validateGolden(`\uFEFF${line(ok)}\r\n\r\n`, LOOSE)).toEqual([]);
  });
});
