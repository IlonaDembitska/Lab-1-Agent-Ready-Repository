import { unquoteEnv } from './src/telemetry/env';
/**
 * Телеметрія як частина застосунку (Лаб. 4, крок 06). Next.js викликає register() один раз на старті інстансу.
 * Спани AI SDK 7 дає ОКРЕМИЙ пакет @ai-sdk/otel (конвенції GenAI: invoke_agent → chat → execute_tool).
 * Експорт — OTLP/HTTP у Langfuse (gRPC Langfuse не приймає); ендпойнт і заголовки будуються зі змінних
 * середовища LANGFUSE_* (тип Secret на Vercel), у коді їх немає. Без ключів — NoopSpanProcessor (тести, CI).
 * Маршрути викликають langfuseSpanProcessor.forceFlush() в after(): на платформі процес функції
 * завершується разом із відповіддю, і буфер спанів загинув би з ним.
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { registerTelemetry } from 'ai';

import { langfuseOtlpEnv } from './src/telemetry/otel';

function headersFrom(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
}

const cfg = langfuseOtlpEnv(unquoteEnv(process.env));

/** Ім'я лишилось з Лаб. 2, щоб не чіпати імпорти маршрутів; тепер це BatchSpanProcessor з OTLP/HTTP-експортером. */
export const langfuseSpanProcessor: tracing.SpanProcessor =
  cfg === null
    ? new tracing.NoopSpanProcessor()
    : new tracing.BatchSpanProcessor(new OTLPTraceExporter({ url: `${cfg.endpoint}/v1/traces`, headers: headersFrom(cfg.headers) }));

export const telemetryEnabled = cfg !== null;

let started = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || started) return;
  started = true;
  const sdk = new NodeSDK({ serviceName: 'lab4-app', spanProcessors: [langfuseSpanProcessor] });
  sdk.start();
  // Інтеграція за конвенціями GenAI (не LegacyOpenTelemetry). Один раз на старті.
  registerTelemetry(new OpenTelemetry());
}
