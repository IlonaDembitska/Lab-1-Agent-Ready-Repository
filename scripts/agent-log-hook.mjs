// Hook журналу для інструментів без jq: читає JSON події зі stdin і дописує
// один рядок формату курсу в .agent-log/<source>.jsonl.
// Виклик: node scripts/agent-log-hook.mjs <source> [result]

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [source = 'unknown', result = 'ok'] = process.argv.slice(2);
const event = JSON.parse(readFileSync(0, 'utf8'));

const tool =
  event.tool_name ??
  event.toolName ??
  event.tool ??
  'unknown';

const args =
  event.tool_input ??
  event.toolArgs ??
  event.args ??
  {};

const input = {};

if (tool === 'apply_patch') {
  const text = String(args.command ?? args.patchText ?? '');
  const files = [
    ...text.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm
    ),
  ];
  input.files = files.map((m) => m[1].trim());
} else {
  for (const key of ['filePath', 'command', 'pattern', 'url', 'name']) {
    if (typeof args[key] === 'string') {
      input[key] = args[key].slice(0, 200);
    }
  }
}

const dir = join(
  process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  '.agent-log'
);

mkdirSync(dir, { recursive: true });

const row = {
  ts: new Date().toISOString(),
  tool,
  input,
  result,
  session: event.session_id ?? event.sessionId ?? 'unknown',
  source,
};

appendFileSync(
  join(dir, `${source}.jsonl`),
  `${JSON.stringify(row)}\n`
)
