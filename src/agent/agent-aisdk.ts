import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import {
  ToolLoopAgent,
  tool,
  isStepCount,
  Output,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
} from 'ai';

import { google } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

import { CATALOG, MODELS } from '../models';

export interface FileOps {
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export function pickModel(): LanguageModel {
  const local = MODELS.local;

  if (process.env.LLM_PROVIDER === 'ollama') {
    return createOllama({
      baseURL: `${local.baseUrl}/api`,
    })(local.id);
  }

  if (
    process.env.LLM_PROVIDER ===
    'openai-compatible'
  ) {
    return createOpenAICompatible({
      name: 'ollama',
      baseURL: `${local.baseUrl}/v1`,
    })(local.id);
  }

  return google(
    CATALOG['gemini-3.1-flash-lite'].id,
  );
}

export const Report = z.object({
  summary: z.string(),
  written: z.array(z.string()),
});

export function createAgent(
  model: LanguageModel,
  fs: FileOps,
  maxSteps = 5,
) {
  return new ToolLoopAgent({
    model,

    instructions:
      'Ти файловий асистент. Якщо запис відхилено, не повторюй його.',

    tools: {
      list_files: tool({
        description:
          'Показати файли в теці (безпечно)',

        inputSchema: z.object({
          dir: z.string(),
        }),

        execute: async ({ dir }) =>
          fs.list(dir),
      }),

      read_file: tool({
        description:
          'Прочитати текстовий файл (безпечно)',

        inputSchema: z.object({
          path: z.string(),
        }),

        execute: async ({ path }) =>
          fs.read(path),
      }),

      write_file: tool({
        description:
          'Записати файл (деструктивно: перезаписує вміст)',

        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),

        execute: async ({
          path,
          content,
        }) => {
          await fs.write(path, content);

          return {
            ok: true,
            path,
          };
        },
      }),
    },

    toolApproval: {
      write_file: 'user-approval',
    },

    stopWhen: isStepCount(maxSteps),

    output: Output.object({
      schema: Report,
    }),
  });
}

export type Ask = (
  toolName: string,
  input: unknown,
) => Promise<boolean>;

export async function runWithApproval(
  agent: ReturnType<typeof createAgent>,
  prompt: string,
  ask: Ask,
) {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ];

  const first = await agent.generate({
    messages,
  });

  const approvals: ToolApprovalResponse[] =
    [];

  for (const part of first.content) {
    if (
      part.type ===
        'tool-approval-request' &&
      !part.isAutomatic
    ) {
      const approved = await ask(
        part.toolCall.toolName,
        part.toolCall.input,
      );

      approvals.push({
        type: 'tool-approval-response',
        approvalId: part.approvalId,
        approved,
      });
    }
  }

  const second =
    approvals.length > 0
      ? await agent.generate({
          messages: [
            ...messages,
            ...first.responseMessages,
            {
              role: 'tool',
              content: approvals,
            },
          ],
        })
      : undefined;

  const steps = [
    ...first.steps,
    ...(second?.steps ?? []),
  ].map((step) => step.usage);

  const inputTokens = steps.reduce(
    (sum, usage) =>
      sum + (usage.inputTokens ?? 0),
    0,
  );

  const outputTokens = steps.reduce(
    (sum, usage) =>
      sum + (usage.outputTokens ?? 0),
    0,
  );

  return {
    first,
    final: second ?? first,
    approvals,
    steps,
    inputTokens,
    outputTokens,
  };
}

if (
  process.argv[1]?.endsWith(
    'agent-aisdk.ts',
  )
) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const agent = createAgent(
    pickModel(),
    {
      list: (dir) => readdir(dir),
      read: (file) =>
        readFile(file, 'utf8'),
      write: (file, content) =>
        writeFile(file, content),
    },
  );

  const run = await runWithApproval(
    agent,
    process.argv[2] ??
      'Створи notes.txt з текстом hi',

    async (name, input) =>
      (
        await rl.question(
          `Дозволити ${name} ${JSON.stringify(
            input,
          )}? (y/n) `,
        )
      ).trim() === 'y',
  );

  rl.close();

  try {
    console.log(run.final.output);
  } catch {
    console.log(
      'Структурованого виходу немає: агент зупинився на ліміті кроків.',
    );
  }

  console.log({
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    steps: run.steps,
  });
}
