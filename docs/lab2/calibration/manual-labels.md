# Калібрування верифікатора — ручна розмітка

Розмітила: Ілона, 2026-10-12, ДО запуску верифікатора (див. дату коміту).
Правило: pass — у самій зміні є прямий доказ виконання критерію; fail — доказ порушення; unknown — даних у зміні недостатньо.
Критерії — spec.md, розділ 6 (A1–A5). Зміни — diff комітів Лаб. 2 у цій теці (`git show --format= <sha>`).

| № | Коміт | Що змінено | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|---|
| 01 | 38d1957 | валідатор + 9 тестів | unknown | unknown | unknown | unknown | unknown |
| 02 | 0babdea | queries.jsonl (10 питань) + журнал | unknown | fail | unknown | unknown | unknown |
| 03 | bad4ca7 | queries.jsonl до 20 + eval-set.md | unknown | pass | unknown | unknown | unknown |
| 04 | 9b02eb1 | скрипт базової лінії + 4 тести | unknown | unknown | unknown | unknown | unknown |
| 05 | 5db2df7 | baseline.md + сирі відповіді | unknown | unknown | unknown | pass | unknown |
| 06 | 045b378 | крок валідатора в CI + доповнення | unknown | pass | unknown | unknown | unknown |
| 07 | 151ea71 | конфігурації субагентів + журнал | unknown | unknown | unknown | unknown | unknown |
| 08 | bddef04 | схема й скрипт верифікатора + тести | pass | unknown | unknown | unknown | unknown |
| 09 | 0d1fa48 | верифікатор на прямих запитах до Ollama | unknown | unknown | unknown | unknown | unknown |
| 10 | 02e4d40 | текст subagents.md | unknown | unknown | unknown | unknown | unknown |
