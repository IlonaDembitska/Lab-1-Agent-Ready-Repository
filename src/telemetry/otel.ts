/**
 * Експорт трас у Langfuse через OTLP/HTTP (Лаб. 3, крок 06).
 * Ендпоїнт і заголовки — з OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS; якщо їх немає,
 * збираються з ключів Langfuse з Лаб. 2 (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL).
 * Ключі живуть лише в середовищі (.env), у репозиторій не потрапляють.
 * Без ключів трасування вимкнене (тести, CI) — харнес працює як раніше, trace_id = null.
 */
export interface Telemetry {
  readonly enabled: boolean;
  /** Дочекатися відправлення всіх спанів і зупинити SDK. */
  shutdown(): Promise<void>;
}

/** Рядок заголовків OTLP для Langfuse: Basic-авторизація + версія ingestion для реального часу. */
export function langfuseOtlpEnv(env: Readonly<Record<string, string | undefined>>): { endpoint: string; headers: string } | null {
  const pk = env.LANGFUSE_PUBLIC_KEY ?? '';
  const sk = env.LANGFUSE_SECRET_KEY ?? '';
  if (pk === '' || sk === '') return null;
  const base = (env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/+$/, '');
  const auth = Buffer.from(`${pk}:${sk}`, 'utf8').toString('base64');
  return {
    endpoint: `${base}/api/public/otel`,
    // x-langfuse-ingestion-version=4 — без нього спани можуть затриматися («в Langfuse нічого немає»).
    headers: `Authorization=Basic ${auth},x-langfuse-ingestion-version=4`,
  };
}

export async function startHarnessTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<Telemetry> {
  if ((env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '') === '') {
    const lf = langfuseOtlpEnv(env);
    if (lf === null) return { enabled: false, shutdown: async () => undefined };
    env.OTEL_EXPORTER_OTLP_ENDPOINT = lf.endpoint;
    env.OTEL_EXPORTER_OTLP_HEADERS = lf.headers;
  }
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { registerTelemetry } = await import('ai');
  const { OpenTelemetry } = await import('@ai-sdk/otel');
  // HTTP, не gRPC: Langfuse gRPC не приймає.
  const sdk = new NodeSDK({ serviceName: 'lab3-harness', traceExporter: new OTLPTraceExporter() });
  sdk.start();
  // Інтеграція за конвенціями GenAI (не Legacy) — для викликів AI SDK, якщо вони з'являться в харнесі.
  registerTelemetry(new OpenTelemetry());
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
