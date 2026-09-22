# Portability

## Goal

Перевірити, наскільки агентний workflow переноситься між різними моделями та API без зміни основної логіки агента.

## Providers

У лабораторній роботі використовувались два типи моделей:

### Ollama

Локальна модель:

- `qwen3:4b`
- запуск через Ollama;
- використовується без зовнішнього cloud API;
- підходить для локальних експериментів та базових agent loop сценаріїв.

### Google Gemini

Cloud-модель:

- `gemini-3.1-flash-lite`
- використовується через Google AI SDK;
- підходить для production deployment та tracing;
- успішно працює у Vercel deployment.

## API compatibility

Для custom agent loop були реалізовані адаптери:

- Messages-style API;
- OpenAI-compatible Chat Completions API.

Основна агентна логіка не залежить від конкретного provider API.

Основні файли:

- `src/agent/agent-loop.ts`
- `src/agent/adapters.ts`
- `src/agent/tools.ts`

## Portability result

Один і той самий agent workflow можна запускати з різними моделями, змінюючи provider або adapter, без повного переписування agent loop.

Практичне спостереження:

- Gemini стабільно виконував багатокроковий tool-calling workflow;
- локальна `qwen3:4b` через Ollama могла виконати перший tool call, але багатокрокові tool-calling запуски були значно повільнішими;
- AI SDK дозволив використовувати спільну агентну структуру та окремо налаштовувати модель.

## Deployment portability

Локально застосунок працює через:

```text
http://localhost:3001/api/agent
