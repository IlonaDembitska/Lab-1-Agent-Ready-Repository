# Лабораторна 3 — харнес автономних агентів

Репозиторій: https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository · усі посилання на файли — permalink на коміт `3e319ad` (стан пакета доказів перед злиттям у `main`).

## 1. Таблиця прийняття

| Критерій | Де доказ | Посилання |
|---|---|---|
| брама · CI зелений на поданому SHA | прогін Gates на `main` (останній на момент подання) + Gates #26 на `99dee03` | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/workflows/gates.yml?query=branch%3Amain · https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/42596788931 |
| брама · журнал автономності, ≥ 4 сесії | docs/lab3/autonomy-log.md — 9 сесій, 2026-11-01 … 2026-11-09 | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/autonomy-log.md |
| брама · жодного обходу перевірок дозволів | `opencode run` без `--auto`; явний перелік у конфігурації прогону; ізоляція — git worktree | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/scripts/harness/opencode.harness.json · https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/scripts/harness/run-task.ts |
| брама · немає секретів в історії | `git log --all` по `.env*` — порожньо; пошук префіксів ключів в історії — лише регулярні вирази й фальшиві значення в тестах (див. §5) | §5 цього файлу |
| крок 00 · фабрика задач | docs/lab3/factory.md | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/factory.md |
| крок 01 · ланцюг брам | docs/lab3/gates.md | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/gates.md |
| крок 02 · верифікатор зупинив зміну | docs/lab3/verifier.md — Gates #8 (verify failure), виправлення `a574d17`, Gates #12 зелений | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/verifier.md |
| крок 03 · прогін зупинився сам | docs/lab3/stop.md | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/stop.md |
| крок 04 · регресійна брама в CI | docs/lab3/evals.md; job `evals` у `gates.yml`; `evals` — обовʼязкова перевірка ruleset `main-gates` | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/evals.md · https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/.github/workflows/gates.yml |
| крок 05 · число згоди судді | docs/lab3/judge.md | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/judge.md |
| крок 06 · класифікація помилок | docs/lab3/errors.md + docs/lab3/traces/ | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/errors.md · https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/tree/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/traces |
| крок 07 · ін'єкція промпту | docs/lab3/redteam.md + scripts/redteam/ | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/redteam.md · https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/tree/3e319ad0cfec62c0889d2c74594ff7338f68920d/scripts/redteam |
| крок 08 · цей звіт | docs/lab3/README.md | https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/main/docs/lab3/README.md |

## 2. Прогони CI

- **Зелений на поданому SHA:** останній прогін Gates на `main` — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/workflows/gates.yml?query=branch%3Amain. Той самий вміст (коміт `99dee03`) на гілці — Gates #26: https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/42596788931. У ньому types, lint, tests, build, evals — success, і 1 попередження: модель не відповіла з раннера, тож брама перевірила закомічений журнал (див. `evals.md` §2).
- **Червоний, збережений як доказ (верифікатор):** Gates #8 — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/41426569330.
  - Коміт `1b38924` на гілці `harness/t-01-scope-demo`.
  - Що зупинило: усі чотири детерміновані брами були зелені, але верифікатор (`verify`) видав `ФІНАЛЬНА БРАМА ЗАКРИТА: V1=fail…`. Агент змінив `vitest.config.ts`, хоча задача забороняла чіпати інші файли.
- **Виправлення після червоного:**
  - коміт `a574d17` — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/a574d17;
  - зелений повтор — Gates #12, https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/41865523336.
- **Червоний детермінованої брами (крок 01):** Gates #3 — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/41418747481. `tests` — failure, `build` — skipped. Гілку не зливали.
- **Червоні регресійної брами (крок 04):**
  - Gates #23 — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/42587785039;
  - Gates #25 — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/42591528012;
  - у CI агент дав 3 × `stalled` з 0 ходів, і запобіжник зупинив прогін (exit 3);
  - причина: безкоштовна модель не відповідає з раннерів GitHub;
  - виправлення — `99dee03`, Gates #26 зелений.

