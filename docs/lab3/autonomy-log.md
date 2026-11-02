# Журнал автономності — Лабораторна 3

## Сесія 1 · 2026-11-01/02

| Поле | Значення |
|---|---|
| Шлях агента і модель | виконавець — OpenCode 1.18 · opencode/big-pickle; асистент у чаті — claude.ai · Claude Opus 5.5 (код харнесу) |
| Режим дозволів | OpenCode — явний перелік у scripts/harness/opencode.harness.json (edit allow; bash лише тести/типи/лінт/git status/diff; решта deny), без --auto |
| Спосіб ізоляції | git worktree на кожну задачу (../harness-runs/<id>-<час>), гілка harness/<id>-<час> |
| Задача | крок 00: черга задач, виконавець, артефакт і журнал на кожну задачу |
| Що згенерував агент | у чаті — tasks.jsonl, run-task.ts, run-queue.ts, тест; OpenCode — зміни в 6 задачах (тести, median, stopwords, розділ README) |
| Що змінила я | обрала виконавця після вимірів: qwen3.5:4b і qwen3:4b через Ollama не впорались (3 хв 48 с без відповіді; журнал Ollama — немає кешу запиту для гібридної моделі), перейшла на Big Pickle; знайшла, що reasoning_effort none пришвидшує qwen з 48 до 1,4 с, а think:false ігнорується |
| Де втрутилась і чому | перший прогін t-04 — timeout 300,6 с, 0 ходів: виконавець не закривав stdin; виправили (8082fa0), повтор — pass |
| Які докази прийняла | 161 тест (5 нових на підробленому агенті), typecheck, lint; черга 6/6 pass, 27–54 с на задачу, $0; git status основної теки порожній після прогонів; docs/lab3/runs/ |

## Сесія 2 — 2026-11-02, крок 01 (gates)

- Що робили: `.github/workflows/gates.yml` (types → lint → tests → build через `needs`, `timeout-minutes`, `concurrency`), job `record` + `scripts/harness/record-gates.mjs`, ruleset `main-gates`, `scripts/harness/jobs-table.mjs`, `docs/lab3/gates.md`.
- Що зламалось: push не проходив — VS Code підставляв старий токен через `GIT_ASKPASS`. Рішення: classic PAT (repo + workflow) у `osxkeychain`, токен у чат і в git не потрапляв.
- Gates #1 скасований через `concurrency` (новий коміт) — це очікувано, тригернули Gates #2 порожнім комітом → зелений.
- Червоний доказ: гілка `harness/red-2026-11-02` з тестом `1 + 1 = 3` → Gates #3: tests failure, build skipped. Гілку не зливаємо.
- Людина: створила ruleset у Settings, робила скріншоти. Агент: писав workflow, скрипти, документацію.

## Сесія 3 — 2026-11-02, крок 02 (верифікатор)

- Що робили: `src/verify/harness-verdict.ts` (V1–V4, строга zod-схема, `blocks`), `src/verify/agreement.ts` (raw + Cohen's κ), `scripts/harness/verifier.ts`, `scripts/harness/calibrate.ts`, 12 артефактів калібрування, job `verify` у `gates.yml`, `docs/lab3/verifier.md`.
- Що зламалось: `gemini-3.1-flash-lite` і `-preview` стабільно 503 «high demand». Додали повтори з паузою, що подвоюється, і продовження калібрування з місця зупинки; перевірили доступність моделей одним запитом і перейшли на `gemini-3.5-flash-lite`.
- Калібрування: 48 клітинок, 83.3%, κ = 0.592; рішення брами 12/12, κ = 1.0. Мітки після запуску не змінювали.
- Людина: перевірила й підтвердила розмітку до запуску, додала секрет у GitHub. Агент: код, тести, артефакти з дефектами, аналіз розбіжностей.
- Справжня зупинка в CI: Gates #9 (`harness/t-05-…`, справжній прогін агента) — verify success; Gates #8 (`harness/t-01-scope-demo`, артефакт c07) — 4 gates зелені, verify failure. Вердикти — `docs/lab3/verdicts/`.
