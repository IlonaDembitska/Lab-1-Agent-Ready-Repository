/**
 * Трасування Langfuse для скриптів (поза Next.js) — та сама схема, що в instrumentation.node.ts.
 * Вмикається лише тоді, коли є ключі Langfuse (тобто в тестах і CI його немає).
 * Повертає функцію, яку треба викликати в кінці: вона дочікується відправлення трас.
 */
export async function startTracing(): Promise<() => Promise<void>> {
  if (process.env.LANGFUSE_PUBLIC_KEY === undefined || process.env.LANGFUSE_PUBLIC_KEY === '') {
    return async () => {};
  }
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { registerTelemetry } = await import('ai');
  const { LangfuseVercelAiSdkIntegration } = await import('@langfuse/vercel-ai-sdk');
  const { langfuseSpanProcessor } = await import('./langfuse');
  const sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
  sdk.start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  return async () => {
    await langfuseSpanProcessor.forceFlush();
    await sdk.shutdown();
  };
}
