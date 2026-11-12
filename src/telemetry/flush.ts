/**
 * Скидання буфера трейсів ПЕРЕД тим, як Vercel заморозить функцію (Лаб. 4, крок 06).
 * Імпорт процесора з instrumentation.ts у маршрут дає ІНШУ копію модуля — її forceFlush нічого
 * не відправляє. Тому беремо глобальний провайдер (той, що зареєстрував NodeSDK) через API.
 */
import { trace } from '@opentelemetry/api';

type Flushable = { forceFlush?: () => Promise<void> };
type ProxyLike = { getDelegate?: () => unknown };

export async function flushTelemetry(): Promise<void> {
  const p = trace.getTracerProvider() as ProxyLike & Flushable;
  const d = (typeof p.getDelegate === 'function' ? p.getDelegate() : p) as Flushable;
  try {
    await d.forceFlush?.();
  } catch {
    /* телеметрія — best-effort: збій відправки не ламає відповідь */
  }
}