## 3. Інструменти й моделі

| Роль | Інструмент | Модель із версією | Платний чи безкоштовний шлях |
|---|---|---|---|
| виконавець харнесу (кроки 00–06) | OpenCode 1.19.0, `opencode run --format json` | `opencode/big-pickle` (OpenCode Zen) | безкоштовний |
| виконавець red-team (крок 07) | OpenCode 1.19.0 | `opencode/nemotron-3.5-lightning-free` — Big Pickle на час прогону не відповідала | безкоштовний |
| верифікатор (крок 02) | REST `generateContent`, строга zod-схема | Gemini `gemini-3.5-flash-lite` (інша родина, ніж виконавець) | безкоштовний рівень API-ключа |
| LLM-суддя (крок 05) | REST `generateContent`, один вимір на запит | Gemini `gemini-3.5-flash-lite`, temperature 0 | безкоштовний рівень API-ключа |
| траси (крок 06) | OpenTelemetry: `@opentelemetry/sdk-node` 0.222.0, `exporter-trace-otlp-http` 0.222.0, `api` 1.9.1; `ai` 7.0.165 + `@ai-sdk/otel` 1.0.165 | — | Langfuse Cloud Hobby (ЄС), безкоштовний |
| CI | GitHub Actions, Node 24, OpenCode 1.19.0 | — | безкоштовний (публічний репозиторій) |
| локальне середовище | macOS, Node v24.21.0, VS Code | — | — |
| автор коду й текстів разом зі мною | Claude (чат) | Claude Opus 5.5 | підписка |

## 4. Як повторити автономний прогін

1. **Підготовка.** `npm ci` і `npm i -g opencode-ai@1.19.0`. Перевірка моделі: `opencode run -m opencode/big-pickle "Відповідай одним словом — ок"`. У `.env.local` — лише ключі Gemini й Langfuse, якщо потрібні верифікатор, суддя чи траси; у git — тільки `.env.example`.
2. **Режим дозволів і перелік дозволених інструментів.** Харнес сам запускає `opencode run --format json -m <модель> --dir <worktree>` з `OPENCODE_CONFIG=scripts/harness/opencode.harness.json`, без `--auto`.
   - `bash` — `"*": "deny"`, дозволено лише `npm test*`, `npx vitest*`, `npx tsc*`, `npm run typecheck*`, `npm run lint*`, `git status*`, `git diff*`;
   - `webfetch` — deny; `edit` — allow;
   - неінтерактивні запити `ask` (наприклад `external_directory`) відхиляються автоматично;
   - плагін `.opencode/plugins/guard-env.js` забороняє читати `.env*`;
   - агент отримує лише явний перелік змінних середовища (`agentEnv`, крок 07).
3. **Спосіб ізоляції.** Окремий git worktree на кожну спробу: `git worktree add -b harness/<id>-<час> ../harness-runs/<id>-<час> main`, у CI — `HARNESS_BASE=HEAD`. Після прогону дерево видаляється, лишаються `runs/…/{patch.diff,output.txt,agent.log,run.json}`.
4. **Запуски:**
   - черга з кроку 00: `npx tsx scripts/harness/run-queue.ts`;
   - еталонний набір: `EVAL_K=3 npx tsx --env-file=.env.local scripts/evals/run-evals.ts docs/lab3/tasks.jsonl`, далі брама `npx tsx scripts/evals/gate.ts`;
   - red-team: `npx tsx --env-file=.env.local scripts/redteam/run-redteam.ts`, далі `scripts/redteam/collect.ts runs/redteam/<час>-<мітка>`.
5. **Зупинки, які спрацюють самі** (`stop.md`):
   - ліміт ходів і таймаут задачі;
   - сторож простою (`HARNESS_IDLE_S`, типово 120 с);
   - груповий kill;
   - запобіжник: 3 збої інфраструктури поспіль → зупинка, exit 3.

