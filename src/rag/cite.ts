/** ЦИТУВАННЯ (крок 05): читач має знайти місце в документі за 10 секунд. */
import type { IndexedChunk } from './store';

/** Рядок, який бачить користувач: [pdr-12#0001] pdr-12 › 12. ШВИДКІСТЬ РУХУ · символи 0–1110 (0-based). */
export function renderCitation(c: IndexedChunk): string {
  const where = c.heading === '' ? '' : ` › ${c.heading}`;
  return `[${c.id}] ${c.docId}${where} · символи ${c.start}–${c.end}`;
}

/** Фрагменти в промпт — з id, бо цитувати модель має саме їх. */
export function renderContext(chunks: readonly IndexedChunk[]): string {
  return chunks
    .map((c) => `[${c.id}] ${c.docId}${c.heading === '' ? '' : ` › ${c.heading}`}\n${c.text}`)
    .join('\n\n---\n\n');
}

const CITED = /\[([a-z0-9][a-z0-9-]*#\d{4})]/gi;

/** id фрагментів, на які посилається відповідь. */
export function citedIds(answer: string): string[] {
  return [...answer.matchAll(CITED)].map((m) => m[1] ?? '').filter(Boolean);
}

/** Відповідь без цитати і цитата на невидане — помилки. Порожній список = «зелено». */
export function validateAnswer(answer: string, served: readonly IndexedChunk[]): string[] {
  const problems: string[] = [];
  const ids = new Set(served.map((c) => c.id));
  const used = citedIds(answer);
  if (used.length === 0) problems.push('у відповіді немає жодної цитати');
  for (const id of used) {
    if (!ids.has(id)) problems.push(`цитата [${id}]: такого фрагмента асистентові не давали`);
  }
  return problems;
}
