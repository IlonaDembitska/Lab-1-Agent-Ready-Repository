/**
 * Circuit breaker черги (Лаб. 3, крок 03).
 * Рахує поспіль невдалі прогони (усе, що не pass: fail, agent_error, max_turns, max_usd, timeout).
 * Щойно лічильник досяг порогу — запобіжник «розмикається» (open): решту черги не запускаємо,
 * щоб не палити час і бюджет, коли зламане щось спільне (модель, ключ, мережа, репозиторій).
 * Один pass обнуляє лічильник. Розімкнений запобіжник сам не замикається — потрібна людина.
 */
import type { Status } from './run-task';

export type BreakerState = 'closed' | 'open';

export interface BreakerSnapshot {
  readonly threshold: number;
  readonly state: BreakerState;
  /** Скільки невдач поспіль зараз. */
  readonly consecutiveFailures: number;
  /** id задачі, після якої запобіжник розімкнувся (null — не розмикався). */
  readonly openedAfter: string | null;
  /** Статуси, що привели до розмикання, по порядку. */
  readonly trippedBy: readonly Status[];
}

export class CircuitBreaker {
  private consecutive: Status[] = [];
  private openedAfter: string | null = null;

  constructor(readonly threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) throw new RangeError('поріг circuit breaker — ціле ≥ 1');
  }

  get state(): BreakerState {
    return this.openedAfter === null ? 'closed' : 'open';
  }

  /** Запускати наступну задачу можна лише при замкненому запобіжнику. */
  allows(): boolean {
    return this.state === 'closed';
  }

  record(taskId: string, status: Status): BreakerState {
    if (this.state === 'open') return 'open';
    if (status === 'pass') {
      this.consecutive = [];
      return 'closed';
    }
    this.consecutive.push(status);
    if (this.consecutive.length >= this.threshold) this.openedAfter = taskId;
    return this.state;
  }

  snapshot(): BreakerSnapshot {
    return {
      threshold: this.threshold,
      state: this.state,
      consecutiveFailures: this.consecutive.length,
      openedAfter: this.openedAfter,
      trippedBy: this.state === 'open' ? [...this.consecutive] : [],
    };
  }
}
