# Обмежена зміна: `parse()` повертає `null` для нескінченних чисел

- Дата: 2026-11-12 · форк: https://github.com/IlonaDembitska/bytes.js · нульова точка: `9ddc13b6c66e0cb293616fba246e05db4b6cef4d`
- План відкоту (розділ 1 `rollback.md`) закомічено в курсовому репозиторії **раніше** за зміну: `6cf5a06`, 2026-11-12 01:18:58 +0200
- Коміт нового тесту (ПЕРЕД зміною): [`49e17f3`](https://github.com/IlonaDembitska/bytes.js/commit/49e17f3) `test: parse() returns null for non-finite numbers (RED before fix)`
- Коміт зміни: [`18f7236`](https://github.com/IlonaDembitska/bytes.js/commit/18f7236b3c43ec82042a2e282505ae3afabbc977) `fix: parse() returns null for non-finite numbers (Infinity, -Infinity)` · гілка: `lab4/change`
- Чому проєктові це потрібно: **баг, зафіксований тестом кроку 01** — `parse(Infinity)` повертав `Infinity` (тест «parse(Infinity) повертає Infinity (зафіксований баг)»); README обіцяє `bytes.parse(…): number｜null` (`Readme.md#L100`), а сусідня `format()` для того самого `Infinity` уже повертає `null` (`index.js#L85-L87`).

## 1. Приймання (КОМАНДИ, не побажання)

Усі — у робочому дереві `~/lab4/change-tree` на гілці `lab4/change`.

| команда | очікуваний код виходу | фактичний |
|---|---|---|
| `npm test` (30 тестів проєкту + 8 характеризаційних + 2 нові) | 0 | **0** (40 passing) |
| `npx mocha --check-leaks test/parse-non-finite.js` | 0 | **0** |
| `git diff --stat` перед комітом зміни (жодних змін залежностей, lock-файла, CI) | лише `index.js` і `test/characterization-parse.js` | **так**: `index.js \| 2 +-`, `test/characterization-parse.js \| 8 ++++----`, 2 files changed |

## 2. Що змінено

| файл | рядків + / − | яке твердження цей файл підтверджує |
|---|---|---|
| `index.js` (рядок 142) | +1 / −1 | `parse` відкидає нескінченні числа: `!isNaN(val)` → `Number.isFinite(val)`; `Infinity` далі падає в перевірку `typeof val !== 'string'` (рядок 146) і повертає `null` |
| `test/parse-non-finite.js` (окремий коміт `49e17f3`, ПЕРЕД зміною) | +20 / −0 | новий тест на нову поведінку |
| `test/characterization-parse.js` | +4 / −4 | два свідомо оновлені твердження (нижче) |

Оновлені характеризаційні твердження — у тому самому коміті `18f7236`, що й зміна:
- було: `parse(Infinity) === Infinity` · стало: `parse(Infinity) === null` · бо: це і є виправлений баг, підписаний на кроці 01 «фіксую навмисне»;
- було: `parse(-Infinity) === -Infinity` · стало: `parse(-Infinity) === null` · бо: той самий корінь (рядок 142), на кроці 01 підписано «так, фіксую навмисне (той самий корінь)».

**Відхилення від правила «рівно одне твердження»:** оновлено **два**. Обидва — про ту саму умову в одному рядку коду; розділити зміну так, щоб `Infinity` давав `null`, а `-Infinity` — ні, означало б штучно ускладнити код. Усі інші 6 характеризаційних тестів і всі 30 тестів проєкту не змінено.

## 3. Три докази

1. **Характеризація після зміни:** `npm test >/dev/null 2>&1; echo $?` → **0**; `npm test` → **40 passing** (було 38 на нульовій точці + 2 нові). Жоден тест проєкту не впав.
2. **Новий тест:**
   - на своєму коміті `49e17f3` (до зміни) — **ЧЕРВОНИЙ**: `npx mocha --check-leaks test/parse-non-finite.js` → код **2**, `2 failing`:
     ```
     parse(-Infinity) повертає null:
     AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
     + -Infinity
     - null
     ```
   - після зміни `18f7236` — **ЗЕЛЕНИЙ**: та сама команда → код **0**.
3. **До / після на тому самому вході** `Infinity` / `-Infinity` (вхід із проєкту: `test/byte-format.js`, тест невалідного входу `format`):
   - до (`master`, основний checkout): `parse(Infinity) = Infinity` · `parse(-Infinity) = -Infinity`
   - після (`lab4/change`): `parse(Infinity) = null` · `parse(-Infinity) = null`

## 4. Межі агента в цьому прогоні

- Інструмент і модель із версією: opencode 1.19.0 · `opencode/big-pickle` · агент `build` (типовий)
- Режим: deny-правила opencode, **без `--auto`**; загальне `"*": "deny"` першим у кожному ключі
- Конфігурація дослівно (`~/lab4/opencode.change.json`, через `OPENCODE_CONFIG`):
  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "permission": {
      "edit": { "*": "deny", "index.js": "allow", "test/*": "deny" },
      "bash": { "*": "deny", "npm test*": "allow", "git diff*": "allow" },
      "webfetch": "deny",
      "websearch": "deny",
      "external_directory": "deny"
    }
  }
  ```
- Дозволені інструменти дослівно: редагування лише `index.js`; shell — лише `npm test*`, `git diff*`; читання — типове
- Заборона на тестову теку дослівно: `"test/*": "deny"` (після `"index.js": "allow"`, бо виграє останнє правило, що дало збіг)
- **Перевірка взірця шляху (методичка просила перевірити навмисне):** відносний взірець `"index.js": "allow"` **дав збіг** — агент виконав `Edit index.js`, помилки дозволу не було. Агент прочитав лише `index.js [offset=125, limit=40]` і зробив одну правку.
- Команда дослівно:
  ```
  cd ~/lab4/change-tree && OPENCODE_CONFIG=~/lab4/opencode.change.json opencode run -m opencode/big-pickle "У файлі index.js у функції parse, рядок 142, у першій умові заміни перевірку через isNaN на Number.isFinite(val), щоб parse(Infinity) і parse(-Infinity) повертали null. Зміни рівно цей один рядок і лише у файлі index.js. Не чіпай тести та інші файли. Відповідай українською."
  ```
  Перша спроба не запустилася: у промпті був `!isNaN(val)`, і zsh скасував увесь рядок (`zsh: event not found: isNaN(val)`) — промпт переписано без `!`.
- Ізоляція: `git worktree add -b lab4/change ../change-tree master` (від `4a71018` — див. «Що розійшлося»); `node_modules` у дереві — символьне посилання на `../bytes.js/node_modules`, додане в `.git/info/exclude`
- Після прогону: `agent=0`; `git status --short` у дереві → лише ` M index.js`; `git status --short` основного checkout → лише `?? reports/stryker-incremental.json` — це файл від мого прогону `stryker run --incremental` на кроці 01 в основному checkout, агент там не працював і нічого не змінив

## 5. Перегляд дифа

Хто і чим: я очима, **до** першого прогону тестів (`git status --short; git diff` одразу після агента). Машинну другу думку (Codex `/review`, `claude ultrareview`) не брала — цих інструментів у мене немає.

| перевірка | результат |
|---|---|
| нові залежності / зміни `package.json` / lock-файл | немає |
| правки в тестовій теці від агента | немає (`git status` — лише `index.js`); два твердження в `test/characterization-parse.js` оновила я сама наступною командою |
| нові файли конфігурації агента, `.github/` | немає |
| кожен змінений рядок → твердження `change.md` | рядок 142 → «`parse` відкидає нескінченні числа» ✔ |

Що виправлено за зауваженнями: нічого — диф з одного рядка відповідав завданню.
Що відкинуто і чому: власне зауваження «`Number.isFinite` відсутній у дуже старих Node, а `engines` обіцяє `>= 0.8`» — відкинуто, бо `format()` уже використовує `Number.isFinite` (`index.js#L85`), тобто зміна не звужує фактичну сумісність бібліотеки.

## 6. Кінцевий стан форка

**Зміна лишається в гілці `lab4/change`** (`49e17f3` тест → `18f7236` fix), **відкот — доказом у `lab4/rollback-drill`** (`2fcdea2` `Revert "fix: …"`, не зливається). `master` форка — стан до зміни: нульова точка `9ddc13b` + коміти кроків 00–01 (`chore(lab4)`, `test:`, `chore(test)`), без змін `index.js`.

```
master              9ddc13b → bfd9307 → 443737b → 4df09c2 → 44397af → 4e67cf8 → 4a71018
lab4/change         4a71018 → 49e17f3 (test, RED) → 18f7236 (fix)
lab4/rollback-drill 18f7236 → 2fcdea2 (Revert "fix: …")
```

## Що розійшлося з очікуванням

- Робоче дерево створено від `master` (`4a71018`), а не від нульової точки `9ddc13b`, як у прикладі методички: на нульовій точці ще немає моїх характеризаційних тестів і Stryker, а доказ 1 вимагає прогнати саме їх. Код `index.js` на `4a71018` ідентичний нульовій точці (`git diff --stat 9ddc13b -- index.js` порожній).
- Я очікувала 42 тести після зміни, фактично **40** — помилилася в підрахунку (38 + 2 нові; оновлені твердження нових тестів не додають).
