# Журнал автономності — Лабораторна 4

## Сесія 1 · 2026-11-12 · крок 00 (дослідження в режимі читання)

- **Інструмент і модель:** opencode 1.19.0 · `opencode/big-pickle` (безкоштовна)
- **Репозиторій, де працював агент:** форк https://github.com/IlonaDembitska/bytes.js, тека `~/lab4/bytes.js`, коміт `bfd9307` (нульова точка коду — `9ddc13b`)
- **Режим дозволів:** вбудований агент `plan` + конфігурація [opencode.readonly.json](opencode.readonly.json) через `OPENCODE_CONFIG`:
  - `edit`: `deny` — жодних змін файлів
  - `bash`: `"*": "deny"` першим, далі дозволено лише `ls*`, `cat *`, `grep *`, `git log*`, `git show*`, `git blame*`
  - `webfetch`: `deny` · `external_directory`: `deny`
  - без `--auto` і без обходу дозволів
- **Ізоляція:** окрема тека поза курсовим репозиторієм; агент запускався з кореня форка; контроль — `git status --short` одразу після прогону
- **Команда дослівно:**
  ```
  cd ~/lab4/bytes.js; OPENCODE_CONFIG=~/lab4/opencode.readonly.json opencode run --agent plan -m opencode/big-pickle "$(cat ~/lab4/agent-questions.txt)" | tee ~/lab4/agent-answer.txt; echo "agent=$?"; git status --short; echo "status-done"
  ```
- **Питання:** три питання з блоку «Агентне дослідження» (точки входу → `parse`; інваріанти `parse`; чого бракує)
- **Що агент зробив сам:** прочитав `package.json`, `index.js`, `Readme.md`, `.eslintrc.yml`, 3 файли тестів, `lab4-reports/depcruise.txt`; виконав дозволені `ls -la`, `ls -R`, `cat`; повернув відповідь із файлами й рядками. Повна відповідь — у форку: https://github.com/IlonaDembitska/bytes.js/blob/master/lab4-reports/agent-step00.txt
- **Що заблокували правила (доказ, що режим читання діє):**
  - `find . -type f … | head -100` → `Error: The user has specified a rule which prevents you from using this specific tool call`
  - `grep -n … Readme.md | head -60; cat .github/workflows/*` → та сама помилка
- **Результат:** `agent=0`; `git status --short` після прогону — **порожній** (агент нічого не змінив)
- **Що я перевірила за агентом:**
  - відкрила рядки `index.js` 142, 157, 169 і `test/byte-parse.js` 90–95 (`sed -n`) — збігаються з тим, що він назвав
  - прогнала його твердження через `node -e`: `parse('12abc')` → 12 ✔, `parse('1.5')` → 1 ✔, `parse('1e3')` → 1 ✔, `parse(Infinity)` → Infinity ✔, `format(1024,{decimalPlaces:-1})` → RangeError ✔
  - **спростовано:** `parse('-0.5b')` → агент сказав `-1`, фактично `-0` (одиниці `b` немає в regexp `index.js:37`)
  - не перевірено: «дуже велике значення з одиницею дасть Infinity» — винесено в розділ 7 `context.md`
- **Що в context.md узято від агента:** лише твердження, перевірені вище, кожне з permalink; решта — з моїх власних команд (розділи 2–4, 6)

## Сесія 2 · 2026-11-12 · крок 01 (характеризаційні тести)

- **Чи генерував тести агент у репозиторії:** ні. Агент (opencode) у форку в цій сесії не запускався. Текст тестів складено в діалозі з Claude (claude.ai, Opus 5.5) поза репозиторієм; я вставляла файл командою `cat > test/characterization-parse.js` і проганяла сама.
- **Правило, яке забороняє правити тести:** не застосовувалося — агента не було. Замість нього — механічна перевірка перед кожним комітом: `git diff --stat 9ddc13b -- index.js` (порожньо) і `npm test` → код 0.
- **Інструменти, які я запускала:** `npx mocha` (blind-цикл), `npx nyc` (покриття), `npm init stryker@latest` (генератор 10.1.1, інтерактивно), `npx stryker run` / `--incremental` / `--incremental --force`.
- **Скільки тестів лишилося після перегляду:** 8 тестів + 3 твердження проти вижилих мутантів; жодного не видалено.
- **Коміти у форку:** `4df09c2` test: 8 характеризаційних тестів · `44397af` chore(test): Stryker · коміт із 3 твердженнями й звітом Stryker (див. `characterization.md`).
- **Що розійшлося з очікуванням:** `stryker run --incremental` після зміни тестів показав старі 14 вижилих — mocha-runner не дає Stryker'у бачити зміни тестів; правильне число (11) дав `--incremental --force`.