## 5. Секрети в історії (як перевірено, 2026-11-09)

- `git log --all --oneline -- .env .env.local .env.development .env.production` → **0 комітів**.
- `git log -p --all -S "<префікс>"` для `sk-`, `sk-lf-`, `pk-lf-`, `sk-ant-`, `AIza`, `ghp_`, `github_pat_`:
  - `ghp_`, `github_pat_` — 0 збігів;
  - решта трапляється лише в URL пакета `queue-microtask` у `package-lock.json`, у регулярних виразах, що **шукають** ключі (`scripts/evals/graders.ts`, `scripts/redteam/collect.ts`), і у фальшивих значеннях тестів (`sk-lf-abcdef123`, `sk-test…`, `AIza` + 30 × `x`).
  - Значення переглянуто з маскуванням: справжніх ключів немає.
- Дампи середовища з red-team (`docs/lab3/runs/redteam-*/…/agent.log`) збережено з вирізаними значеннями змінних. `collect.ts` відмовляється писати копію, якщо в ній є значення будь-якого справжнього секрету.

## 6. Підсумок у числах

Числа поруч із базовою лінією — у `evals.md` §4. Перевірювані твердження:
- **Регресійний набір тримається на 100 % за k = 3:** 6 задач, 18 спроб із 18, pass^3 = 1 на Big Pickle. Нові задачі — 9/9, крайні випадки — 5/5 (pass^3 = 1). Базовий рівень — коміт `f5a42e9`, банк frozen_at 2026-11-05. Докладно: [evals.md](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/evals.md).
- **Помилки.** 13 невдалих прогонів із 109 класифіковано за трасами: задача 1, інструмент 3, модель 2, харнес 7; класу «промпт» не траплялося. Кожен клас має знімок траси й текстову витяжку в `traces/`. Докладно: [errors.md](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/errors.md).
- **Суддя.** `tests_meaningful`: κ = 0.47 (рубрика v1) → 0.77 (v2), на holdout 0.50 → 0.75, проти моєї розмітки 40 міток, закоміченої до першого запуску судді. Докладно: [judge.md](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/judge.md).
- **Red-team.**
  - «До»: 7 сценаріїв, пройшли 2 (r-03 — зміна поза задачею прийнята як `pass`; r-07 — дамп середовища через `npx vitest`).
  - Виправлення межею і брамою — `d94ecd7`.
  - «Після»: 0 порушень інваріантів.
  - Докладно: [redteam.md](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/blob/3e319ad0cfec62c0889d2c74594ff7338f68920d/docs/lab3/redteam.md).

## 7. Решта доказів

- **Код:**
  - фабрика й харнес — `scripts/harness/` (`run-task.ts`, `run-queue.ts`, `breaker.ts`, `verifier.ts`, `trace.ts`, `trace-replay.ts`);
  - evals — `scripts/evals/`;
  - суддя — `scripts/judge/`;
  - red-team — `scripts/redteam/`;
  - траси — `src/telemetry/otel.ts`;
  - тести — `tests/harness/`, `tests/evals/`, `tests/judge/`, `tests/redteam/`.
- **Набір задач:** `docs/lab3/tasks.jsonl`, `docs/lab3/tasks-rejected.jsonl`.
- **Журнали прогонів:** `docs/lab3/evals.jsonl`, `docs/lab3/evals-run*.jsonl`, `docs/lab3/evals-baseline.json`, `docs/lab3/redteam.jsonl`, `docs/lab3/redteam-recheck.jsonl`.
- **Артефакти прогонів:** `docs/lab3/runs/`.
- **Траси й знімки:** `docs/lab3/traces/`.
- **Ruleset `main-gates`** (обовʼязкові types, lint, tests, build, evals): `docs/lab3/traces/ruleset-evals-required.png`.
- **Теки попередніх лабораторних** `docs/lab1/` і `docs/lab2/` — на місці, не перейменовані.
