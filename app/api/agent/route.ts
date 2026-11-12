/**
 * Агентний маршрут (Лаб. 1 → Лаб. 4, крок 06): вимикач і стеля витрат ПЕРЕД моделлю, батьківський спан
 * задачі (trace_id у відповіді → у журнал прогону), functionId = task-<id> (→ gen_ai.agent.name),
 * облік totalUsage ПІСЛЯ, вивантаження спанів до завершення функції.
 */
import { randomUUID } from 'node:crypto';

import { google } from '@ai-sdk/google';
import { isStepCount, tool, ToolLoopAgent } from 'ai';
import { after } from 'next/server';
import { z } from 'zod';

import { recordUsage } from '@/src/budget';
import { guard } from '@/src/lab4/guard';
import { json } from '@/src/lab4/http';
import { withTaskSpan } from '@/src/telemetry/task-span';

import { langfuseSpanProcessor } from '../../../instrumentation';

export const runtime = 'nodejs';
export const maxDuration = 60;

function makeAgent(taskId: string) {
  return new ToolLoopAgent({
    model: google('gemini-3.1-flash-lite'),
    instructions: 'You are a helpful assistant. Use tools when useful.',
    tools: {
      getTime: tool({
        description: 'Get the current server time.',
        inputSchema: z.object({}),
        execute: async () => ({ time: new Date().toISOString() }),
      }),
    },
    stopWhen: isStepCount(5),
    // functionId → gen_ai.agent.name: за ним прогін знаходиться в Langfuse; вмісту запитів у трасі немає
    experimental_telemetry: { isEnabled: true, functionId: `task-${taskId}`, recordInputs: false, recordOutputs: false },
  });
}

export async function POST(request: Request) {
  after(async () => {
    await langfuseSpanProcessor.forceFlush();
  });
  const blocked = await guard();
  if (blocked !== null) return blocked;

  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; taskId?: unknown };
  const prompt = typeof body.prompt === 'string' && body.prompt.trim() !== '' ? body.prompt.slice(0, 2000) : 'What time is it?';
  const taskId = typeof body.taskId === 'string' && /^[\w.-]{1,64}$/.test(body.taskId) ? body.taskId : randomUUID();

  try {
    return await withTaskSpan(taskId, async (traceId) => {
      const result = await makeAgent(taskId).generate({ prompt });
      await recordUsage(result.totalUsage).catch(() => undefined);
      return json({ ok: true, task_id: taskId, trace_id: traceId, text: result.text, usage: result.totalUsage, steps: result.steps.length }, 200);
    });
  } catch (err) {
    return json({ ok: false, error: 'model', detail: err instanceof Error ? err.message.slice(0, 300) : String(err) }, 502);
  }
}
