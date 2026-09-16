---
name: health-check
description: "Перевіряє /api/health, запускає health-тести та build. Використовуй, коли просять перевірити health endpoint, /api/health або працездатність health route. Не використовуй для змін сторінок, стилів чи інших API-маршрутів."
---
# Health Check Skill

Use this skill when the task is related to checking, testing, or verifying the `/api/health` endpoint.

## When to use

Use this skill for requests such as:

- check the health endpoint
- verify `/api/health`
- test whether the health route works
- run a health check

Do not use this skill for unrelated tasks.

## Instructions

1. Run the health-related tests.
2. Run the project build.
3. Report whether `/api/health` is available and valid.
4. Do not modify application code unless explicitly requested.

## Script

Run:

`node .claude/skills/health-check/scripts/check-health.mjs`
