# Фабрика задач — Лабораторна 3, крок 00

## 1. Який агент і модель — і чому
- Виконавець: **OpenCode** (`opencode run --format json`), модель **opencode/big-pickle** (OpenCode Zen, безкоштовна, хмарна).
- Верифікатор (крок 02): Gemini 3.1 Flash-Lite — інша родина, ніж виконавець.
- Що пробували спершу і чому відмовились (2026-11-01):
  - OpenCode + Ollama **qwen3.5:4b** (контекст 16k): `opencode run` не відповів за 3 хв 48 с. Пряма перевірка Ollama: 48 с на «2+2» через режим роздумів; `think:false` через OpenAI-сумісний API ігнорується (58,4 с, порожня відповідь), `reasoning_effort:"none"` — 1,4 с. Але в агенті все одно висіло: журнал Ollama — `forcing full prompt re-processing … hybrid/recurrent memory` (гібридна модель без кешу запиту) і запити в черзі по 1 хв 20 с; модель лише частково на GPU (21% CPU / 79% GPU).
  - OpenCode + Ollama **qwen3:4b** (16k, без роздумів): за 2+ хв відповіді немає.
  - Висновок: на MacBook Air 16 ГБ локальна модель не тягне агентний цикл OpenCode; перейшли на Big Pickle — «2+2» за 8,8 с.

## 2. Форма задачі (`docs/lab3/tasks.jsonl`, UTF-8 без BOM)
`{ id, input, acceptance: [команди], budget: { max_turns, max_usd, timeout_s }, files? }`.
Успіх задачі визначає не агент, а **машинна перевірка**: усі команди `acceptance` мають завершитися з кодом 0. У черзі 6 задач (t-01…t-06).

## 3. Хто що робить
- `scripts/harness/run-task.ts` — виконавець однієї задачі: ядро `executeTask` (ліміти, статус, запис артефактів) + справжні залежності `realDeps` (git worktree, OpenCode, перевірки).
- `scripts/harness/run-queue.ts` — черга: задачі по одній.
- `tests/harness/run-task.test.ts` — 5 тестів на підробленому агенті, без мережі: успіх, агент упав, перевищено ліміт ходів, перевірка не пройшла, лічильник ходів і вартості.

## 4. Де артефакти
Один прогін = тека `runs/<id>/<час>/` з чотирма файлами: `patch.diff` (зміни агента), `output.txt` (вивід перевірок), `agent.log` (сирі JSON-події OpenCode), `run.json` (журнал: статус, тривалість, ходи, вартість, бюджет, перевірки, змінені файли, гілка).
Сира `runs/` — у `.gitignore`; відібрані прогони — у `docs/lab3/runs/`.

## 5. Ізоляція і дозволи
- Кожна задача — окремий **git worktree** `../harness-runs/<id>-<час>` на гілці `harness/<id>-<час>` від `main`; зміни комітяться в цю гілку, worktree видаляється. Основна тека після всієї черги — `git status --short` порожній.
- Дозволи — явний перелік у `scripts/harness/opencode.harness.json`: редагування файлів — так; з команд оболонки дозволено лише `npm test`, `npx vitest`, `npx tsc`, `npm run typecheck`, `npm run lint`, `git status`, `git diff`; решта — `deny`; webfetch — `deny`. Прапорець `--auto` («dangerous») і будь-який обхід дозволів не використовуються. Це відповідник `dontAsk` + `--allowedTools` для OpenCode.
- Ліміти: ходи — рахуються за подіями `step_start` і зупиняють агента при перевищенні; вартість — сума полів `cost` у подіях; таймаут — `timeout_s`, процес зупиняється сигналом.

## 6. Як перезапустити
- Одна задача: `npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01`
- Уся черга: `npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl`
- З публікацією гілки артефакту: додати `--push`.
- Передумова: `opencode` в PATH і вхід у OpenCode Zen; модель можна змінити змінною `HARNESS_MODEL`.

## Результати першого прогону черги (2026-11-02)
| Задача | Статус | Час | Ходи | Змінені файли |
|---|---|---|---|---|
| t-01 | pass | 26,7 с | 6 | tests/rrf-extra.test.ts |
| t-02 | pass | 54,2 с | 10 | src/metrics.ts, tests/median.test.ts |
| t-03 | pass | 35,9 с | 7 | src/rag/stopwords.ts, tests/stopwords.test.ts |
| t-04 | **timeout** | 300,6 с | 0 | — (перший запуск: агент чекав stdin) |
| t-04 | pass | 27,8 с | 7 | README.md |
| t-05 | pass | 33,4 с | 8 | tests/cite-extra.test.ts |
| t-06 | pass | 34,3 с | 6 | tests/chunk-extra.test.ts |

6 із 6 задач — pass; вартість $0 (безкоштовна модель). Прогін із таймаутом — доказ, що зупинка за часом працює: журнал записано, worktree прибрано. Причина — виконавець не закривав stdin, і `opencode run` чекав введення; виправлено `stdio: ['ignore', 'pipe', 'pipe']` (коміт 8082fa0).
Докази — `docs/lab3/runs/` (t-01…t-06 і t-04-timeout).
