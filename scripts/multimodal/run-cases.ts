/**
 * Прогін мультимодального набору (Лаб. 4, крок 05) ПРОТИ ЗАДЕПЛОЄНОГО застосунку (або локального).
 *   BASE_URL=https://<preview>.vercel.app npx tsx scripts/multimodal/run-cases.ts
 * Усі перевірки детерміновані: номер сторінки, «не знаю», відмова й її причина, статус 413, схожість round-trip,
 * прогноз токенів проти різниці з текстовою базою. Моделі-судді тут немає — для цих випадків вона не потрібна.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

import { UNKNOWN } from '../../src/multimodal/ask';
import { fileTokenDelta } from '../../src/multimodal/predict';

type Case = {
  id: string;
  file: string;
  mediaType: string;
  ask: string;
  expect: {
    kind: 'answer' | 'unknown' | 'rejected' | 'roundtrip';
    must_contain?: string;
    must_not_contain?: string;
    page?: number;
    tokens_predicted?: number;
    reason?: string;
    min_recall?: number;
  };
  why: string;
};

type Json = Record<string, unknown>;
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(fd: FormData): Promise<{ status: number; ms: number; json: Json | null; raw: string }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/multimodal`, { method: 'POST', body: fd });
  const raw = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(raw) as Json;
  } catch {
    json = null;
  }
  return { status: res.status, ms: Math.round(performance.now() - t0), json, raw: raw.slice(0, 200) };
}

export function pageOf(text: string): number | null {
  const m = /\[\s*стор\.?\s*(\d+)\s*\]/i.exec(text) ?? /сторінк\S*\s+(\d+)/i.exec(text);
  return m?.[1] !== undefined ? Number(m[1]) : null;
}

async function main(): Promise<void> {
  const cases = readFileSync('docs/lab4/multimodal-cases.jsonl', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Case);
  const baselines = new Map<string, number | undefined>();
  const rows: Json[] = [];
  mkdirSync('docs/lab4/traces', { recursive: true });

  for (const c of cases) {
    const fd = new FormData();
    let res: Awaited<ReturnType<typeof post>>;
    if (c.expect.kind === 'roundtrip') {
      fd.set('mode', 'roundtrip');
      fd.set('text', readFileSync(c.file, 'utf8').trim());
      res = await post(fd);
    } else {
      fd.set('mode', 'ask');
      fd.set('question', c.ask);
      fd.set('mediaType', c.mediaType);
      fd.set('file', new Blob([readFileSync(c.file)], { type: c.mediaType }), basename(c.file));
      res = await post(fd);
    }
    const j = res.json ?? {};
    const text = typeof j.text === 'string' ? j.text : '';
    const usage = (j.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
    let pass = false;
    let note = '';
    let base: number | undefined;
    let delta: number | 'не повідомлено' | null = null;

    switch (c.expect.kind) {
      case 'answer': {
        const page = pageOf(text);
        const hasText = c.expect.must_contain === undefined || text.includes(c.expect.must_contain);
        const pageOk = c.expect.page === undefined || page === c.expect.page;
        pass = res.status === 200 && hasText && pageOk && !text.toLowerCase().includes(UNKNOWN);
        note = `сторінка у відповіді: ${page ?? '—'}`;
        if (c.expect.tokens_predicted !== undefined) {
          if (!baselines.has(c.ask)) {
            const b = new FormData();
            b.set('mode', 'baseline');
            b.set('question', c.ask);
            const br = await post(b);
            const bu = ((br.json ?? {}).usage ?? {}) as { inputTokens?: number };
            baselines.set(c.ask, bu.inputTokens);
          }
          base = baselines.get(c.ask);
          delta = fileTokenDelta(usage.inputTokens, base);
          note += ` · прогноз ${c.expect.tokens_predicted}, різниця з базою ${delta}`;
        }
        break;
      }
      case 'unknown':
        pass = res.status === 200 && text.toLowerCase().includes(UNKNOWN) && (c.expect.must_not_contain === undefined || !text.includes(c.expect.must_not_contain));
        note = pass ? 'не вгадала' : 'ВГАДАЛА або не відповіла';
        break;
      case 'rejected': {
        const platform413 = res.status === 413 && res.json === null;
        const ours = j.ok === false && j.reason === c.expect.reason;
        pass = ours || (c.expect.reason === 'size' && platform413);
        note = platform413 ? `платформа: 413 «${res.raw.replace(/\s+/g, ' ').slice(0, 80)}»` : `наш код: ${res.status} ${String(j.reason ?? '')} — ${String(j.detail ?? '')}`;
        break;
      }
      case 'roundtrip': {
        const recall = typeof j.recall === 'number' ? j.recall : 0;
        pass = res.status === 200 && recall >= (c.expect.min_recall ?? 0.8);
        note = `схожість ${recall.toFixed(2)} · «${String(j.transcript ?? j.detail ?? '').slice(0, 120)}» · аудіо ${String(j.audioMediaType ?? '?')} ${String(j.audioBytes ?? '?')} B`;
        break;
      }
    }

    const row = {
      at: new Date().toISOString(),
      base: BASE,
      id: c.id,
      file: c.file,
      expect: c.expect,
      status: res.status,
      pass,
      ms: res.ms,
      text: text.slice(0, 300),
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      baselineInputTokens: base ?? null,
      tokenDelta: delta,
      note,
    };
    rows.push(row);
    appendFileSync('docs/lab4/multimodal-results.jsonl', `${JSON.stringify(row)}\n`);
    writeFileSync(`docs/lab4/traces/multimodal-${c.id}.json`, `${JSON.stringify({ ...row, response: j }, null, 2)}\n`);
    console.log(`${c.id} ${pass ? 'PASS' : 'FAIL'} · HTTP ${res.status} · ${(res.ms / 1000).toFixed(1)} с · ${note}${text !== '' ? ` · «${text.replace(/\s+/g, ' ').slice(0, 90)}»` : ''}`);
    await sleep(4000); // ліміт запитів безкоштовного рівня
  }

  const lat = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
  const mid = lat.length % 2 === 1 ? (lat[(lat.length - 1) / 2] ?? 0) : ((lat[lat.length / 2 - 1] ?? 0) + (lat[lat.length / 2] ?? 0)) / 2;
  console.log(`\nпройдено ${rows.filter((r) => r.pass).length} з ${rows.length} · затримка медіана ${(mid / 1000).toFixed(1)} с, найгірша ${((lat.at(-1) ?? 0) / 1000).toFixed(1)} с · ${BASE}`);
}

if (process.argv[1]?.endsWith('run-cases.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
