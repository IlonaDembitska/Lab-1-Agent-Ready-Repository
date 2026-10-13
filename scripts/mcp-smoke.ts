/**
 * Перевірка MCP-сервера наживо (крок 08): клієнт запускає scripts/mcp-server.ts як процес через stdio,
 * отримує список інструментів і викликає search_pdr. Потрібна локальна Ollama.
 *   npx tsx scripts/mcp-smoke.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main(): Promise<void> {
  const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'scripts/mcp-server.ts'] });
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log('інструменти сервера:', tools.map((t) => t.name).join(', '));
  const ok = await client.callTool({
    name: 'search_pdr',
    arguments: { query: 'Яка максимальна швидкість поза населеним пунктом для водія-новачка?', k: 2 },
  });
  console.log('\nsearch_pdr(q-01, k=2) → isError:', ok.isError ?? false);
  console.log(JSON.stringify(ok.content).slice(0, 500));
  const bad = await client
    .callTool({ name: 'search_pdr', arguments: { query: 'світло', k: 10000 } })
    .catch((e: unknown) => ({ isError: true, content: [{ type: 'text', text: String(e) }] }));
  console.log('\nsearch_pdr(k=10000) → isError:', bad.isError ?? false);
  console.log(JSON.stringify(bad.content).slice(0, 300));
  await client.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
