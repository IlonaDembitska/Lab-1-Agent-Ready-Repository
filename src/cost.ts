import { effectivePrice, type IsoDate, type ModelSpec } from './models';

export interface Usage {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export interface MessagesUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

export function fromMessagesUsage(u: MessagesUsage): Usage {
  const cached = u.cache_read_input_tokens ?? 0;

  return {
    inputTokens:
      u.input_tokens +
      cached +
      (u.cache_creation_input_tokens ?? 0),
    cachedTokens: cached,
    outputTokens: u.output_tokens,
  };
}

export interface ChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
}

export function fromChatUsage(u: ChatUsage): Usage {
  return {
    inputTokens: u.prompt_tokens,
    cachedTokens:
      u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens,
  };
}

export interface GeminiUsage {
  readonly promptTokenCount: number;
  readonly candidatesTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}

export function fromGeminiUsage(u: GeminiUsage): Usage {
  return {
    inputTokens: u.promptTokenCount,
    cachedTokens: u.cachedContentTokenCount ?? 0,
    outputTokens:
      (u.candidatesTokenCount ?? 0) +
      (u.thoughtsTokenCount ?? 0),
  };
}

export function errorPct(
  estimated: number,
  actual: number,
): number {
  if (actual <= 0) {
    throw new RangeError(
      'Фактична кількість токенів має бути більшою за нуль',
    );
  }

  return (
    (Math.abs(estimated - actual) / actual) * 100
  );
}

export function withinTolerance(
  estimated: number,
  actual: number,
  maxPct = 10,
): boolean {
  return errorPct(estimated, actual) <= maxPct;
}

export function languageMultiplier(
  uaTokens: number,
  enTokens: number,
): number {
  if (enTokens <= 0) {
    throw new RangeError(
      'Кількість англійських токенів має бути більшою за нуль',
    );
  }

  return uaTokens / enTokens;
}

export function priceUsd(
  spec: ModelSpec,
  usage: Usage,
  at?: IsoDate,
): number {
  const price = effectivePrice(spec, at);

  return (
    (usage.inputTokens / 1_000_000) *
      price.inputPerMTok +
    (usage.outputTokens / 1_000_000) *
      price.outputPerMTok
  );
}

export interface CostRow {
  readonly run: string;
  readonly provider: string;
  readonly model: string;
  readonly usage: Usage;
  readonly estimatedInput?: number;
  readonly actualUsd: number;
  readonly listUsd: number;
  readonly latencyMs: number;
  readonly date: IsoDate;
}

export const COST_TABLE_HEADER = [
  '| прогін | провайдер | модель | вхідні | кешовані | вихідні | оцінка входу до виклику | похибка % | $ фактично | $ за прайсом models.ts | затримка, мс | дата |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
].join('\n');

export function costTableRow(r: CostRow): string {
  const est = r.estimatedInput;

  const cells = [
    r.run,
    r.provider,
    r.model,
    String(r.usage.inputTokens),
    String(r.usage.cachedTokens),
    String(r.usage.outputTokens),
    est === undefined ? '—' : String(est),
    est === undefined
      ? '—'
      : errorPct(est, r.usage.inputTokens).toFixed(1),
    r.actualUsd.toFixed(6),
    r.listUsd.toFixed(6),
    String(Math.round(r.latencyMs)),
    r.date,
  ];

  return `| ${cells.join(' | ')} |`;
}