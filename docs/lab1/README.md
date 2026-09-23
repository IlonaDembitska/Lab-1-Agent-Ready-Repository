# Lab 1 — Agent-Ready Repository

## Repository

GitHub:
https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository

Production deployment:
https://lab-1-agent-ready-repository.vercel.app

## What was implemented

У лабораторній роботі репозиторій був підготовлений до роботи з coding agents та агентними workflow.

Реалізовано:

- `AGENTS.md` та `CLAUDE.md` з інструкціями для агентів;
- журналювання агентних сесій;
- `/api/health` endpoint;
- health-check skill;
- захист `.env` та інших секретних файлів;
- Playwright/CI перевірки;
- підрахунок токенів та приблизної вартості LLM-викликів;
- власний agent loop;
- підтримку Ollama та Gemini;
- AI SDK 7 agent;
- human approval для destructive `write_file`;
- deployment на Vercel;
- Langfuse/OpenTelemetry tracing;
- production endpoint `/api/agent`.

## Models

### Local

Ollama:

- model: `qwen3:4b`
- використовується для локальних експериментів та agent loop.

### Cloud

Google Gemini:

- model: `gemini-3.1-flash-lite`
- використовується для AI SDK agent та production deployment.

## Agent implementations

### Custom agent loop

Основні файли:

- `src/agent/agent-loop.ts`
- `src/agent/tools.ts`
- `src/agent/adapters.ts`

Підтримуються:

- Messages-style API;
- OpenAI-compatible Chat Completions API;
- step limit;
- token budget;
- structured output;
- read-only repository tools.

### AI SDK agent

Основний файл:

- `src/agent/agent-aisdk.ts`

Використовується:

- AI SDK 7;
- `ToolLoopAgent`;
- structured output;
- tool approval;
- `write_file` як destructive tool;
- explicit user approval before execution.

Тести:

- `tests/agent-aisdk.test.ts`

Тести перевіряють, що:

- без approval `write_file` не виконується;
- після approval `write_file` виконується.

## API

### Health

Endpoint:

`GET /api/health`

Приклад відповіді:

```json
{
  "status": "ok"
}
```

## Як запустити у двох інструментах

### Codex

У корені репозиторію:

```bash
codex
```

Після запуску Codex читає `AGENTS.md` та працює з репозиторієм відповідно до заданих правил.

### OpenCode

У корені репозиторію:

```bash
opencode
```

OpenCode використовує конфігурацію `opencode.json`, guard-плагіни та правила доступу до `.env` файлів.

Перед завершенням задачі в обох інструментах потрібно перевірити:

```bash
npm run typecheck
npm test
npm run build
```

