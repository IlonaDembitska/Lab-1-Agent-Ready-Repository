import { z } from 'zod';

import {
  chatCompletionsModel,
  messagesModel,
} from '../src/agent/adapters';
import {
  runAgentLoop,
  type Model,
} from '../src/agent/agent-loop';
import {
  createTools,
  jsonlLogger,
} from '../src/agent/tools';
import { priceUsd } from '../src/cost';
import {
  CATALOG,
  MODELS,
  type ModelSpec,
} from '../src/models';

const Proposal = z
  .object({
    summary: z.string().min(1),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            content: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const SYSTEM = [
  'Ти агент кодування в Next.js App Router репозиторії.',
  'Проєкт використовує TypeScript strict і Vitest.',
  'Маєш лише list_files та read_file.',
  'Спочатку прочитай потрібні файли.',
  'Коли рішення готове, не викликай інструменти.',
  'Поверни лише JSON виду:',
  '{"summary":"що зроблено","files":[{"path":"шлях","content":"повний вміст файлу"}]}',
].join('\n');

const TASK =
  'Додай GET /api/health так, щоб проходив tests/health.test.ts. Контракт знаходиться у src/health.ts. Запропонуй повний вміст потрібних файлів.';

interface PickedModel {
  readonly model: Model;
  readonly spec: ModelSpec;
  readonly form: string;
}

function pick(kind: string): PickedModel {
  if (kind === 'gemini') {
    const key = process.env.GEMINI_API_KEY;

    if (!key) {
      throw new Error(
        'GEMINI_API_KEY порожній у .env.local',
      );
    }

    const spec =
      CATALOG['gemini-3.1-flash-lite'];

    return {
      spec,
      form: 'chat-completions',
      model: chatCompletionsModel({
        url:
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: spec.id,
        headers: {
          authorization: `Bearer ${key}`,
        },
      }),
    };
  }

  const spec = MODELS.local;

  if (kind === 'ollama-messages') {
    return {
      spec,
      form: 'messages',
      model: messagesModel({
        url: `${spec.baseUrl}/v1/messages`,
        model: spec.id,
      }),
    };
  }

  if (kind === 'ollama-chat') {
    return {
      spec,
      form: 'chat-completions',
      model: chatCompletionsModel({
        url: `${spec.baseUrl}/v1/chat/completions`,
        model: spec.id,
      }),
    };
  }

  throw new Error(
    `Невідомий режим "${kind}". Використай: ollama-messages, ollama-chat або gemini`,
  );
}

const [
  kind = 'ollama-messages',
  runsArg = '1',
] = process.argv.slice(2);

const runs = Number(runsArg);

if (
  !Number.isInteger(runs) ||
  runs < 1
) {
  throw new Error(
    'Кількість прогонів має бути додатним цілим числом',
  );
}

const { model, spec, form } = pick(kind);

const tools = createTools(process.cwd());

const log = jsonlLogger(
  '.agent-log/agent-loop.jsonl',
);

let valid = 0;
let firstOutput: unknown;

console.log(
  '| # | провайдер | форма API | модель | зупинка | кроки | вхідні | кешовані | вихідні | $ за прайсом | затримка, мс | session |',
);
console.log(
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
);

for (let i = 1; i <= runs; i++) {
  const session =
    `agent-loop-${kind}-${Date.now()}-${i}`;

  const started = performance.now();

  try {
    const result = await runAgentLoop({
      model,
      tools,
      system: SYSTEM,
      task: TASK,
      output: Proposal,
      maxSteps: 12,
      tokenBudget: 150_000,
      session,
      log,
    });

    const ms = Math.round(
      performance.now() - started,
    );

    const usage = result.usage;

    console.log(
      `| ${i} | ${spec.provider} | ${form} | ${spec.id} | ${result.stop} | ${result.steps} | ${usage.inputTokens} | ${usage.cachedTokens} | ${usage.outputTokens} | ${priceUsd(
        spec,
        usage,
      ).toFixed(6)} | ${ms} | ${session} |`,
    );

    if (result.stop === 'done') {
      valid += 1;
      firstOutput ??= result.output;
    }
  } catch (error) {
    console.error(
      `Прогін ${i} перервано:`,
      error instanceof Error
        ? error.message
        : error,
    );

    break;
  }
}

console.log(
  `\nВалідних структурованих виходів: ${valid} з ${runs}`,
);

if (firstOutput !== undefined) {
  console.log(
    '\nПерша валідна пропозиція:',
  );

  console.log(
    JSON.stringify(firstOutput, null, 2),
  );
}
