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
