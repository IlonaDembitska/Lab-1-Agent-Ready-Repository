/**
 * Запуск MCP-сервера через stdio (крок 08). Запускає клієнт (OpenCode, чат), а не людина:
 *   npx tsx scripts/mcp-server.ts
 * У stdout іде протокол — тому діагностика лише в stderr (console.error).
 */
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPdrServer } from '../src/mcp/server';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

async function main(): Promise<void> {
  const embedder = ollamaEmbedder();
  const index = loadIndex(fileURLToPath(new URL('../data/index.json', import.meta.url)), embedder);
  const server = createPdrServer({ index, words: bm25From(index), embedder });
  await server.connect(new StdioServerTransport());
  console.error(`pdr-search MCP: ${index.chunks.length} фрагментів, транспорт stdio`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
