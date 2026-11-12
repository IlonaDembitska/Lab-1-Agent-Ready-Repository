# Лабораторна 4 — як відтворити три докази

Інструкція для людини, яка бачить ці репозиторії вперше. Кожен блок — окрема спроба в **новій порожній теці**, на **точному SHA**, на **своєму доступі** (ключами не обмінюємось).

- Курсовий репозиторій: https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository
- Форк чужого проєкту: https://github.com/IlonaDembitska/bytes.js (оригінал — visionmedia/bytes.js)
- SHA для перевірки — у `docs/lab4/repro.md`, розділ 2 (автор пише їх перед перевіркою).

Мітка часу для журналу застрягань:
- macOS / Linux: `date +%Y-%m-%dT%H:%M:%S%z`
- Windows PowerShell: `Get-Date -Format o`

## Що потрібно встановити

| Що | Версія, з якою перевірено | Перевірка |
|---|---|---|
| Node.js | 22.12 або новіша (див. `.nvmrc`, `engines` у `package.json`) | `node -v` |
| npm | той, що йде з Node 22 | `npm -v` |
| git | 2.40+ (потрібен `git worktree`) | `git --version` |
| OpenCode CLI — лише для доказу 1 | 1.19.0 | `npm i -g opencode-ai@1.19.0` → `opencode --version` |

Ключі API для доказів 1–3 **не потрібні**: харнес використовує безкоштовні моделі OpenCode Zen, а форк — звичайна бібліотека без мережі. Ключі Langfuse потрібні лише якщо хочете траси; без них харнес працює, `trace_id` буде `null`.

## Перш ніж ставити залежності

`npm ci` / `npm install` виконує скрипти життєвого циклу з `package.json`. Спершу подивіться:
- `package.json` → розділ `scripts` (у курсовому — немає `preinstall`/`postinstall`; у форку — лише `test`, `lint`, `test-ci`, `test-cov`);
- `scripts/harness/opencode.harness.json` — дозволи агента (`bash` за замовчуванням `deny`, дозволено лише `npm test`, `npx vitest`, `npx tsc`, `npm run typecheck`, `npm run lint`, `git status`, `git diff`; `webfetch` — `deny`);
- `.opencode/plugins/` — `guard-env.js` забороняє агенту читати `.env*`, `agent-log.js` пише журнал дій агента в `.agent-log/`.

## Доказ 1 — один прогін харнесу (курсовий репозиторій)

```
D=~/repro/$(date +%Y%m%d-%H%M)-course; mkdir -p $D && cd $D
git clone https://github.com/IlonaDembitska/Lab-1-Agent-Ready-Repository.git .
git checkout <SHA курсового з repro.md>
npm ci
opencode run -m opencode/big-pickle "Відповідай одним словом — ок"
HARNESS_BASE=HEAD npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01
```

- `opencode run …` — перевірка, що модель відповідає. Якщо 90 с тиші — спробуйте `opencode/nemotron-3.5-lightning-free` і передайте її через `HARNESS_MODEL=opencode/nemotron-3.5-lightning-free` у наступній команді.
- `HARNESS_BASE=HEAD` — агент працює від того самого SHA, який ви перевіряєте (без нього база — гілка `main`).
- Харнес створює тимчасове робоче дерево **поруч** із текою клону: `../harness-runs/t-01-<час>` (і прибирає його після прогону) та гілку `harness/t-01-<час>`.
- У Windows PowerShell замість `HARNESS_BASE=HEAD npx …` — `$env:HARNESS_BASE='HEAD'; npx …`.

**Доказ, що вийшло:** у терміналі рядок `pass · … с · ходів … → runs/t-01/<час>`; у теці `runs/t-01/<час>/` — чотири файли: `patch.diff`, `output.txt`, `agent.log`, `run.json`; журнал черги — `runs/queue-<час>.json`. Статус `pass` не обовʼязковий (модель недетермінована) — обовʼязкові артефакт і журнал.

## Доказ 2 — характеризаційні тести на незміненому коді (форк)

```
D=~/repro/$(date +%Y%m%d-%H%M)-fork; mkdir -p $D && cd $D
git clone https://github.com/IlonaDembitska/bytes.js.git .
git checkout <SHA форку з repro.md>
npm install
npx mocha --check-leaks test/characterization-parse.js
npm test
```

- У форку немає `package-lock.json` (так в оригінальному проєкті), тому `npm install`, а не `npm ci`; версії devDependencies можуть бути новішими, ніж у автора.
- `index.js` на цьому SHA не змінений відносно оригіналу (`9ddc13b`) — змінювались лише тести й налаштування Stryker.

**Доказ, що вийшло:** `8 passing` для характеризаційних тестів і зелений `npm test` (код виходу 0).

## Доказ 3 — відкат зміни за `docs/lab4/rollback.md` (форк)

Робіть у тій самій теці форку, що й доказ 2 (або в новій — за тими самими командами клонування):

```
git switch -c repro-rollback origin/lab4/change
git log --oneline -3
git revert --no-edit 18f7236
npx mocha --check-leaks test/byte-format.js test/byte-parse.js test/bytes.js test/characterization-parse.js; echo "characterization-exit=$?"
npx mocha --check-leaks test/parse-non-finite.js; echo "new-test-exit=$?"
test -f test/parse-non-finite.js && echo new-test-file=ON-PLACE
```

- `git revert` створює коміт: якщо git просить імʼя — один раз `git config user.name "…"` і `git config user.email "…"` у цій теці.
- `git log` має показати `18f7236 fix: parse() returns null for non-finite numbers …` — саме цей коміт відкочується, **не** коміт тесту `49e17f3`.

**Доказ, що вийшло:** `characterization-exit=0`; новий тест червоний (`new-test-exit` ≠ 0); `new-test-file=ON-PLACE`; у `git log --oneline -3` видно і `fix:`, і `Revert "fix: …"`. Пояснення, чому так, — `docs/lab4/rollback.md` у курсовому репозиторії.

## Як прибрати після себе

```
git worktree prune
git branch --list "harness/*"
git branch -D <гілки harness/…, які створив ваш прогін>
```
