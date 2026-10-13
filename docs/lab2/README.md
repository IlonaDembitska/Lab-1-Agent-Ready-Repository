# Лабораторна 2 — пакет доказів

Асистент із Правил дорожнього руху України з гібридним пошуком і цитуванням джерел; MCP-сервер — кроки 08–09.
Автор: Ілона Дембіцька · Репозиторій: той самий, що в Лабораторній 1 · Стан: ЧЕРНЕТКА — кроки 00–07 готові, 08 підготовлено, 08–09 після заняття 08.

## 1. Числа «до» і «після» (повністю — [eval-report.md, розділ «Підсумок»](eval-report.md))
| Показник | Без пошуку (baseline.md) | З пошуком (eval-run.json) |
|---|---|---|
| Точність, correct / 17 | 64,7% | 64,7% (± 23 п. п., обчислено) |
| Вигадані відповіді (wrong) | 4 | 0 |
| Правильні відмови (unanswerable) | 0 / 3 | 3 / 3 |
| Відповіді з цитатою / з правильною цитатою | 0% | 100% / 94,1% |
| Стійкість до injection | 2 / 2 | 1 / 2 → 2 / 2 після виправлення |
| recall@8 / MRR@8 | — | 0,94 / 0,82 |
| Медіана затримки | 3,9 с | 14,1 с |
| Вартість за прайсом на 100 запитів | $0.016 | $0.093 |

Висновок, який можна перевірити повторним прогоном: на 17 запитах пошук не змінив точність, але прибрав усі вигадки, дав 3/3 правильних відмов і цитату в кожній відповіді; решта провалів — межа фрагментів у п. 12.6 і ранжування RRF.

## 2. Зміст пакета
| Файл | Крок | Що доводить |
|---|---|---|
| [spec.md](spec.md) | 00 | цілі G1–G5, критерії A1–A5, non-goals, 26 документів із ліцензією; розділ 9 — MCP-сервер і застосунок |
| [golden/queries.jsonl](golden/queries.jsonl), [eval-set.md](eval-set.md) | 01 | 20 запитів (3 unanswerable, 2 injection), заморозка bad4ca7 |
| [baseline.md](baseline.md), [baseline-raw.jsonl](baseline-raw.jsonl) | 01 | базова лінія без документів |
| [subagents.md](subagents.md) | 02, 07 | spec-auditor і explorer (read-only), доказ ізоляції, залежності субагентів |
| [verifier.md](verifier.md), [calibration/](calibration/) | 03 | qwen3.5:4b як брама, калібрування 80% → 86%, два справжні стопи з виправленнями, межа 12 000 символів |
| [indexing.md](indexing.md) | 04 | 26 документів → 164 фрагменти, правило 1200/200/120, відтворюваність |
| [retrieval.md](retrieval.md) | 05 | BM25 + вектор → RRF, запити-докази з рангами, поріг відмови 0,72, приклад відповіді з цитатою |
| [eval-report.md](eval-report.md), [eval-run.json](eval-run.json), [eval-run-vs-baseline.diff](eval-run-vs-baseline.diff) | 06 | «до/після» тією самою методикою, recall@k і MRR, 4 помилки за класами |
| [budget.md](budget.md), [parallel-run.json](parallel-run.json) | 07 | граф залежностей, бюджет до запуску, ширина 1/2/4/8, лічильники Ollama, маршрутизація |
| [mcp-spec.md](mcp-spec.md) | 08 | чернетка: search_pdr, межі, 6 сценаріїв зловживання (код — після заняття 08) |
| mcp-integration.md | 09 | після заняття 08 |
| [traces/](traces/) | 02, 06, 07 | скріншоти: ізоляція субагента, звіт spec-auditor, eval-run, parallel-before/after |
| [autonomy-log.md](autonomy-log.md) | усі | журнал автономності, 11 сесій, 04–13.10.2026 |

