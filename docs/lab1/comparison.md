# Порівняння агентних підходів

## Власний agent loop

Реалізовано власний агентний цикл у:

- `src/agent/agent-loop.ts`
- `src/agent/tools.ts`
- `src/agent/adapters.ts`

Цикл підтримує:

- tool calling;
- кілька кроків роботи агента;
- обмеження `maxSteps`;
- обмеження за token budget;
- перевірку структурованої відповіді через Zod;
- логування tool calls у `.agent-log/agent-loop.jsonl`.

## Тести

Результат:

- 7 test files passed;
- 78 tests passed;
- `npm run typecheck` — без помилок.

Окремо перевірено:

- валідний структурований JSON;
- зупинку за `maxSteps`;
- зупинку за token budget;
- передачу результату tool call назад моделі;
- блокування читання `.env` та `.env.local`.

## Хмарний прогін — Gemini

Модель: `gemini-3.1-flash-lite`

Форма API: `chat-completions`

Завдання: запропонувати реалізацію `GET /api/health` на основі контракту `src/health.ts`.

Результат:

- status: `done`;
- кроків: 11;
- input tokens: 8650;
- cached tokens: 0;
- output tokens: 341;
- вартість за `models.ts`: $0.002674;
- затримка: 13753 мс;
- валідний структурований вихід: 1 з 1.

Агент повернув валідну пропозицію для `app/api/health/route.ts`.

## Локальний прогін — Ollama

Модель: `qwen3:4b`

Форма API: `messages`.

Під час запуску агент успішно виконав перший tool call:

`list_files`

У `.agent-log/agent-loop.jsonl` було записано:

- tool: `list_files`;
- result: `ok`;
- source: `agent-loop`.

Після передачі результату інструмента назад моделі багатоходовий цикл завис і був зупинений вручну.

Також була спроба через форму `chat-completions`, але локальний багатоходовий прогін теж не завершився за розумний час.

## Висновок

Власний agent loop коректно працює на хмарній моделі Gemini: виконує tool calls, проходить кілька кроків і повертає валідний структурований результат.

Локальна модель `qwen3:4b` через Ollama успішно починає agent loop і виконує tool call, але в поточному середовищі має проблему з продовженням багатоходового tool-calling циклу.

Таким чином, логіка власного agent loop підтверджена тестами та реальним успішним хмарним прогоном.

Додатковий окремий прогін також завершився успішно:

- status: `done`;
- кроків: 12;
- input tokens: 10595;
- output tokens: 364;
- вартість: $0.003195;
- затримка: 18651 мс;
- валідний structured output: 1 з 1.

Спроба запустити 10 прогонів підряд була обмежена Free Tier quota Gemini: другий прогін отримав HTTP 429 `RESOURCE_EXHAUSTED`. Це обмеження API, а не помилка agent loop.