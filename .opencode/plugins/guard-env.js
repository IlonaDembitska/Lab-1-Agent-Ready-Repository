import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const SECRET_FILE =
  /(^|[^A-Za-z0-9_$])\.env(\.(local|development|production|test)(\.local)?)?([^.A-Za-z0-9_]|$)/im

const targets = (tool, args = {}) => {
  if (tool === "apply_patch") {
    return [...String(args.patchText ?? "").matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm
    )].map((m) => ["files", m[1].trim()])
  }

  return ["filePath", "command"]
    .filter((key) => typeof args[key] === "string")
    .map((key) => [key, args[key]])
}

export const GuardEnv = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    const hit = targets(input.tool, output.args).find(([, value]) =>
      SECRET_FILE.test(value)
    )

    if (!hit) return

    const dir = path.join(directory, ".agent-log")
    mkdirSync(dir, { recursive: true })

    const row = {
      ts: new Date().toISOString(),
      tool: input.tool,
      input: {
        [hit[0]]: hit[1].replace(/=\S+/g, "=***").slice(0, 200),
      },
      result: "denied",
      session: input.sessionID,
      source: "opencode",
    }

    appendFileSync(
      path.join(dir, "opencode.jsonl"),
      JSON.stringify(row) + "\n"
    )

    throw new Error(
      "Політика курсу: файли .env читає і змінює людина, не агент."
    )
  },
})
