import { readFile } from 'node:fs/promises';

import {
  COST_TABLE_HEADER,
  costTableRow,
  errorPct,
  fromGeminiUsage,
  fromMessagesUsage,
  languageMultiplier,
  priceUsd,
  withinTolerance,
  type GeminiUsage,
  type MessagesUsage,
  type Usage,
} from '../src/cost';
import { CATALOG, MODELS, type ModelSpec } from '../src/models';

const GEMINI = CATALOG['gemini-3.1-flash-lite'];
const LOCAL = MODELS.local;
const QUESTION = 'Одним реченням: що перевіряє scripts/doctor.ts?';

const PREFIX_FILES = [
  'scripts/doctor.ts',
  'scripts/sync-skills.ts',
  'src/models.ts',
];

const PREFIX = (
  await Promise.all(
    PREFIX_FILES.map((file) => readFile(file, 'utf8')),
  )
).join('\n\n');

const SYSTEM = `Ти рецензент коду. Код проєкту:\n\n${PREFIX}`;
const LOCAL_SYSTEM = SYSTEM.slice(0, 6_000);

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ json: unknown; ms: number }> {
  const started = performance.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const ms = performance.now() - started;

  if (!res.ok) {
    throw new Error(
      `${url} → HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  return {
    json: JSON.parse(text),
    ms,
  };
}

function gemini(
  method: 'countTokens' | 'generateContent',
  body: unknown,
): Promise<{ json: unknown; ms: number }> {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      'GEMINI_API_KEY порожній: заповніть .env.local',
    );
  }

  return post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI.id}:${method}`,
    {
      'x-goog-api-key': key,
    },
    body,
  );
}

function report(
  run: string,
  spec: ModelSpec,
  usage: Usage,
  ms: number,
  estimatedInput?: number,
): void {
  console.log(
    costTableRow({
      run,
      provider: spec.provider,
      model: spec.id,
      usage,
      actualUsd: 0,
      listUsd: priceUsd(spec, usage),
      latencyMs: ms,
      date: new Date().toISOString().slice(0, 10),
      ...(estimatedInput === undefined
        ? {}
        : { estimatedInput }),
    }),
  );

  if (estimatedInput !== undefined) {
    const verdict = withinTolerance(
      estimatedInput,
      usage.inputTokens,
    )
      ? 'у межах 10%'
      : 'ПОНАД 10%';

    console.log(
      `  оцінка ${estimatedInput} vs факт ${usage.inputTokens}: ${errorPct(
        estimatedInput,
        usage.inputTokens,
      ).toFixed(1)}% — ${verdict}`,
    );
  }
}

async function measureGemini(): Promise<void> {
  const request = {
    systemInstruction: {
      parts: [{ text: SYSTEM }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: QUESTION }],
      },
    ],
  };

  const counted = await gemini('countTokens', {
    generateContentRequest: {
      model: `models/${GEMINI.id}`,
      ...request,
    },
  });

  const estimate = (
    counted.json as { totalTokens: number }
  ).totalTokens;

  if (estimate < 4096) {
    console.warn(
      `Префікс лише ${estimate} токенів: кеш може не спрацювати.`,
    );
  }

  console.log(COST_TABLE_HEADER);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { json, ms } = await gemini(
      'generateContent',
      request,
    );

    const raw = (
      json as { usageMetadata: GeminiUsage }
    ).usageMetadata;

    console.log(
      '  сирий usageMetadata:',
      JSON.stringify(raw),
    );

    const usage = fromGeminiUsage(raw);

    report(
      `gemini-${attempt}`,
      GEMINI,
      usage,
      ms,
      estimate,
    );

    if (attempt >= 2 && usage.cachedTokens > 0) {
      return;
    }
  }

  console.warn(
    'Кешованих токенів немає після трьох спроб — доведіть кеш на Ollama.',
  );
}

async function ollamaMessages(
  system: string | undefined,
  content: string,
  maxTokens: number,
) {
  const { json, ms } = await post(
    `${LOCAL.baseUrl}/v1/messages`,
    {},
    {
      model: LOCAL.id,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    },
  );

  return {
    raw: (json as { usage: MessagesUsage }).usage,
    ms,
  };
}

async function measureOllama(): Promise<void> {
  console.log(COST_TABLE_HEADER);

  for (const run of ['ollama-1', 'ollama-2']) {
    const { raw, ms } = await ollamaMessages(
      LOCAL_SYSTEM,
      QUESTION,
      64,
    );

    console.log(
      '  сирий usage:',
      JSON.stringify(raw),
    );

    report(
      run,
      LOCAL,
      fromMessagesUsage(raw),
      ms,
    );
  }
}

function langBlock(
  md: string,
  tag: 'ua' | 'en',
): string {
  const open = '```' + tag + '\n';
  const start = md.indexOf(open);
  const end =
    start === -1
      ? -1
      : md.indexOf('```', start + open.length);

  const text =
    end === -1
      ? ''
      : md.slice(start + open.length, end).trim();

  if (text === '') {
    throw new Error(
      `У cost.md немає непорожнього блоку ${'```' + tag}`,
    );
  }

  return text;
}

async function measureLang(
  costMdPath: string,
): Promise<void> {
  const md = (
    await readFile(costMdPath, 'utf8')
  ).replaceAll('\r\n', '\n');

  const ua = langBlock(md, 'ua');
  const en = langBlock(md, 'en');

  if (process.env.GEMINI_API_KEY) {
    const count = async (
      text: string,
    ): Promise<number> =>
      (
        (
          await gemini('countTokens', {
            contents: [
              {
                role: 'user',
                parts: [{ text }],
              },
            ],
          })
        ).json as { totalTokens: number }
      ).totalTokens;

    const u = await count(ua);
    const e = await count(en);

    console.log(
      `google · ${GEMINI.id} · ${languageMultiplier(
        u,
        e,
      ).toFixed(2)}  (ua ${u} / en ${e})`,
    );
  }

  try {
    const tokens = async (
      text: string,
    ): Promise<number> =>
      fromMessagesUsage(
        (
          await ollamaMessages(
            undefined,
            text,
            1,
          )
        ).raw,
      ).inputTokens;

    const base = await tokens('.');
    const u = (await tokens(ua)) - base;
    const e = (await tokens(en)) - base;

    console.log(
      `ollama · ${LOCAL.id} · ${languageMultiplier(
        u,
        e,
      ).toFixed(2)}  (ua ${u} / en ${e}, шаблон ${base})`,
    );
  } catch (error) {
    console.warn(
      'Ollama не відповідає — пропускаю:',
      error instanceof Error
        ? error.message
        : error,
    );
  }
}

const [mode, costMd] = process.argv.slice(2);

if (mode === 'gemini') {
  await measureGemini();
} else if (mode === 'ollama') {
  await measureOllama();
} else if (mode === 'lang' && costMd) {
  await measureLang(costMd);
} else {
  console.error(
    'Використання: npx tsx --env-file=.env.local scripts/measure-cost.ts gemini | ollama | lang docs/lab1/cost.md',
  );
  process.exitCode = 1;
}