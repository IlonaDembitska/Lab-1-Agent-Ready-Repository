/**
 * Дві конфігурації харнесу для аудиту вартості (Лаб. 4, крок 07).
 *   A-cheap-escalate — дешева модель; сильніша лише там, де впали детерміновані брами (status ≠ pass).
 *   B-strong         — одна сильніша модель завжди.
 * Банк задач, бюджети й критерії приймання однакові; змінюється лише вибір моделі.
 * Обидві моделі — безкоштовні моделі OpenCode Zen, тож «вартість» тут — токени, час і квота, а не гроші.
 */
import type { LanguageModelUsage } from 'ai';

import { toTaskCost, type TaskCost } from './cost';
import type { RunRecord } from './run-task';

export const CHEAP = 'opencode/nemotron-3.5-lightning-free';
export const STRONG = 'opencode/big-pickle';

export const CONFIGS = {
  'A-cheap-escalate': [CHEAP, STRONG],
  'B-strong': [STRONG],
} as const satisfies Record<string, readonly string[]>;

export type ConfigName = keyof typeof CONFIGS;

export function isConfig(x: string | undefined): x is ConfigName {
  return x !== undefined && Object.hasOwn(CONFIGS, x);
}

/** Одна спроба однією моделлю: запис прогону + використання, пораховане з подій. */
export interface Attempt {
  readonly rec: RunRecord;
  readonly usage: LanguageModelUsage;
  readonly steps: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly traceId: string | null;
}

export interface ConfigRun {
  readonly attempts: readonly Attempt[];
  readonly final: Attempt;
  readonly escalated: boolean;
}

/** Моделі конфігурації по черзі, поки брами не пройдені. Для B — рівно одна спроба. */
export async function runConfig(config: ConfigName, run: (model: string) => Promise<Attempt>): Promise<ConfigRun> {
  const attempts: Attempt[] = [];
  for (const model of CONFIGS[config]) {
    const a = await run(model);
    attempts.push(a);
    if (a.rec.status === 'pass') break;
  }
  const final = attempts[attempts.length - 1];
  if (final === undefined) throw new Error(`конфігурація ${config} без моделей`);
  return { attempts, final, escalated: attempts.length > 1 };
}

/**
 * Рядок вартості задачі. Підняття коштує токенів ОБОХ спроб: у toTaskCost ідуть усі usage,
 * а час, кроки, виклики й повтори теж сумуються — інакше A виглядає дешевшою за будовою звіту.
 */
export function costOf(taskId: string, config: ConfigName, r: ConfigRun): TaskCost {
  const total = (f: (a: Attempt) => number) => r.attempts.reduce((s, a) => s + f(a), 0);
  return toTaskCost(
    {
      task_id: taskId,
      config,
      model: r.attempts.map((a) => a.rec.model).join(' → '),
      trace_id: r.final.traceId,
      steps: total((a) => a.steps),
      tool_calls: total((a) => a.toolCalls),
      retries: total((a) => a.retries),
      escalated: r.escalated,
      exit_status: r.final.rec.status,
      duration_s: Math.round(total((a) => a.rec.durationMs) / 100) / 10,
      passed: r.final.rec.status === 'pass',
    },
    r.attempts.map((a) => a.usage),
  );
}
