/**
 * Початкове наповнення пам'яті (Лаб. 4, крок 04) — лише те, що я прочитала очима й закомітила
 * на кроках 00–03. Пише ТІЛЬКИ через remember(): схема + детерміновані відмови.
 * Два записи навмисно відхиляються (демонстрація відмов), один — навмисно застарілий (демонстрація
 * перевірки застарілості). Повторний запуск відмовляється, щоб не дублювати записи.
 *
 *   FORK_DIR=~/lab4/bytes.js npx tsx scripts/memory/seed.ts
 */
import { existsSync } from 'node:fs';

import { defaultStore, headSha, remember, rememberOrThrow, type Entry } from '../../src/memory/store';

const FORK_URL = 'https://github.com/IlonaDembitska/bytes.js';

function main(): void {
  const o = defaultStore();
  if (existsSync(o.file)) {
    console.error(`${o.file} уже існує — seed не перезаписує пам'ять`);
    process.exit(1);
  }
  const fork = headSha(o.forkDir);
  const course = headSha(o.courseDir);
  const at = new Date().toISOString();
  const e = (x: Omit<Entry, 'at'>): Entry => ({ at, ...x });

  const good: Entry[] = [
    e({ kind: 'constraint', repo: 'fork', sha: fork, paths: ['index.js'], text: "У регулярному виразі parse немає одиниці b, тому рядки на кшталт '1.1b' ідуть гілкою parseInt.", source: `${FORK_URL}/blob/${fork}/index.js#L37` }),
    e({ kind: 'constraint', repo: 'fork', sha: fork, paths: ['index.js', 'test/byte-parse.js'], text: "parse('0x11') повертає 0: це навмисна поведінка, закріплена тестом проєкту, її не можна «виправляти».", source: `${FORK_URL}/blob/${fork}/test/byte-parse.js#L94` }),
    e({ kind: 'outcome', repo: 'fork', sha: fork, paths: ['index.js'], text: 'Зміна кроку 02 (parse(Infinity) повертає null) живе лише в гілці lab4/change; у master форка index.js не змінено.', source: `${FORK_URL}/commit/18f7236b3c43ec82042a2e282505ae3afabbc977` }),
    e({ kind: 'constraint', repo: 'course', sha: course, paths: ['src/multi/synth.ts'], text: 'На кроці 03 звідник вигадував хеші комітів і номери рядків. Цитувати можна лише хеші й рядки, які прямо є у виводі інструментів.', source: 'docs/lab4/multi-runs.jsonl: citeBad у q1-multi, q2-multi, q2-single' }),
    e({ kind: 'constraint', repo: 'course', sha: course, paths: [], text: 'Безкоштовний рівень Gemini дав 429 після ~80 запитів поспіль; між питаннями потрібна пауза близько 60 с.', source: 'docs/lab4/traces/budget-stop.jsonl, q2-multi, 2026-11-12' }),
    e({ kind: 'decision', repo: 'course', sha: course, paths: ['src/multi/fanout.ts', 'docs/lab4/multiagent.md'], text: 'Розгалуження не беремо за замовчуванням: на 5 питаннях якість 0,17 проти 0,72 в одного агента, хоча час до відповіді вдвічі менший.', source: 'docs/lab4/multiagent.md, розділ 5' }),
    e({ kind: 'decision', repo: 'course', sha: course, paths: ['src/multi/verifier.ts'], text: 'Верифікатор — інша родина моделей, ніж гілки: гілки Gemini, верифікатор Qwen через локальну Ollama.', source: 'src/multi/verifier.ts, verifierModel()' }),
    e({ kind: 'outcome', repo: 'course', sha: course, paths: ['tests/multi.test.ts'], text: 'Тести мультиагентного коду зелені: 12 з 12.', source: 'vitest run tests/multi.test.ts, 2026-11-12' }),
    // НАВМИСНО ЗАСТАРІЛИЙ: правда на cbbb1c5, але multiagent.md змінено пізніше (a747959) — recall його відкине.
    e({ kind: 'outcome', repo: 'course', sha: 'cbbb1c5', paths: ['docs/lab4/multiagent.md'], text: 'У multiagent.md ще немає чисел порівняння одного агента й розгалуження.', source: 'стан гілки lab4/step-03 на коміті cbbb1c5' }),
  ];
  for (const g of good) rememberOrThrow(g, o);

  // НАВМИСНІ ВІДМОВИ — подія в rejections.jsonl, не тихе ігнорування.
  const fakeSecret = remember(e({ kind: 'constraint', repo: 'course', sha: course, paths: [], text: `api_key = NOT_A_SECRET_${'x'.repeat(30)}`, source: 'демонстрація відмови' }), o);
  // Помилкова відмова: повний хеш у тексті схожий на токен — хеш мав би жити в sha/source.
  const fullSha = remember(e({ kind: 'outcome', repo: 'fork', sha: fork, paths: [], text: `Зелений прогін на коміті ${fork}`, source: 'демонстрація помилкової відмови' }), o);

  console.log(`записано: ${good.length}; відмова «секрет»: ${fakeSecret.ok ? 'НЕ спрацювала' : fakeSecret.why}; відмова «повний хеш у тексті»: ${fullSha.ok ? 'НЕ спрацювала' : fullSha.why}`);
}

if (process.argv[1]?.endsWith('seed.ts')) main();
