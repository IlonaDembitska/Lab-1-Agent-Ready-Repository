/**
 * БЮДЖЕТ мультиагентного питання (Лаб. 4, крок 03): кроки, ходи, токени, час — плюс гілки.
 * У грошах межі тут немає: гілки йдуть на безкоштовний рівень Gemini, верифікатор — на
 * локальну Ollama, тож сума в доларах завжди нуль.
 */
export type Budget = {
  /** Скільки гілок ЧИТАННЯ дозволено в одному раунді. */
  readonly maxBranches: number;
  /** ХОДИ: скільки generateText / викликів верифікатора дозволено на все питання (гілки + звід + верифікатор). */
  readonly maxTurns: number;
  /** КРОКИ: isStepCount(N) у stopWhen кожної гілки. */
  readonly stepsPerBranch: number;
  /** ТОКЕНИ: стеля на все питання — входи + виходи всіх гілок, зводу й верифікатора. */
  readonly tokenCeiling: number;
  /** ЧАС: стеля на все питання, мілісекунди. */
  readonly wallClockMs: number;
};

/** Значення за замовчуванням; обґрунтування кожного числа — docs/lab4/multiagent.md, розділ «Бюджет». */
export const DEFAULT_BUDGET: Budget = {
  maxBranches: 4,
  // 4 гілки + 1 звід + до 5 тверджень у верифікатора = 10; +2 запасу на баг підрахунку.
  maxTurns: 12,
  stepsPerBranch: 4,
  // одна гілка Gemini з інструментами — ~5–15 тис. токенів; запас на один раунд.
  tokenCeiling: 150_000,
  wallClockMs: 240_000,
};

/**
 * Структурний тип: лише ті поля, які читаємо. У звіті AI SDK 7 вони number | undefined —
 * провайдер може не повідомити жодного.
 */
export type Usage = {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
};

export type Spent = {
  /** ХОДИ: скільки generateText / викликів верифікатора зроблено (разом з упалими). */
  readonly calls: number;
  /** HTTP-запитів до моделі: у гілці з інструментами один хід = кілька кроків = кілька запитів. Саме це вичерпує квоту. */
  readonly modelRequests: number;
  readonly input: number;
  readonly output: number;
  /** Скільком ходам провайдер токенів НЕ повідомив. У звіт — як «не повідомлено». */
  readonly unreported: number;
  /** СУМА часу по ходах — час обчислення, а НЕ час до відповіді (той міряється окремо, wallMs). */
  readonly ms: number;
};

export const empty = (): Spent => ({ calls: 0, modelRequests: 0, input: 0, output: 0, unreported: 0, ms: 0 });

export function add(s: Spent, u: Usage, ms: number, requests = 1): Spent {
  const known = u.inputTokens !== undefined || u.outputTokens !== undefined;
  return {
    calls: s.calls + 1,
    modelRequests: s.modelRequests + requests,
    input: s.input + (u.inputTokens ?? 0),
    output: s.output + (u.outputTokens ?? 0),
    unreported: s.unreported + (known ? 0 : 1),
    ms: s.ms + ms,
  };
}

/** Гілка, що впала або була скасована, токени вже витратила — просто не звітує. Ховати цей хід не можна. */
export function addLost(s: Spent, ms: number): Spent {
  return { ...s, calls: s.calls + 1, modelRequests: s.modelRequests + 1, unreported: s.unreported + 1, ms: s.ms + ms };
}

export const tokensUsed = (s: Spent): number => s.input + s.output;

export type Stop = 'none' | 'token-ceiling' | 'turn-budget' | 'wall-clock' | 'quota-429';

/**
 * Перевірка меж. Викликається ПЕРЕД раундом (next = скільки ходів раунд збирається витратити)
 * і на fan-in (next = 0) — інакше при одному раунді стеля токенів не спрацює ніколи.
 */
export function overBudget(spent: Spent, budget: Budget, next: number, aborted: boolean): Stop {
  if (spent.calls + next > budget.maxTurns) return 'turn-budget';
  if (tokensUsed(spent) >= budget.tokenCeiling) return 'token-ceiling';
  if (aborted) return 'wall-clock';
  return 'none';
}
