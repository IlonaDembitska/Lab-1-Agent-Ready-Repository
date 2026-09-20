import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const event = JSON.parse(readFileSync(0, "utf8"));
const source = process.argv[2] ?? "codex";
const tool = event.tool_name ?? event.toolName ?? "unknown";
const args = event.tool_input ?? event.toolArgs ?? {};
const command = String(args.command ?? args.filePath ?? args.file_path ?? "");

if (/\.env(\.local|\.development|\.production|\.test)?\b/i.test(command)) {
  const dir = join(event.cwd ?? process.cwd(), ".agent-log");
  mkdirSync(dir, { recursive: true });

  appendFileSync(
    join(dir, `${source}.jsonl`),
    JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      input: { command: command.replace(/=\S+/g, "=***").slice(0, 200) },
      result: "denied",
      session: event.session_id ?? event.sessionId ?? "unknown",
      source
    }) + "\n"
  );

  console.error("Blocked: agents must not read or modify .env files.");
  process.exit(2);
}
