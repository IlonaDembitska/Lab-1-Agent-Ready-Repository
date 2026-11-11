# Відновлений контекст: bytes.js

- Дата: 2026-11-12
- Оригінал: https://github.com/visionmedia/bytes.js · мій форк: https://github.com/IlonaDembitska/bytes.js
- Ліцензія: MIT, файл: https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/LICENSE
- Нульова точка (SHA базового коміту форка): `9ddc13b6c66e0cb293616fba246e05db4b6cef4d` («Release 3.1.2»)
- Node у мене: v24.21.0 · npm 11.19.0 · Node, якого просить проєкт (engines): `>= 0.8`
- Режим читання агента: opencode 1.19.0, агент `plan` + deny-правила (edit: deny, bash: усе deny крім читальних команд, webfetch: deny, external_directory: deny),
  конфігурація: [docs/lab4/opencode.readonly.json](opencode.readonly.json); журнал — [autonomy-log.md](autonomy-log.md)

## 1. Що проєкт робить

`bytes` — маленька бібліотека для Node.js без залежностей. Вона перетворює рядок із розміром у кількість байтів (`'1KB'` → `1024`) і навпаки — число байтів у читабельний рядок (`1024` → `'1KB'`), з опціями форматування (кількість знаків після коми, роздільник тисяч, одиниця). Користувачі — інші npm-пакети (на npm у неї 2 538 залежних пакетів), результат віддається як число або рядок, а на невалідний вхід — `null`. Увесь код лежить в одному файлі `index.js` (170 рядків).

## 2. Як його запустити й протестувати

