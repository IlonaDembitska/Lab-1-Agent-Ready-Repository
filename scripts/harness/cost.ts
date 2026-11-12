/**
 * Аудит вартості прогону (Лаб. 4, крок 07).
 * Правило звіту: поле, якого провайдер НЕ повідомив, — це null («не повідомлено»), а не 0.
 *
 * Виконавець харнесу — CLI OpenCode, тож об'єкта totalUsage від AI SDK у нашому процесі немає.
 * Його еквівалент будуємо з потоку подій: кожна подія step_finish несе tokens ОДНОГО кроку
 * { input, output, reasoning, cache: { read, write }, total }, і сума по ВСІХ кроках = totalUsage прогону.
 * Брати лише останню step_finish — та сама помилка, що usage замість totalUsage.
 * Продуктовий маршрут /api/agent (AI SDK) агрегує result.totalUsage напряму — див. app/api/agent/route.ts.
 */
import type { LanguageModelUsage } from 'ai';

/** null означає «провайдер не повідомив», і це НЕ те саме, що 0. */
export interface TaskCost {
  readonly task_id: string;
  readonly config: string; // 'A-cheap-escalate' | 'B-strong'
  readonly model: string; // модель(і) дослівно; при підняттях — «дешева → сильна»
  readonly trace_id: string | null; // траса останньої спроби (крок 06)
  readonly steps: number;
  readonly tool_calls: number; // події tool_use = спани execute_tool
  readonly retries: number; // рахує харнес: у трасі повторів не видно
  readonly escalated: boolean;
  readonly exit_status: string;
  readonly input_tokens: number | null;
  readonly cache_read: number | null;
  readonly cache_write: number | null;
  readonly output_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly duration_s: number;
  readonly passed: boolean; // детерміновані брами: acceptance + брама обсягу
}

type Measured = 'input_tokens' | 'cache_read' | 'cache_write' | 'output_tokens' | 'reasoning_tokens';

/** null лишається null, поки ЖОДНА спроба цього поля не повідомила. */
function add(a: number | null, v: number | undefined): number | null {
  return v === undefined ? a : (a ?? 0) + v;
}

/**
 * usages — ОДИН totalUsage на звичайну задачу і ДВА на задачу з підняттям моделі:
 * вартість підняття = токени обох спроб, інакше звіт бреше на користь дешевої моделі.
 */
export function toTaskCost(base: Omit<TaskCost, Measured>, usages: readonly LanguageModelUsage[]): TaskCost {
  let r: TaskCost = { ...base, input_tokens: null, cache_read: null, cache_write: null, output_tokens: null, reasoning_tokens: null };
  for (const u of usages) {
    r = {
      ...r,
      input_tokens: add(r.input_tokens, u.inputTokens),
      cache_read: add(r.cache_read, u.inputTokenDetails.cacheReadTokens),
      cache_write: add(r.cache_write, u.inputTokenDetails.cacheWriteTokens),
      output_tokens: add(r.output_tokens, u.outputTokens),
      reasoning_tokens: add(r.reasoning_tokens, u.outputTokenDetails.reasoningTokens),
    };
  }
  return r;
}

