# AGENTS.md 40% Reduction Test

I temporarily removed approximately 40% of the instructions from AGENTS.md.

I then asked Codex to read the repository instructions and identify the commands required before considering a task complete.

Codex correctly identified:

- `npm test`
- `npm run build`

It also correctly noted that errors should be fixed before completion, secrets should not be committed to Git, and unnecessary files or changes should not be included.

Result: the reduced AGENTS.md still provided enough information for the coding agent to understand the main repository rules.