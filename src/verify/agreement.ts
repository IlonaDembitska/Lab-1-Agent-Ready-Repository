/**
 * Узгодженість двох розмітників (Лаб. 3, крок 02): людина проти верифікатора.
 * raw — частка збігів; kappa — Cohen's κ = (p_o − p_e) / (1 − p_e),
 * де p_e — збіг, очікуваний випадково з маргінальних частот кожного розмітника.
 * Cohen J. «A coefficient of agreement for nominal scales», 1960.
 */
export interface Agreement {
  /** Скільки пар порівняли. */
  readonly n: number;
  /** Скільки пар збіглося. */
  readonly agree: number;
  /** p_o — частка збігів. */
  readonly raw: number;
  /** p_e — очікуваний випадковий збіг. */
  readonly expected: number;
  /** Cohen's κ. Якщо p_e = 1 (обидва завжди ставлять ту саму одну мітку), κ = 1 при повному збігу. */
  readonly kappa: number;
}

export function agreement(a: readonly string[], b: readonly string[]): Agreement {
  if (a.length !== b.length) throw new RangeError(`різна кількість міток: ${a.length} і ${b.length}`);
  if (a.length === 0) throw new RangeError('узгодженість не визначена для порожнього переліку');
  const n = a.length;
  const agree = a.filter((x, i) => x === b[i]).length;
  const raw = agree / n;
  const labels = new Set([...a, ...b]);
  let expected = 0;
  for (const l of labels) {
    const pa = a.filter((x) => x === l).length / n;
    const pb = b.filter((x) => x === l).length / n;
    expected += pa * pb;
  }
  const kappa = expected === 1 ? (raw === 1 ? 1 : 0) : (raw - expected) / (1 - expected);
  return { n, agree, raw, expected, kappa };
}

/** Інтерпретація κ за Landis & Koch (1977) — лише як орієнтир, не як поріг якості. */
export function kappaLabel(kappa: number): string {
  if (kappa < 0) return 'гірше за випадковість';
  if (kappa <= 0.2) return 'незначна';
  if (kappa <= 0.4) return 'слабка';
  if (kappa <= 0.6) return 'помірна';
  if (kappa <= 0.8) return 'суттєва';
  return 'майже повна';
}