/** Зведення: сума окремо, і ОКРЕМО — скількома задачами поле взагалі повідомлене. */
export function summarise(rows: readonly TaskCost[]) {
  const sum = (f: (r: TaskCost) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const reported = (f: (r: TaskCost) => number | null) => rows.filter((r) => f(r) !== null).length;
  const passed = rows.filter((r) => r.passed).length;
  const outputs = sum((r) => r.output_tokens);
  const inputs = sum((r) => r.input_tokens);
  return {
    tasks: rows.length,
    passed,
    pass_share: rows.length === 0 ? 0 : passed / rows.length,
    input_tokens: inputs,
    input_reported: `${reported((r) => r.input_tokens)}/${rows.length}`,
    cache_read: sum((r) => r.cache_read),
    cache_read_reported: `${reported((r) => r.cache_read)}/${rows.length}`,
    cache_write: sum((r) => r.cache_write),
    cache_write_reported: `${reported((r) => r.cache_write)}/${rows.length}`,
    output_tokens: outputs,
    output_reported: `${reported((r) => r.output_tokens)}/${rows.length}`,
    reasoning_tokens: sum((r) => r.reasoning_tokens),
    reasoning_reported: `${reported((r) => r.reasoning_tokens)}/${rows.length}`,
    tool_calls: rows.reduce((a, r) => a + r.tool_calls, 0),
    retries: rows.reduce((a, r) => a + r.retries, 0),
    escalations: rows.filter((r) => r.escalated).length,
    duration_s: sum((r) => r.duration_s),
    // головне число порівняння: ціна ОДНІЄЇ пройденої задачі
    tokens_per_passed: passed === 0 ? null : Math.round((inputs + outputs) / passed),
  };
}

interface StepTokens {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly reasoning?: unknown;
  readonly total?: unknown;
  readonly cache?: { readonly read?: unknown; readonly write?: unknown };
}

export interface RunUsage {
  /** Еквівалент totalUsage: сума по всіх кроках прогону. */
  readonly usage: LanguageModelUsage;
  readonly steps: number;
  readonly toolCalls: number;
  readonly retries: number;
  /** Механічна перевірка: сума полів total по кроках мусить дорівнювати вхід + вихід. */
  readonly totalMismatch: boolean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const acc = (a: number | undefined, v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? a : (a ?? 0) + n;
};
const both = (a: number | undefined, b: number | undefined, c?: number): number | undefined =>
  a === undefined && b === undefined && c === undefined ? undefined : (a ?? 0) + (b ?? 0) + (c ?? 0);

/**
 * Рядки agent.log (OpenCode --format json) → використання прогону.
 * У OpenCode tokens.input — лише НЕкешований вхід; читання й запис кешу йдуть окремо, тому
 * inputTokens = input + cache.read + cache.write. tokens.output — лише текст; reasoning окремо,
 * а білиться як вихід, тому outputTokens = output + reasoning.
 * Повтори: OpenCode пише їх як подію/рядок stderr із «retry» — рахуємо тут, бо в трасі їх не видно.
 */
export function usageFromEvents(lines: readonly string[]): RunUsage {
  let noCache: number | undefined;
  let cacheRead: number | undefined;
  let cacheWrite: number | undefined;
  let text: number | undefined;
  let reasoning: number | undefined;
  let total: number | undefined;
  let steps = 0;
  let toolCalls = 0;
  let retries = 0;
  for (const line of lines) {
    if (line.startsWith('[stderr]')) {
      if (/retry/i.test(line)) retries += 1;
      continue;
    }
    if (!line.startsWith('{')) continue;
    let e: { type?: unknown; part?: { tokens?: StepTokens } };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    const type = typeof e.type === 'string' ? e.type : '';
    if (type === 'step_start') steps += 1;
    else if (type === 'tool_use') toolCalls += 1;
    else if (/retry/i.test(type)) retries += 1;
    else if (type === 'step_finish') {
      const t = e.part?.tokens;
      if (t === undefined) continue;
      noCache = acc(noCache, t.input);
      cacheRead = acc(cacheRead, t.cache?.read);
      cacheWrite = acc(cacheWrite, t.cache?.write);
      text = acc(text, t.output);
      reasoning = acc(reasoning, t.reasoning);
      total = acc(total, t.total);
    }
  }
  const inputTokens = both(noCache, cacheRead, cacheWrite);
  const outputTokens = both(text, reasoning);
  const computed = both(inputTokens, outputTokens);
  return {
    usage: {
      inputTokens,
      inputTokenDetails: { noCacheTokens: noCache, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite },
      outputTokens,
      outputTokenDetails: { textTokens: text, reasoningTokens: reasoning },
      totalTokens: total ?? computed,
    },
    steps,
    toolCalls,
    retries,
    totalMismatch: total !== undefined && computed !== undefined && total !== computed,
  };
}
