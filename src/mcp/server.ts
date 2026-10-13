/** MCP-сервер (крок 08): реєструє search_pdr у SDK. Без вводу-виводу — транспорт підключає викликач. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LIMITS, searchPdr, searchPdrShape, type SearchDeps } from './search-pdr';

export function createPdrServer(deps: SearchDeps): McpServer {
  const server = new McpServer({ name: 'pdr-search', version: '1.0.0' });
  server.registerTool(
    'search_pdr',
    {
      title: 'Пошук по ПДР України',
      description: `Гібридний пошук по Правилах дорожнього руху України (редакція 09.04.2026). Повертає до ${LIMITS.maxK} фрагментів із chunkId для цитування у форматі [pdr-12#0001]. Лише читання, без мовної моделі.`,
      inputSchema: searchPdrShape,
    },
    async (args) => {
      const result = await searchPdr(args, deps);
      if (!result.ok) return { isError: true, content: [{ type: 'text' as const, text: result.error }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.fragments, null, 2) }] };
    },
  );
  return server;
}