| крок | команда дослівно | код виходу | що побачив |
|---|---|---|---|
| нульова точка | `git rev-parse HEAD` | 0 | `9ddc13b6c66e0cb293616fba246e05db4b6cef4d` |
| ліцензія | `head -3 LICENSE` | 0 | `(The MIT License)` |
| встановлення (спроба) | `npm ci` | **1** | `EUSAGE`: у проєкті немає `package-lock.json`, `npm ci` не працює |
| встановлення | `npm install --no-package-lock` | 0 | 15 с, 291 пакет; 8 попереджень `deprecated` (eslint 7.32.0, glob 7, rimraf 3 …), 9 vulnerabilities; попереджень про peer-залежності **немає**. `--no-package-lock` — щоб не створювати lock-файл у чужому форку; `git status` після цього чистий |
| тести без встановлення | `npm test` | **127** | `sh: mocha: command not found` — залежності ще не стоять |
| тести | `npm test` (`mocha --check-leaks --reporter spec`) | 0 | **30 passing** (8 ms), 3 файли: `test/byte-format.js`, `test/byte-parse.js`, `test/bytes.js` |
| запуск | окремої команди запуску немає — це бібліотека; виклик перевірено через `node -e "const b=require('./index.js'); console.log(b.parse('12abc'))"` | 0 | `12` (решта прогонів — у розділі 5) |
| скрипти | `lint`, `test`, `test-ci` (nyc + lcov), `test-cov` (nyc + html) | — | з `package.json` |
| точки входу | поля `main`/`exports`/`bin` у `package.json` **немає** → Node бере типовий `index.js` | — | `index.js:15-17` експортує `bytes`, `format`, `parse` |
| що перевіряє CI | `.github/workflows/ci.yml`: `npm install` → `npm run test-ci` (якщо стоїть nyc) або `npm test` → `npm run lint` | — | [ci.yml#L169-L180](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/.github/workflows/ci.yml#L169-L180); матриця старих версій Node, `actions/checkout@v2`, застарілий `::set-output` |

## 3. Пʼять файлів, що мають значення

| файл (permalink) | чому саме він | звідки знаю |
|---|---|---|
| [index.js](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js) | єдиний файл коду: точки входу, `format`, `parse` | граф залежностей (його імпортують усі 3 тести) · 26 комітів в історії · прочитав |
| [test/byte-parse.js](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/test/byte-parse.js) | тести модуля, який я змінюватиму (`parse`) | граф залежностей · прочитав `#L90-L95` |
| [package.json](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/package.json) | найчастіше змінюваний файл (60 комітів): скрипти, devDependencies, engines | ранжування за частотою змін |
| [.github/workflows/ci.yml](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/.github/workflows/ci.yml) | єдина брама проєкту: які перевірки він вважає обовʼязковими | ранжування (18 комітів) · прочитав рядки 120–185 |
| [History.md](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/History.md) | журнал змін за версіями (35 комітів) — де шукати, чому поведінку змінювали | ранжування за частотою змін |

Повне ранжування (`git log --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -10`):
`package.json` 60 · `.travis.yml` 53 (старий CI, файла вже немає) · `History.md` 35 · `Readme.md` 29 · `index.js` 26 · `.github/workflows/ci.yml` 18 · `test/byte-format.js` 11 · `component.json` 11 · `test/byte-parse.js` 9 · `test/tostring.js` 8.

**Історія `index.js`** (`git log --follow --oneline -- index.js`): 26 комітів від `07c88a4 Initial commit`; `--follow` пройшов через перейменування, ключові: `572cc57 Combine all code into index.js` (раніше код був у `lib/`), `33cc74b Fix parsing byte string that looks like hex`, `581b2b5 Fix return value for un-parsable strings` (остання зміна коду).

**git blame `parse()`** (`git --no-pager blame -w -C -L141,170 --date=short -- index.js`): рядки 152–164 — Théo FIDRY, 2015-04-12, ще у файлі `lib/byte-parse.js` (`-C` знайшов перенесення); рядок 157 (`parseInt`) — Douglas Christopher Wilson, 2016-02-15, `33cc74b5`; рядки 165–167 (`return null`) — Douglas Christopher Wilson, 2022-01-27, `581b2b5b`. Масового переформатування в історії немає (`git log --oneline | grep -iE "style|lint|format|prettier"` дає лише коміти `lint:`/`build: eslint@…`, жодного prettier), тому `--ignore-rev` не застосовував.

## 4. Карта залежностей модуля зміни

Модуль: `index.js` (функція `parse`, рядки 141–170)
Команда дослівно: `npx -y dependency-cruiser@18.7.0 --no-config --output-type text index.js test`
Звіт (у ФОРКУ): https://github.com/IlonaDembitska/bytes.js/blob/bfd9307/lab4-reports/depcruise.txt
- імпортує: нічого (жодного `require`)
- імпортується з: `test/byte-format.js`, `test/byte-parse.js`, `test/bytes.js`
- цикли: немає

## 5. Як воно працює — три перевірені твердження

1. **Рядок, що не підходить під регулярний вираз, не відкидається, а мовчки розбирається через `parseInt`.** — [index.js#L155-L158](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L155-L158) — перевірив: прочитав рядок 157 (`floatValue = parseInt(val, 10)`) і прогнав `node -e`: `parse('12abc')` → `12`, `parse('1.5')` → `1`, `parse('1e3')` → `1`.
2. **Регулярний вираз розбору знає лише одиниці `kb|mb|gb|tb|pb`; одиниці `b` у ньому немає**, тому рядки на кшталт `'-0.5b'` теж ідуть гілкою `parseInt`. — [index.js#L37](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L37) — перевірив: прочитав regexp і прогнав `parse('-0.5b')` → `-0`.
3. **Числовий вхід `parse` перевіряє лише на `NaN`, а не на скінченність**, тому `parse(Infinity)` повертає `Infinity`; у `format` така перевірка є. — [index.js#L142-L143](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L142-L143) проти [index.js#L85-L87](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L85-L87) — перевірив: прочитав обидва місця, `parse(Infinity)` → `Infinity`.
4. (додатково) **Від'ємний `decimalPlaces` у `format` кидає `RangeError`, який ніде не перехоплюється.** — [index.js#L92](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L92) і [#L113](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/index.js#L113) — перевірив: `format(1024, {decimalPlaces: -1})` → `RangeError`.

Наявні тести на «рядок без одиниці» покривають лише `'0'`, `'-1'`, `'1024'`, `'0x11'` — [test/byte-parse.js#L90-L95](https://github.com/IlonaDembitska/bytes.js/blob/9ddc13b6c66e0cb293616fba246e05db4b6cef4d/test/byte-parse.js#L90-L95) (прочитав).

## 6. Зони ризику

| зона | чим підтверджено | чому це ризик для зміни кроку 02 |
|---|---|---|
| `format()` — `index.js:84-128` | складність **20** за правилом `complexity` (рівно типовий поріг ESLint), 45 рядків (`max-lines-per-function` > 20) · дублювання 0% за jscpd · `test/byte-format.js` змінювали 11 разів | найскладніша функція; будь-яка зміна тут зачіпає багато гілок — у кроці 02 її **не чіпаю** |
| `parse()` — `index.js:141-170`, особливо гілка `parseInt` (`#L157`) | складність **6**, 30 рядків · дублювання 0% · blame: рядки з 3 різних років і з іншого файлу (`lib/byte-parse.js`) | місце моєї зміни; поведінка «тихого» розбору (`'12abc'` → 12) не покрита тестами — зміна може зламати користувачів, які на неї спираються |
| CI проєкту | `ci.yml` використовує `actions/checkout@v2` і `::set-output`; значок CI на npm — «unknown» | ймовірно, власна брама проєкту зараз не запускається — моєю брамою буде локальний `npm test` |
| версія Node | `engines: ">= 0.8"`, а в мене 24.21.0; devDependencies старі (eslint 7.32.0, mocha 9.2.0) | «ніхто не перевіряв» на сучасному Node; `npx eslint@10.13.0` уже попереджає, що `.eslintignore` не підтримується |
| немає lock-файла | `npm ci` → код 1 | встановлення не відтворюване: версії залежностей можуть відрізнятися між машинами |

Звіти (у ФОРКУ, коміт `bfd9307`):
- дублювання: `npx -y jscpd@5.4.2 --reporters console,json --output lab4-reports/jscpd index.js test` → 4 файли, 436 рядків, 0 клонів — https://github.com/IlonaDembitska/bytes.js/blob/bfd9307/lab4-reports/jscpd.txt
- складність: `npx -y eslint@10.13.0 --no-config-lookup --rule '{"complexity":["warn",1],"max-lines-per-function":["warn",20]}' index.js` — https://github.com/IlonaDembitska/bytes.js/blob/bfd9307/lab4-reports/complexity.txt (поріг `complexity` навмисно 1, щоб побачити число для кожної функції)

## 7. Три питання, на які я відповіді не знайшла

1. **Чи справді дуже велике значення з одиницею повертає `Infinity` на `index.js:169`?** Агент це стверджував, але я не перевірила: regexp не приймає експоненту (`1e400pb` не пройде), а прогону з числом на сотні цифр я не робила. — де шукала: прочитала `#L37` і `#L169` — що блокує: не знаю, чи цей випадок узагалі досяжний через `parse`.
2. **Чому для рядка без одиниці автори свідомо взяли `parseInt`, а не сувору перевірку?** — де шукала: `git blame` рядка 157 → коміт `33cc74b5` «Fix parsing byte string that looks like hex»; причини в повідомленні коміту немає — що блокує: не знаю, чи це навмисна сумісність, і чи зміна кроку 02 не зламає користувачів.
3. **Чи працює CI проєкту зараз на GitHub?** — де шукала: прочитала `ci.yml` (рядки 120–185) і значок «ci unknown» на npm; вкладку Actions оригіналу не відкривала — що блокує: не знаю, чи в проєкту є жива брама, чи лише моя локальна.

Спростована гіпотеза агента (не йде в розділ 5): агент стверджував, що `parse('-0.5b')` дасть `-1` через `Math.floor`. Фактичний прогін дав `-0` — агент не помітив, що одиниці `b` немає в regexp `#L37`, і рядок іде гілкою `parseInt`.

## 8. Перевірка одногрупником

Хто: _(ще не проведено)_ · дата: _…_
На чому спіткнувся: _…_
Що я після цього дописала: _…_
