# Крок 06 — Зміцнення деплою: телеметрія, ліміти витрат, секрети

Гілка `lab4/step-06`, превʼю `lab-1-agent-ready-repository-git-lab4-step-06-ilona-projects.vercel.app`, дата перевірок 2026-11-12 (час нижче — UTC).
Журнал прогонів: `docs/lab4/prod-runs.jsonl`, знімки — `docs/lab4/traces/prod-*.json`, скан секретів — `docs/lab4/secret-scan.txt`.

## Чекліст

| # | Вимога | Стан | Доказ |
|---|--------|------|-------|
| 0 | `/api/health` з комітом, `/api/ready` з перевірками | ✅ | health повертає `commit` (VERCEL_GIT_COMMIT_SHA); ready: `{"key":true,"flagStore":true,"budget":true}` |
| 1 | Кожна задача → trace у Langfuse, знаходиться за `task_id`/`trace_id` | ✅ | `traced-01` → trace `8ea12876bf59382e57cd6eb1246f4368` (11:30); дерево: `invoke_workflow lab4-task` → `invoke_agent` → 2× `chat gemini-3.1-flash-lite` + tool `getTime` (скріншот) |
| 2 | Вимикач без деплою | ✅ | Global Config `agentEnabled:false` → `killswitch-01` HTTP **503 agent_disabled** (11:34), модель не викликалась (trace_id порожній); повернули `true` → `recovered-01` 200 (11:36) |
| 3 | Денний ліміт витрат | ✅ | Global Config `dailyLimits.requests=1` → `budget-01` HTTP **429 budget_exhausted (requests)**, лічильник Redis `requests:7` (11:35); `/api/ready` → `budget:false` |
| 4 | Секрети поза git, позначені Sensitive | ✅ | `secret-scan.txt`: 41 гілка/тег, фрагменти ключів Google і Langfuse не знайдені, у коміти потрапляв лише `.env.example`; LANGFUSE_* на Vercel — Sensitive (замок) |
| 5 | Периметр: WAF + захист превʼю | ✅ частково | WAF-правило `lab4-agent-rate-limit`: Request Path starts with `/api/` → **Log** (скріншот); Vercel Authentication увімкнено — запит без входу → **302** |
| 6 | Рішення щодо персональних даних | ✅ | див. розділ нижче |

## 1. Телеметрія

- `instrumentation.ts`: NodeSDK + OTLP-експортер у Langfuse (`/api/public/otel/v1/traces`), без ключів — NoopSpanProcessor.
- `withTaskSpan(taskId)` відкриває span `invoke_workflow lab4-task` з атрибутом `lab4.task_id`; відповідь API містить `trace_id`, тож трейс шукається за ID з журналу.
- `experimental_telemetry.functionId = task-<id>`, `recordInputs/recordOutputs: false`.

**Знахідки під час перевірки на проді (обидві виправлені):**
1. Трейси з проду не доходили, хоча локально працювали. Маршрут скидав буфер процесора, імпортованого з `instrumentation.ts`, — а це інша копія модуля, не та, що зареєстрована. Виправлення: `src/telemetry/flush.ts` скидає **глобальний** провайдер (`trace.getTracerProvider().getDelegate().forceFlush()`) до того, як Vercel заморозить функцію (коміт `7d9c783`).
2. Після цього все одно порожньо. Діагностичний маршрут `/api/telemetry-check` (повертає лише адресу, префікс публічного ключа і назву проєкту) показав **401**: значення LANGFUSE_* на Vercel були вставлені з `.env.local` **разом з лапками** (`"pk-lf-…"`). Телеметрія мовчки втрачалась. Виправлення: `src/telemetry/env.ts` знімає пару лапок по краях, тести `tests/telemetry-env.test.ts` (коміт `6144ec5`). Після — 200, проєкт `My Project`, трейси є.

Висновок для харнесу: «телеметрія налаштована» ≠ «телеметрія доходить». Перевірка мусить шукати конкретний `trace_id` у бекенді, а не дивитись на відсутність помилок.

## 2. Вимикач (kill switch)

- `src/flags.ts`: прапорець `agentEnabled` у Vercel Global Config (колишній Edge Config), читається на кожен запит; рядок підключення — `GLOBAL_CONFIG` або `EDGE_CONFIG`.
- Лише явне `true` вмикає. Сховище недоступне → **вимкнено** (fail-closed).
- `guard()` стоїть до будь-якого виклику моделі в `/api/agent` і `/api/multimodal`.
- Обмеження Hobby: 100 записів у Global Config на місяць — тому там лише прапорець і межі, а лічильники — у Redis.

## 3. Ліміти витрат

- `src/budget.ts`: лічильники за день у Upstash Redis (`lab4:budget:YYYY-MM-DD`, атомарний `HINCRBY`, TTL 2 доби): запити, вхідні й вихідні токени.
- Межі за замовчуванням 150 запитів / 300 000 вхідних / 30 000 вихідних токенів; перевизначаються ключем `dailyLimits` у Global Config без деплою.
- Redis недоступний → відмова (`counter_store_unavailable`), не «безлімітний режим».
- Usage пишеться після кожної успішної відповіді (`recordUsage(result.totalUsage)`).

## 4. Секрети

- Секрети лише в `.env.local` (у `.gitignore`) і в змінних Vercel; у git — тільки `.env.example`.
- Скан історії (`secret-scan.txt`): `git log --all -S <фрагмент>` для ключа Google і секрету Langfuse — порожньо; `.env*` у комітах — лише `.env.example`. Фрагмент ключа брався з `.env.local` у змінну оболонки і не друкувався.
- Урок зі знахідки 2: вставляючи значення у Vercel, копіювати **без лапок**; код тепер це витримує, але правильне джерело — чисте значення.

## 5. Периметр

- WAF: правило `lab4-agent-rate-limit` (path starts with `/api/`) з дією **Log** — спершу спостерігаємо, кого б зачепило, не блокуючи. На Hobby дія Rate Limit у формі недоступна; при переході на Pro — змінити на Rate Limit 20 запитів / 60 с / IP.
- Deployment Protection: Vercel Authentication (Standard) знову увімкнено (у кроці 05 вимикали для скриптів). Перевірка: запит без входу → 302 на логін.

## 6. Персональні дані — рішення

- У трейсах **немає** текстів запитів і відповідей: `recordInputs: false`, `recordOutputs: false`. Langfuse бачить структуру (кроки, інструменти, токени, час), але не зміст.
- Журнал `prod-runs.jsonl` зберігає `task_id`, статус, `trace_id`, usage і лічильники — без промптів і відповідей.
- Redis тримає лише числа за день; Global Config — лише прапорець і межі.
- `/api/telemetry-check` не повертає секретів (тільки адресу, 12 символів публічного ключа, назву проєкту).
- Хто має доступ: Langfuse — власниця проєкту; превʼю Vercel — лише учасники команди після входу.

## Відкриті пункти

- **Protection Bypass for Automation** не створено: діалог Vercel зависав у Safari. Без нього скрипти не пройдуть на превʼю (302). Зробити в Chrome перед кроком 07, секрет — у `.env.local` як `VERCEL_BYPASS`.
- **Shareable Link** для викладача — на тій самій сторінці Deployment Protection, разом із bypass.
- Перевірити, що `GOOGLE_GENERATIVE_AI_API_KEY` на Vercel теж має позначку Sensitive (для LANGFUSE_* підтверджено).
