import { appendFileSync, mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export type ToolOutcome = 'ok' | 'error' | 'denied';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Record<string, unknown>;
  run(
    input: unknown,
  ): Promise<{
    readonly outcome: ToolOutcome;
    readonly content: string;
  }>;
}

export interface LogEntry {
  readonly ts: string;
  readonly tool: string;
  readonly input: unknown;
  readonly result: ToolOutcome;
  readonly session: string;
  readonly source: 'agent-loop';
}

class DeniedError extends Error {}

const MAX_CHARS = 20_000;
const HIDDEN = new Set([
  'node_modules',
  '.git',
  '.next',
]);

export function resolveInside(
  root: string,
  relative: string,
): string {
  const abs = path.resolve(root, relative);
  const rel = path.relative(root, abs);

  if (
    rel === '..' ||
    rel.startsWith(`..${path.sep}`)
  ) {
    throw new DeniedError(
      'Path must stay inside the repository',
    );
  }

  const parts = rel.split(path.sep);

  for (const part of parts) {
    if (
      part === '.env' ||
      (part.startsWith('.env.') &&
        part !== '.env.example')
    ) {
      throw new DeniedError(
        'Reading .env files is not allowed',
      );
    }
  }

  return abs;
}

const ListFilesInput = z
  .object({
    path: z.string().default('.'),
  })
  .strict();

const ReadFileInput = z
  .object({
    path: z.string(),
  })
  .strict();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export function createTools(
  root = process.cwd(),
): AgentTool[] {
  return [
    {
      name: 'list_files',
      description:
        'List files and directories inside the repository.',
      jsonSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },

      async run(input) {
        try {
          const parsed = ListFilesInput.parse(input);
          const dir = resolveInside(root, parsed.path);

          const entries = await readdir(dir, {
            withFileTypes: true,
          });

          const visible = entries
            .filter(
              (entry) => !HIDDEN.has(entry.name),
            )
            .map((entry) =>
              entry.isDirectory()
                ? `${entry.name}/`
                : entry.name,
            )
            .sort();

          return {
            outcome: 'ok',
            content: visible.join('\n'),
          };
        } catch (error) {
          return {
            outcome:
              error instanceof DeniedError
                ? 'denied'
                : 'error',
            content: message(error),
          };
        }
      },
    },

    {
      name: 'read_file',
      description:
        'Read a UTF-8 text file inside the repository.',
      jsonSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },

      async run(input) {
        try {
          const parsed = ReadFileInput.parse(input);
          const file = resolveInside(
            root,
            parsed.path,
          );

          const text = await readFile(
            file,
            'utf8',
          );

          return {
            outcome: 'ok',
            content:
              text.length <= MAX_CHARS
                ? text
                : `${text.slice(
                    0,
                    MAX_CHARS,
                  )}\n… обрізано, у файлі ${text.length} символів`,
          };
        } catch (error) {
          return {
            outcome:
              error instanceof DeniedError
                ? 'denied'
                : 'error',
            content: message(error),
          };
        }
      },
    },
  ];
}

export async function listFiles(
  relative = '.',
): Promise<string[]> {
  const tool = createTools().find(
    (item) => item.name === 'list_files',
  )!;

  const result = await tool.run({
    path: relative,
  });

  if (result.outcome !== 'ok') {
    throw new Error(result.content);
  }

  return result.content
    .split('\n')
    .filter(Boolean);
}

export async function readTextFile(
  relative: string,
): Promise<string> {
  const tool = createTools().find(
    (item) => item.name === 'read_file',
  )!;

  const result = await tool.run({
    path: relative,
  });

  if (result.outcome !== 'ok') {
    throw new Error(result.content);
  }

  return result.content;
}

export function jsonlLogger(
  file: string,
): (entry: LogEntry) => void {
  return (entry) => {
    mkdirSync(path.dirname(file), {
      recursive: true,
    });

    appendFileSync(
      file,
      `${JSON.stringify(entry)}\n`,
      'utf8',
    );
  };
}
