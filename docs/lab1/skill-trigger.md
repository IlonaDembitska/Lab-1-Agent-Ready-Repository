# Skill Trigger Test

Skill: `health-check`

## Requests that should trigger the skill

1. Check the `/api/health` endpoint.
2. Verify that the health route works correctly.
3. Run a health check for the project.

## Requests that should NOT trigger the skill

1. Change the homepage title.
2. Update the CSS styles.
3. Create a new API route for users.

## Verification

### Codex

Codex successfully detected and used the `health-check` skill.
It read the skill instructions and ran the health-check script.
The health tests and production build passed.

### OpenCode

OpenCode also successfully detected and used the `health-check` skill.
It ran the health-check script and confirmed that `/api/health` is healthy.
No files were modified.

Result: the skill triggers correctly for health-related requests and should not be used for unrelated tasks.
