/**
 * Розгалуження читання (Лаб. 4, крок 03): раунди гілок на Promise.allSettled, AbortController
 * на стелю часу, перевірка меж ПЕРЕД раундом і на fan-in, окремий час до відповіді (wallMs),
 * власне ім'я кожної гілки в трасі (functionId = <питання>/<смуга>).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { generateText, isStepCount, type LanguageModel, type ToolSet } from 'ai';

import { add, addLost, empty, overBudget, type Budget, type Spent, type Stop, type Usage } from './budget';

export type Branch = { readonly lane: string; readonly prompt: string };
export type BranchOut = { readonly lane: string; readonly text: string; readonly steps: number; readonly ms: number };
export type LaneTrace = {
  readonly lane: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly steps: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error?: string;
};

/** Один хід гілки. Інʼєкція потрібна для тестів без мережі; у прогоні — справжній generateText. */
export type GenerateFn = (args: {
  readonly model: LanguageModel;
  readonly system: string;
  readonly prompt: string;
  readonly tools: ToolSet;
  readonly steps: number;
  readonly signal: AbortSignal;
  readonly functionId: string;
}) => Promise<{ text: string; usage: Usage; steps: number }>;

export const realGenerate: GenerateFn = async (a) => {
  const r = await generateText({
    model: a.model,
    system: a.system,
    prompt: a.prompt,
    tools: a.tools,
    temperature: 0,
    // УВАГА: спрацювання isStepCount тут МОВЧАЗНЕ — кількість кроків видно лише в steps.
    stopWhen: isStepCount(a.steps),
    abortSignal: a.signal,
    // 429 безкоштовного рівня: SDK повторює з паузою, що подвоюється; після вичерпання — помилка і брейкер.
    maxRetries: 4,
    experimental_telemetry: {
      isEnabled: process.env.LANGFUSE_PUBLIC_KEY !== undefined && process.env.LANGFUSE_PUBLIC_KEY !== '',
      functionId: a.functionId, // → gen_ai.agent.name / назва спану
      recordInputs: false, // вмісту запитів і відповідей у трасі немає
      recordOutputs: false,
    },
  });
  return { text: r.text, usage: r.totalUsage, steps: r.steps.length };
};

/** Відмова за квотою: її бачить брейкер прогону, а не лише ця гілка. */
export function isQuotaError(message: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message);
}

export const STOP_LOG = 'docs/lab4/traces/budget-stop.jsonl';

export function logStop(taskId: string, limit: Stop, round: number, spent: Spent, file = STOP_LOG): void {
  mkdirSync('docs/lab4/traces', { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), taskId, limit, round, spent })}\n`);
}

export type FanOutResult = {
  readonly out: BranchOut[];
  readonly spent: Spent;
  readonly wallMs: number;
  readonly stop: Stop;
  readonly stopRound: number | null;
  readonly failed: string[];
  readonly lanes: LaneTrace[];
};

export async function fanOut(opts: {
  readonly model: LanguageModel;
  readonly system: string;
  readonly readOnlyTools: ToolSet; // ЛИШЕ читальні — див. reader-tools.ts
  readonly rounds: readonly (readonly Branch[])[];
  readonly budget: Budget;
  readonly taskId: string;
  readonly generate?: GenerateFn;
  readonly stopLog?: string;
  /** Уже витрачене до цього виклику (багатораундове дослідження): межі рахуються від нього. */
  readonly initial?: Spent;
}): Promise<FanOutResult> {
  const { budget } = opts;
  const generate = opts.generate ?? realGenerate;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), budget.wallClockMs);
  const wall0 = performance.now(); // ЧАС ДО ВІДПОВІДІ — лише звідси

  let spent = opts.initial ?? empty();
  const out: BranchOut[] = [];
  const failed: string[] = [];
  const lanes: LaneTrace[] = [];
  let stop: Stop = 'none';
  let stopRound: number | null = null;

  try {
    for (const [i, round] of opts.rounds.entries()) {
      if (round.length > budget.maxBranches) {
        throw new Error(`раунд ${i}: гілок ${round.length}, межа maxBranches ${budget.maxBranches}`);
      }
      // ПЕРША перевірка — перед раундом.
      stop = overBudget(spent, budget, round.length, ac.signal.aborted);
      if (stop !== 'none') {
        stopRound = i;
        logStop(opts.taskId, stop, i, spent, opts.stopLog);
        break;
      }

      const settled = await Promise.allSettled(
        round.map(async (b) => {
          const t0 = performance.now();
          try {
            const r = await generate({
              model: opts.model,
              system: opts.system,
              prompt: b.prompt,
              tools: opts.readOnlyTools,
              steps: budget.stepsPerBranch,
              signal: ac.signal,
              functionId: `${opts.taskId}/${b.lane}`,
            });
            return { ok: true as const, lane: b.lane, r, ms: performance.now() - t0 };
          } catch (err) {
            // скасована або впала гілка теж списала хід із квоти
            return { ok: false as const, lane: b.lane, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      for (const [j, s] of settled.entries()) {
        const laneName = round[j]?.lane ?? `?${j}`;
        if (s.status !== 'fulfilled') {
          failed.push(laneName);
          spent = addLost(spent, 0);
          lanes.push({ lane: laneName, ok: false, ms: 0, steps: 0, inputTokens: null, outputTokens: null, error: 'rejected' });
          continue;
        }
        const v = s.value;
        if (v.ok) {
          spent = add(spent, v.r.usage, v.ms, Math.max(1, v.r.steps));
          out.push({ lane: v.lane, text: v.r.text, steps: v.r.steps, ms: Math.round(v.ms) });
          lanes.push({
            lane: v.lane,
            ok: true,
            ms: Math.round(v.ms),
            steps: v.r.steps,
            inputTokens: v.r.usage.inputTokens ?? null,
            outputTokens: v.r.usage.outputTokens ?? null,
          });
        } else {
          failed.push(v.lane); // звід мусить побачити, чого немає
          spent = addLost(spent, v.ms);
          lanes.push({ lane: v.lane, ok: false, ms: Math.round(v.ms), steps: 0, inputTokens: null, outputTokens: null, error: v.error.slice(0, 200) });
        }
      }

      // Брейкер квоти: 429 — не «гілка не вдалася», а сигнал зупинити весь прогін.
      if (lanes.some((l) => !l.ok && l.error !== undefined && isQuotaError(l.error))) {
        stop = 'quota-429';
        stopRound = i;
        logStop(opts.taskId, stop, i, spent, opts.stopLog);
        break;
      }

      // ДРУГА перевірка — на fan-in: межі видно ще до того, як почнеться звід.
      stop = overBudget(spent, budget, 0, ac.signal.aborted);
      if (stop !== 'none') {
        stopRound = i;
        logStop(opts.taskId, stop, i, spent, opts.stopLog);
        break;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return { out, spent, wallMs: Math.round(performance.now() - wall0), stop, stopRound, failed, lanes };
}
