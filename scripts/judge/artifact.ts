/**
 * Калібрування судді (Лаб. 3, крок 05): спільне для розмітки людиною і для судді.
 * Артефакт — тека прогону в docs/lab3/runs/<назва>/ з patch.diff, output.txt, run.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Task } from '../harness/run-task';

export type Label = 'pass' | 'fail' | 'unknown';
export const LABELS: readonly Label[] = ['pass', 'fail', 'unknown'];

/** Один рядок docs/lab3/judge-cases.jsonl: один випадок на один вимір. */
export interface JudgeCase {
  readonly case_id: string;
  readonly artifact: string;
  readonly dimension: string;
  readonly mine: Label;
  readonly reason: string;
  readonly holdout: boolean;
}

export interface Artifact {
  readonly dir: string;
  readonly task: Task;
  readonly status: string;
  readonly checks: readonly { readonly cmd: string; readonly code: number }[];
  readonly changedFiles: readonly string[];
  readonly patch: string;
  readonly output: string;
}

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** Прибирає кольорові коди терміналу з output.txt. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

export function loadJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

/** Задача артефакту: шукаємо id з run.json у банку кроку 04 і в демо-черзі кроку 03. */
export function loadArtifact(dir: string): Artifact {
  const run = JSON.parse(read(join(dir, 'run.json'))) as {
    id: string;
    status: string;
    checks?: { cmd: string; code: number }[];
    changedFiles?: string[];
  };
  const tasks = [...loadJsonl<Task>('docs/lab3/tasks.jsonl'), ...loadJsonl<Task>('docs/lab3/stop-tasks.jsonl')];
  const task = tasks.find((t) => t.id === run.id);
  if (task === undefined) throw new Error(`${dir}: задачі ${run.id} немає в tasks.jsonl / stop-tasks.jsonl`);
  return {
    dir,
    task,
    status: run.status,
    checks: run.checks ?? [],
    changedFiles: run.changedFiles ?? [],
    patch: read(join(dir, 'patch.diff')),
    output: stripAnsi(read(join(dir, 'output.txt'))),
  };
}
