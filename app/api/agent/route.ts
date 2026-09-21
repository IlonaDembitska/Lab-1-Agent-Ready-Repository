import { google } from '@ai-sdk/google';
import {
  ToolLoopAgent,
  tool,
  isStepCount,
} from 'ai';
import { z } from 'zod';

import {
  langfuseSpanProcessor,
} from '../../../src/otel/langfuse';

const agent = new ToolLoopAgent({
  model: google('gemini-3.1-flash-lite'),

  instructions:
    'You are a helpful assistant. Use tools when useful.',

  tools: {
    getTime: tool({
      description:
        'Get the current server time.',

      inputSchema: z.object({}),

      execute: async () => ({
        time: new Date().toISOString(),
      }),
    }),
  },

  stopWhen: isStepCount(5),

  experimental_telemetry: {
    isEnabled: true,
    functionId: 'lab01-agent',
  },
});

export async function POST(
  request: Request,
) {
  const body = await request.json();

  const prompt =
    typeof body?.prompt === 'string'
      ? body.prompt
      : 'What time is it?';

  try {
    const result = await agent.generate({
      prompt,
    });

    return Response.json({
      text: result.text,
      usage: result.usage,
    });
  } finally {
    await langfuseSpanProcessor.forceFlush();
  }
}
