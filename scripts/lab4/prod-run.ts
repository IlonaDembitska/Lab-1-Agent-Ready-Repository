/**
 * Прогони проти ЗАДЕПЛОЄНОГО застосунку (Лаб. 4, крок 06) — журнал з trace_id і докази запобіжників.
 *   BASE_URL=https://… [VERCEL_BYPASS=…] npx tsx scripts/lab4/prod-run.ts --label normal --tasks 3
 *   BASE_URL=https://… npx tsx scripts/lab4/prod-run.ts --label flag-off --tasks 1
 * VERCEL_BYPASS — секрет «Protection Bypass for Automation» (заголовок x-vercel-protection-bypass), лише в середовищі.
 * Пише: docs/lab4/prod-runs.jsonl (рядок на запит) і docs/lab4/traces/prod-<label>.json (усе разом).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const headers = (): Record<string, string> => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const b = process.env.VERCEL_BYPASS ?? '';
  if (b !== '') h['x-vercel-protection-bypass'] = b;
  return h;
};

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(), redirect: 'manual', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const raw = await res.text();
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    j = null;
  }
  return { status: res.status, ms: Math.round(performance.now() - t0), json: j, raw: raw.slice(0, 200) };
}

async function main(): Promise<void> {
  const label = arg('--label') ?? 'run';
  const n = Number(arg('--tasks') ?? '1');
  mkdirSync('docs/lab4/traces', { recursive: true });
  const out: Record<string, unknown>[] = [];
  const health = await call('GET', '/api/health');
  const ready = await call('GET', '/api/ready');
  console.log(`health: ${health.status} ${JSON.stringify(health.json)}`);
  console.log(`ready:  ${ready.status} ${JSON.stringify(ready.json)}`);
  for (let i = 0; i < n; i += 1) {
    const taskId = `${label}-${String(i + 1).padStart(2, '0')}`;
    const r = await call('POST', '/api/agent', { taskId, prompt: 'What time is it on the server? Use the tool.' });
    const j = r.json ?? {};
    const row = {
      at: new Date().toISOString(),
      base: BASE,
      label,
      task_id: taskId,
      status: r.status,
      ms: r.ms,
      trace_id: typeof j.trace_id === 'string' ? j.trace_id : null,
      functionId: `task-${taskId}`,
      error: j.error ?? null,
      reason: j.reason ?? null,
      usage: j.usage ?? null,
      counters: j.counters ?? null,
      limits: j.limits ?? null,
      raw: r.json === null ? r.raw : undefined,
    };
    out.push(row);
    appendFileSync('docs/lab4/prod-runs.jsonl', `${JSON.stringify(row)}\n`);
    console.log(`${taskId}: HTTP ${r.status} · ${(r.ms / 1000).toFixed(1)} с · trace_id ${row.trace_id ?? '—'} · ${row.error ?? 'ok'}${row.reason !== null ? ` (${String(row.reason)})` : ''}`);
  }
  writeFileSync(`docs/lab4/traces/prod-${label}.json`, `${JSON.stringify({ at: new Date().toISOString(), base: BASE, health, ready, runs: out }, null, 2)}\n`);
}

if (process.argv[1]?.endsWith('prod-run.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
