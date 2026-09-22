# Model Decision

## Goal

Обрати моделі для локальної розробки, agent loop експериментів і production deployment.

## Local model

Обрана локальна модель:

- `qwen3:4b`
- provider: Ollama

### Причини вибору

- працює локально без cloud API;
- не потребує оплати за кожен запит;
- підходить для тестування базових agent workflow;
- дозволяє перевіряти portability між локальним і cloud provider.

### Обмеження

Під час тестів модель успішно виконувала перший tool call, але багатокрокові agent loop сценарії були повільними.

Через це локальна модель підходить переважно для development і базових експериментів.

## Cloud model

Обрана cloud-модель:

- `gemini-3.1-flash-lite`
- provider: Google

### Причини вибору

- стабільно працювала з tool calling;
- успішно виконувала custom agent loop;
- сумісна з AI SDK 7;
- підтримує production deployment у Vercel;
- дозволяє збирати traces через Langfuse;
- має низьку вартість для лабораторних експериментів.

## Measurements

Під час вимірювання Gemini:

- estimated input tokens: 14135;
- actual input tokens: 14135;
- похибка оцінки: 0.0%;
- приблизна list-price вартість одного виміряного запуску: близько `$0.00363`.

Також був зафіксований cached input у повторному запуску.

Детальні результати:

- `docs/lab1/cost.md`
- `docs/lab1/comparison.md`

## Agent loop result

Для custom agent loop Gemini успішно завершував багатокрокові сценарії зі structured output.

Приклади успішних запусків:

- 11 steps;
- 12 steps;
- валідний structured output;
- tool calls виконані успішно.

При спробі серії з 10 запусків виконання було обмежене free-tier API quota HTTP 429, а не помилкою structured output.

## Final decision

Для локальної розробки та experimentation використовується:

`qwen3:4b` через Ollama.

Для production, AI SDK agent, tracing і стабільного багатокрокового tool calling використовується:

`gemini-3.1-flash-lite`.

Такий поділ дозволяє поєднати локальну автономність і низьку вартість development із більш стабільною cloud-моделлю для production workflow.
