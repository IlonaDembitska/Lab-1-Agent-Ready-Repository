/**
 * Детермінована перевірка цитат у форку (кроки 03–04 Лаб. 4): запускається ДО будь-якої моделі.
 * Цитата — або коміт, або файл + рядок на момент коміту.
 */
import { execFileSync } from 'node:child_process';

import { z } from 'zod';

export const cite = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{7,40}$/i, 'sha — 7–40 шістнадцяткових символів'),
    file: z.string().min(1).optional(),
    line: z.number().int().min(1).optional(),
  })
  .strict();
export type Cite = z.infer<typeof cite>;

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** null — цитата існує; рядок — причина, чому ні. */
export function checkCite(root: string, c: Cite): string | null {
  try {
    git(root, ['cat-file', '-e', `${c.sha}^{commit}`]);
  } catch {
    return `коміту ${c.sha} у форку немає`;
  }
  if (c.file === undefined) return null;
  if (c.line === undefined) {
    try {
      git(root, ['cat-file', '-e', `${c.sha}:${c.file}`]);
      return null;
    } catch {
      return `файлу ${c.file} на ${c.sha} немає`;
    }
  }
  try {
    // -L n,n прив'язує цитату до конкретного рядка на конкретному коміті
    git(root, ['blame', '-L', `${c.line},${c.line}`, c.sha, '--', c.file]);
  } catch {
    return `${c.file}:${c.line} на ${c.sha} не існує`;
  }
  return null;
}

/** Текст, який бачить верифікатор: сам рядок (±2) або опис коміту. Вміст — лише з форка, не від моделі. */
export function citeEvidence(root: string, c: Cite): string {
  if (c.file !== undefined && c.line !== undefined) {
    const lines = git(root, ['show', `${c.sha}:${c.file}`]).split(/\r?\n/);
    const a = Math.max(1, c.line - 2);
    const b = Math.min(lines.length, c.line + 2);
    return lines.slice(a - 1, b).map((l, i) => `${a + i}${a + i === c.line ? '>' : ':'} ${l}`).join('\n');
  }
  return git(root, ['show', '--stat', '--format=%h %ad %an%n%s', '--date=short', c.sha]).slice(0, 2000);
}

export function permalink(repoUrl: string, c: Cite): string {
  if (c.file === undefined) return `${repoUrl}/commit/${c.sha}`;
  return `${repoUrl}/blob/${c.sha}/${c.file}${c.line !== undefined ? `#L${c.line}` : ''}`;
}
