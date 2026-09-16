# Agent Comparison

Both OpenCode and Codex were given the same task: implement the `/api/health` endpoint using the existing `HealthResponse` contract.

## OpenCode

OpenCode implemented the endpoint using `NextResponse.json()` and typed the response as `HealthResponse`.

The implementation passed:

- `npm test`
- `npm run build`

## Codex

Codex implemented the endpoint using `HealthResponse.parse(...)` before returning the response with `Response.json()`.

The implementation also passed:

- `npm test`
- `npm run build`

## Comparison

Both implementations worked correctly and passed all checks.

The Codex implementation was selected for `main` because it validates the response against the Zod schema at runtime using `HealthResponse.parse(...)`.
