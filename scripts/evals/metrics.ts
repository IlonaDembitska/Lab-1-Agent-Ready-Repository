/**
 * pass@k, pass^k і регресійна брама (Лаб. 3, крок 04). Лише арифметика — покрито тестами.
 * pass@k — хоч одна з k спроб успішна; pass^k — усі k спроб успішні.
 */
export interface EvalLine {
  readonly task_id: string;
  readonly bucket: string;
  readonly frozen_at: string;
  readonly pass: boolean;
}

export interface TaskTally {
  readonly bucket: string;
  readonly frozen_at: string;
  readonly ok: number;
  readonly n: number;
}

export function tally(lines: readonly EvalLine[]): Map<string, TaskTally> {
  const m = new Map<string, TaskTally>();
  for (const l of lines) {
    const c = m.get(l.task_id) ?? { bucket: l.bucket, frozen_at: l.frozen_at, ok: 0, n: 0 };
    m.set(l.task_id, { ...c, ok: c.ok + (l.pass ? 1 : 0), n: c.n + 1 });
  }
  return m;
}

export interface BucketSummary {
  readonly bucket: string;
  readonly tasks: number;
  readonly pass_at_k: number;
  readonly pass_pow_k: number;
}

export function summarize(lines: readonly EvalLine[], k: number): BucketSummary[] {
  const buckets = new Map<string, { tasks: number; at: number; pow: number }>();
  for (const { bucket, ok, n } of tally(lines).values()) {
    const b = buckets.get(bucket) ?? { tasks: 0, at: 0, pow: 0 };
    buckets.set(bucket, { tasks: b.tasks + 1, at: b.at + (ok >= 1 ? 1 : 0), pow: b.pow + (ok === n && n === k ? 1 : 0) });
  }
  const order = ['regression', 'new', 'edge'];
  return [...buckets]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([bucket, b]) => ({
      bucket,
      tasks: b.tasks,
      pass_at_k: Math.round((b.at / b.tasks) * 1000) / 1000,
      pass_pow_k: Math.round((b.pow / b.tasks) * 1000) / 1000,
    }));
}

export type Baseline = Record<string, { pow_k: number; k: number; frozen_at: string; bucket: string }>;

export function toBaseline(lines: readonly EvalLine[], k: number): Baseline {
  const out: Baseline = {};
  for (const [id, c] of tally(lines)) out[id] = { pow_k: c.ok === c.n ? 1 : c.ok / c.n, k, frozen_at: c.frozen_at, bucket: c.bucket };
  return out;
}

export interface GateResult {
  readonly ok: boolean;
  readonly problems: string[];
  readonly checked: number;
}

/**
 * Брама дивиться на конкретні задачі, а не на середнє: задача з кошика regression,
 * що в базовому рівні мала pass^k = 1, мусить мати pass^k = 1 і зараз.
 * Банк мусить бути той самий: один frozen_at у прогоні, і він збігається з базовим рівнем.
 */
export function gate(lines: readonly EvalLine[], base: Baseline): GateResult {
  const now = tally(lines);
  const problems: string[] = [];
  const frozen = new Set([...now.values()].map((c) => c.frozen_at));
  const baseFrozen = new Set(Object.values(base).map((b) => b.frozen_at));
  if (frozen.size !== 1) problems.push(`банк не заморожений: frozen_at у прогоні = ${[...frozen].join(', ')}`);
  else if (baseFrozen.size === 1 && [...frozen][0] !== [...baseFrozen][0]) {
    problems.push(`інший банк: прогін frozen_at ${[...frozen][0]}, базовий рівень ${[...baseFrozen][0]} — потрібен новий базовий рівень`);
  }
  let checked = 0;
  for (const [id, c] of now) {
    if (c.bucket !== 'regression') continue;
    checked += 1;
    const was = base[id]?.pow_k ?? 0;
    if (was === 1 && c.ok < c.n) problems.push(`${id}: було pass^k = 1, стало ${c.ok}/${c.n}`);
  }
  return { ok: problems.length === 0, problems, checked };
}
