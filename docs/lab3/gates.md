# Крок 01 — детерміновані gates

Файл: `.github/workflows/gates.yml` (workflow **Gates**). Запускається на кожен `push` і `pull_request`.
Чотири gates йдуть ланцюжком через `needs`: **types → lint → tests → build**. Порядок — від найдешевшого до найдорожчого: якщо падає дешевий gate, дорогі не запускаються (fail fast, економія хвилин). Після них job **record** (`if: not cancelled()`) збирає вердикти в один файл.

## Що доводить кожен gate

| gate | команда | що доводить | вартість / час | що записує |
|---|---|---|---|---|
| types | `npm run typecheck` | код компілюється, немає помилок типів | найдешевший, timeout 5 хв | `gate-types.log`, output `verdict` |
| lint | `npm run lint` | немає порушень ESLint (стиль, невикористаний код, підозрілі конструкції) | дешевий, timeout 5 хв | `gate-lint.log`, output `verdict` |
| tests | `npm test` + `validate-golden` | поведінка не зламана: 161 тест Vitest (у т.ч. тести харнесу) і валідний golden set | середній, timeout 10 хв | `gate-tests.log`, output `verdict` |
| build | `npm run build` | застосунок реально збирається (Next.js) | найдорожчий, timeout 10 хв | `gate-build.log`, output `verdict` |
| record | `node scripts/harness/record-gates.mjs` | не gate — фіксує результат | секунди | `gate-record.json` (`gates`, `allPass`, `firstFailed`, sha, url) і `gate-run.json` (run.json агента + поле `gates`) |

Вартість у грошах — 0 $ (публічний репозиторій, хвилини GitHub Actions безкоштовні). Кожен gate записує свій вердикт у `$GITHUB_OUTPUT` (`pass`/`fail`), лог — як artifact `gate-<назва>`.

## Захист від зайвих запусків і зависань

- `concurrency: group = workflow + ref, cancel-in-progress: true` — новий push у ту саму гілку скасовує старий запуск. Доказ: **Gates #1** і **CI #82** (коміт `f85963a`) скасовані через 3–4 с, бо одразу прийшов коміт `543eb47` → **Gates #2** відпрацював повністю. Скріншот: `traces/gates-concurrency.png`.
- `timeout-minutes` на кожному job — завислий крок не з'їсть 6 годин.

## Ruleset `main-gates`

Settings → Rules → Rulesets → **main-gates**: Active, ціль — default branch (`main`), **Require status checks to pass**: `types`, `lint`, `tests`, `build`. Без зелених gates на тому самому коміті в `main` не потрапить нічого. Скріншот: `traces/gates-ruleset.png`.

## Доказ: зелений і червоний запуск

Зелений — **Gates #2** на гілці `lab3/step-01-gates`: усі чотири gates `success`, record зібрав `allPass: true`. Скріншот: `traces/gates-green.png`.

Червоний — **Gates #3** на окремій гілці `harness/red-2026-11-02`: туди навмисно додано `tests/harness/red.test.ts` з `expect(1 + 1).toBe(3)`. Результат: `types` і `lint` — success, **`tests` — failure**, `build` — **skipped** (не запускався через `needs`), `record` — success і записав `firstFailed: tests`. Скріншот: `traces/gates-red.png`. Гілку `harness/red-2026-11-02` **не зливаємо** — ruleset і так не пустив би її в `main`.

Час кожного job (дані з GitHub API, `node scripts/harness/jobs-table.mjs <run id>`):

**Gates #2** — `success` — гілка `lab3/step-01-gates`, коміт `543eb47` — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/41417172746

| job | результат | час, с |
|---|---|---|
| types | success | 25 |
| lint | success | 28 |
| tests | success | 30 |
| build | success | 43 |
| record | success | 7 |

**Gates #3** — `failure` — гілка `harness/red-2026-11-02`, коміт `5508fb4` — https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/41418747481

| job | результат | час, с |
|---|---|---|
| types | success | 29 |
| lint | success | 24 |
| tests | failure | 76 |
| record | success | 7 |
| build | skipped | 0 |

## Як відтворити

1. `git push` у будь-яку гілку → Actions → **Gates**.
2. Щоб побачити червоний gate: гілка з тестом, що падає (як `harness/red-2026-11-02`) → `tests` червоний, `build` skipped.
3. Результат запуску — artifact **gate-record** (`gate-record.json`, `gate-run.json`, `gate-logs/`).