## 3. Ключові коміти
| Крок | Коміти |
|---|---|
| 00 специфікація | [7fe4fcc](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/7fe4fcc), [41657d9](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/41657d9), [9076a34](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/9076a34) |
| 01 заморозка набору | [bad4ca7](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/bad4ca7) |
| 02 субагенти | [151ea71](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/151ea71), [02e4d40](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/02e4d40) |
| 03 верифікатор | [bddef04](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/bddef04), [2788f64](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/2788f64) (ручна розмітка до прогону), [3c41923](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/3c41923), [bf3f39e](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/bf3f39e); стоп 1: [a674738](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/a674738) → [28bdab1](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/28bdab1); стоп 2: [09272bf](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/09272bf) → [65e3f86](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/65e3f86) |
| 04 індексація | [3e631f3](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/3e631f3) (правило до коду), [ca36a37](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/ca36a37) |
| 05 пошук | [e8751a3](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/e8751a3), [274dcef](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/274dcef) |
| 06 оцінювання | [05ef5ee](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/05ef5ee), [09272bf](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/09272bf), [65e3f86](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/65e3f86), [7ac0822](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/7ac0822) |
| 07 паралельність | [d8b7d54](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/d8b7d54) (бюджет до запуску), [56100fd](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/56100fd), [3ae0dd6](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/3ae0dd6) |
| 08 підготовка | [9fb3550](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/commit/9fb3550) |

## 4. CI
- Зелений прогін CI на main: [CI #67, коміт faa05a4](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions/runs/38312098563); усі прогони — [Actions](https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository/actions?query=branch%3Amain)
- Тести без мережі й ключів:  тестів, зокрема validate-golden, verify (схема), chunk, index, rag, answer, metrics, eval-run, parallel-eval

## 5. Інструменти й моделі
| Що | Версія |
|---|---|
| Node.js | v24.21.0 |
| ai (AI SDK) / @ai-sdk/google | 7.0.107 / 4.0.76 |
| Ollama | 0.40.3 |
| Модель відповідей | gemini-3.1-flash-lite (Google, безкоштовний рівень) |
| Ембедер | embeddinggemma-2:270m (Ollama, 768 вимірів) |
| Верифікатор (брама) | qwen3.5:4b (Ollama) |
| Агент кодування / субагенти | OpenCode 1.18.34 (субагенти — gemini-3.1-flash-lite) |
| Асистент у чаті | claude.ai, Claude Opus 5.5 (див. autonomy-log.md) |
| Траси | Langfuse (cloud) |

## 6. Як відтворити
1. npm ci; скопіювати .env.example у .env.local і вписати GOOGLE_GENERATIVE_AI_API_KEY (Langfuse — за бажанням).
2. ollama pull embeddinggemma-2:270m і ollama pull qwen3.5:4b.
3. Індексація: npm run index (26 документів → data/index.json).
4. Пошук із поясненням: npx tsx scripts/search.ts "питання" --explain; по всьому набору — npx tsx scripts/search.ts --golden.
5. Відповідь із цитатами: npx tsx --env-file=.env.local scripts/ask.ts "питання".
6. Оцінювання: npx tsx --env-file=.env.local scripts/eval-run.ts, підсумок — npx tsx scripts/eval-run.ts --summary docs/lab2/eval-run.json.
7. Паралельність: npx tsx --env-file=.env.local scripts/parallel-eval.ts 4.
8. Брама: git diff main...HEAD > docs/lab2/verify-input.diff; npm run verify.
9. MCP-сервер: після заняття 08.

## 7. Відтворюваність із чистого клону (перевірено 2026-10-13)
git clone репозиторію в /tmp/clean-clone (коміт faa05a4): .env.local у клоні немає; npm test — 143 тести в 18 файлах зелені без ключів і без Ollama; typecheck, lint, валідатор набору — OK. Повне встановлення з нуля щоразу виконує CI (посилання вище).
