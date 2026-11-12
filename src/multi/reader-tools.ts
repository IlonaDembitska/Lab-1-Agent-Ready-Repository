/**
 * Читальні інструменти для ролі «читач» (Лаб. 4, крок 03).
 * Корінь читання — тека форка чужого проєкту (FORK_DIR). Кожен шлях проходить перевірку
 * канонічності: після realpath він мусить лишатися всередині форка. Інструментів запису тут
 * немає; перелік дозволених — у src/multi/reader-tools.json, і код падає, якщо там з'явиться
 * щось поза READ_ONLY_TOOLS.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

/** Повний перелік читальних інструментів, які взагалі існують у коді. */
export const READ_ONLY_TOOLS = ['list_files', 'read_file', 'grep', 'git_log', 'git_rank', 'git_blame', 'git_show'] as const;
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

const MAX_OUT = 6000;

export function forkDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env.FORK_DIR ?? '';
  if (raw.trim() === '') throw new Error('FORK_DIR не задано: вкажи теку форка чужого проєкту');
  return realpathSync(resolve(raw));
}

/** Канонічний шлях усередині форка або виняток. .env і .git читати не можна. */
export function safePath(root: string, p: string): string {
  if (isAbsolute(p)) throw new Error(`абсолютний шлях заборонено: ${p}`);
  const full = resolve(root, p);
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    throw new Error(`немає такого шляху у форку: ${p}`);
  }
  if (real !== root && !real.startsWith(root + sep)) throw new Error(`шлях виходить за межі форка: ${p}`);
  const rel = relative(root, real);
  const parts = rel.split(sep);
  if (parts.includes('.git') || parts.includes('node_modules')) throw new Error(`заборонено читати ${p}`);
  if (parts.some((x) => /^\.env/.test(x))) throw new Error(`заборонено читати .env: ${p}`);
  return real;
}

function clip(s: string): string {
  return s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n[обрізано: ${s.length - MAX_OUT} символів]` : s;
}

function git(root: string, args: string[]): string {
  return clip(execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
}

/** SHA або ref: лише безпечні символи, щоб не передати git прапорець. */
const refSchema = z.string().regex(/^[0-9a-zA-Z._/^~-]{1,64}$/).refine((s) => !s.startsWith('-'), 'ref не може починатися з -');
const pathSchema = z.string().min(1).max(200).refine((s) => !s.startsWith('-'), 'шлях не може починатися з -');

function buildAll(root: string): Record<ReadOnlyTool, ToolSet[string]> {
  return {
    list_files: tool({
      description: 'Перелік файлів у репозиторії форка (git ls-files), без node_modules.',
      inputSchema: z.object({}),
      execute: async () => git(root, ['ls-files']),
    }),
    read_file: tool({
      description: 'Прочитати рядки файлу форка з номерами. from/to — номери рядків (за замовчуванням 1–200).',
      inputSchema: z.object({ path: pathSchema, from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() }),
      execute: async ({ path, from, to }) => {
        const lines = readFileSync(safePath(root, path), 'utf8').split(/\r?\n/);
        const a = from ?? 1;
        const b = Math.min(to ?? a + 199, lines.length);
        return clip(lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n'));
      },
    }),
    grep: tool({
      description: 'Пошук рядка в файлах форка (git grep -n). Повертає файл:рядок:текст.',
      inputSchema: z.object({ pattern: z.string().min(1).max(100) }),
      execute: async ({ pattern }) => {
        try {
          return git(root, ['grep', '-n', '-F', '-e', pattern]);
        } catch {
          return '(збігів немає)';
        }
      },
    }),
    git_log: tool({
      description: 'Історія файлу форка з перейменуваннями: git log --follow --oneline -- <path>.',
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => git(root, ['log', '--follow', '--oneline', '--', relative(root, safePath(root, path)) || '.']),
    }),
    git_rank: tool({
      description: 'Файли форка, що змінювалися найчастіше (кількість комітів), топ-15.',
      inputSchema: z.object({}),
      execute: async () => {
        const names = git(root, ['log', '--format=format:', '--name-only']).split('\n').filter((l) => l.trim() !== '');
        const counts = new Map<string, number>();
        for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
        return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([n, c]) => `${c} ${n}`).join('\n');
      },
    }),
    git_blame: tool({
      description: 'Авторство рядків файлу форка: git blame -w -C -L from,to --date=short.',
      inputSchema: z.object({ path: pathSchema, from: z.number().int().min(1), to: z.number().int().min(1) }),
      execute: async ({ path, from, to }) =>
        git(root, ['--no-pager', 'blame', '-w', '-C', '-L', `${from},${Math.max(from, to)}`, '--date=short', '--', relative(root, safePath(root, path))]),
    }),
    git_show: tool({
      description: 'Короткий опис коміту форка: хеш, дата, автор, повідомлення і перелік змінених файлів (без вмісту).',
      inputSchema: z.object({ sha: refSchema }),
      execute: async ({ sha }) => git(root, ['show', '--stat', '--format=%h %ad %an%n%s', '--date=short', sha]),
    }),
  };
}

/** Читає перелік дозволених із файлу конфігурації й будує лише їх. Невідоме ім'я = виняток. */
export function readerTools(root: string, configFile = join('src', 'multi', 'reader-tools.json')): ToolSet {
  const cfg = z.object({ role: z.literal('reader'), allow: z.array(z.string()).min(1) }).passthrough().parse(JSON.parse(readFileSync(configFile, 'utf8')));
  const all = buildAll(root);
  const out: ToolSet = {};
  for (const name of cfg.allow) {
    if (!(READ_ONLY_TOOLS as readonly string[]).includes(name)) {
      throw new Error(`reader-tools.json: «${name}» не є читальним інструментом — роль читача не може його мати`);
    }
    out[name] = all[name as ReadOnlyTool];
  }
  return out;
}
