import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { registerTelemetry } from 'ai';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';

export const langfuseSpanProcessor =
  new LangfuseSpanProcessor();

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const sdk = new NodeSDK({
      spanProcessors: [
        langfuseSpanProcessor,
      ],
    });

    sdk.start();

    registerTelemetry(
      new LangfuseVercelAiSdkIntegration(),
    );
  }
}
