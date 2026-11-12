# q5 (multi) — Що перевіряє CI цього проєкту і де це описано?


CI цього проєкту перевіряється через GitHub Actions у файлі .github/workflows/ci.yml. Він виконує тести на матриці версій Node.js та io.js від 0.8 до 17.x, запускає лінтинг коду за допомогою eslint, а також збирає та завантажує покриття коду через Coveralls.

1. Перехід на GitHub Actions замість Travis CI у файлі .github/workflows/ci.yml — https://github.com/IlonaDembitska/bytes.js/commit/2f6d5cc

Верифікатор (qwen3.5:4b): усі 1 тверджень — pass.
