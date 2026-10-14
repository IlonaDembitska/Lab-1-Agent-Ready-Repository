# Підключення MCP-сервера pdr-search (крок 09)

Сервер і його межі — mcp-spec.md. Обидва підключення локальні (stdio; потрібна Ollama). Ключів у конфігураціях немає: ключ Gemini лише в .env.local (поза git).

## 1. Агент кодування — OpenCode 1.18.34
- Конфігурація: opencode.json, блок mcp → "pdr-search": { type: "local", command: ["npx", "tsx", "scripts/mcp-server.ts"], enabled: true }.
- Перевірка: opencode mcp list → «✓ pdr-search connected» (поруч ✓ context7).
- Виклик (2026-10-14, сесія ses_ec69024b2ffeLbph0e4Frv0hAF, модель Big Pickle): інструмент pdr-search_search_pdr, вхід { query: "максимальна швидкість поза населеним пунктом водій зі стажем до 2 років", k: 5 }, статус completed; відповідь агента «70 км/год (pdr-12#0001, п. 12.6 б)», 15,4 с.
- Доказ: traces/mcp-opencode-session.json (експорт сесії: інструмент, вхід, статус, вихід); журнал дій OpenCode — .agent-log/opencode.jsonl, рядок 85 (tool pdr-search_search_pdr, та сама сесія).
- Перша спроба (сесія ses_ec69d45…): два паралельні виклики завершились «Tool execution aborted» (interrupted) — OpenCode закрили через ~11 с, поки виконувався перший виклик (холодний старт: запуск сервера через npx tsx + завантаження індексу й моделі Ollama).

## 2. Застосунок — чат Next.js, маршрут app/api/pdr
- Клієнт: @ai-sdk/mcp 2.0.74 — createMCPClient + Experimental_StdioMCPTransport (npx tsx scripts/mcp-server.ts); інструменти сервера передаються в ToolLoopAgent (gemini-3.1-flash-lite, stopWhen isStepCount(5)); телеметрія Langfuse — functionId lab2-pdr-chat. Клієнт створюється на кожен запит і закривається після відповіді.
- Виклик (2026-10-14): POST /api/pdr «Яка максимальна швидкість поза населеним пунктом для водія зі стажем до 2 років?» → toolCalls [{ tool: "search_pdr", input: { query: "максимальна швидкість водій стаж до 2 років поза населеним пунктом" } }]; відповідь «Для водіїв зі стажем до 2 років максимальна швидкість руху поза населеними пунктами становить не більше 70 км/год [pdr-12#0001]»; токени 2797 / 80.
- Доказ: traces/mcp-app-call.json (відповідь API разом зі списком викликів інструментів); траса — Langfuse, functionId lab2-pdr-chat.
- На Vercel маршрут повертає 503 «лише локально»: задеплоєна функція не може запустити процес сервера й не має Ollama.

## 3. Що відрізнялося між підключеннями
| | OpenCode | Застосунок (чат Next.js) |
|---|---|---|
| Назва інструмента для моделі | pdr-search_search_pdr (OpenCode додає назву сервера) | search_pdr |
| Хто й коли запускає сервер | OpenCode — під час старту сесії | маршрут — на кожен запит, потім закриває |
| Аргументи від моделі | query і k = 5 (у першій спробі — лише query) | лише query — спрацювало типове k = 5 |
| Модель | Big Pickle (OpenCode Zen) | gemini-3.1-flash-lite |
| Де ключі | у конфігурації немає | GOOGLE_GENERATIVE_AI_API_KEY з .env.local (Next.js читає сам) |

## 4. Що довелося змінити в сервері й навколо
- scripts/mcp-server.ts: шлях до data/index.json — через import.meta.url, а не відносно поточної теки: сервер запускають різні клієнти з різних тек, а в режимі ESM змінної __dirname немає (сервер падав з «__dirname is not defined» при першому запуску окремим процесом).
- tests/mcp-search.test.ts: додано тест на виклик без k — так викликає застосунок, а попередні тести завжди передавали k.
- app/api/pdr/route.ts: явне приведення інструментів @ai-sdk/mcp до ToolSet — пакети по-різному описують тип схеми в режимі exactOptionalPropertyTypes (формат інструментів той самий).
- Холодний старт першого виклику ~10+ с — клієнтові треба дочекатися відповіді (у першій спробі OpenCode закрили раніше).
