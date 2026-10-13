/**
 * Інструмент search_pdr (крок 08) — чиста логіка без мережі й без SDK.
 * Контракт і межі — docs/lab2/mcp-spec.md. Змінюється поведінка — спершу змінюється mcp-spec.md.
 */
import { z } from 'zod';

import type { Bm25Index } from '../rag/bm25';
import type { Embedder } from '../rag/embed';
import { retrieve } from '../rag/search';
import type { IndexFile } from '../rag/store';

export const LIMITS = { maxK: 5, maxQueryChars: 300 } as const;

const kMessage = `k має бути від 1 до ${LIMITS.maxK}`;

/** Поля входу: ту саму форму отримує і MCP SDK (inputSchema), і строга схема нижче. */
export const searchPdrShape = {
  query: z
    .string()
    .trim()
    .min(1, 'query не може бути порожнім')
    .max(LIMITS.maxQueryChars, `query має бути не довшим за ${LIMITS.maxQueryChars} символів`),
  k: z.number().int(kMessage).min(1, kMessage).max(LIMITS.maxK, kMessage).default(LIMITS.maxK),
};

/** Строга схема: будь-яке зайве поле (наприклад path) — відмова. */
export const searchPdrInput = z.object(searchPdrShape).strict();

export interface Fragment {
  readonly chunkId: string;
  readonly docId: string;
  readonly heading: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type SearchResult = { ok: true; fragments: Fragment[] } | { ok: false; error: string };

export interface SearchDeps {
  readonly index: IndexFile;
  readonly words: Bm25Index;
  readonly embedder: Embedder;
}

export async function searchPdr(raw: unknown, deps: SearchDeps): Promise<SearchResult> {
  const parsed = searchPdrInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    const { hits } = await retrieve(deps.index, deps.words, deps.embedder, parsed.data.query, parsed.data.k);
    return {
      ok: true,
      fragments: hits.slice(0, parsed.data.k).map(({ chunk }) => ({
        chunkId: chunk.id,
        docId: chunk.docId,
        heading: chunk.heading,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
      })),
    };
  } catch (err) {
    return { ok: false, error: `пошук недоступний: ${err instanceof Error ? err.message : String(err)}` };
  }
}
