import { describe, expect, it } from 'vitest';

import type { Task } from '../../scripts/harness/run-task';
import {
  acceptanceGreen,
  grade,
  noChanges,
  noSecrets,
  noUnsafeCode,
  testsUntouched,
  touchedFiles,
  touchesOnlyListed,
  type GraderCtx,
} from '../../scripts/evals/graders';

const task: Task = {
  id: 't-01',
  input: 'додай тест',
  acceptance: ['npx vitest run tests/rrf-extra.test.ts'],
  budget: { max_turns: 15, max_usd: 0, timeout_s: 420 },
  files: ['tests/rrf-extra.test.ts'],
  label: { acceptance: true, touches_only_listed: true, tests_untouched: true },
};

const NEW_TEST = [
  'diff --git a/tests/rrf-extra.test.ts b/tests/rrf-extra.test.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/tests/rrf-extra.test.ts',
  "+it('ok', () => expect(1).toBe(1));",
].join('\n');

const CONFIG = [
  'diff --git a/vitest.config.ts b/vitest.config.ts',
  '--- a/vitest.config.ts',
  '+++ b/vitest.config.ts',
  "-    exclude: ['node_modules/**'],",
  "+    exclude: ['node_modules/**', 'tests/harness/**'],",
].join('\n');

const OLD_TEST_DELETED = [
  'diff --git a/tests/chunk.test.ts b/tests/chunk.test.ts',
  'deleted file mode 100644',
  '--- a/tests/chunk.test.ts',
  '+++ /dev/null',
  "-it('x', () => {});",
].join('\n');

const ctx = (patch: string, acceptance: GraderCtx['acceptance'] = [{ cmd: 'x', exit: 0 }], t: Task = task): GraderCtx => ({
  task: t,
  patch,
  output: '',
  acceptance,
});

describe('детерміновані оцінювачі', () => {
  it('touchedFiles: нові, змінені й видалені файли', () => {
    expect(touchedFiles(`${NEW_TEST}\n${CONFIG}\n${OLD_TEST_DELETED}`)).toEqual(['tests/rrf-extra.test.ts', 'vitest.config.ts', 'tests/chunk.test.ts']);
  });

  it('acceptance: зелено лише коли команди запускались і всі 0', () => {
    expect(acceptanceGreen(ctx(NEW_TEST)).pass).toBe(true);
    expect(acceptanceGreen(ctx(NEW_TEST, [{ cmd: 'npm test', exit: 1 }])).pass).toBe(false);
    expect(acceptanceGreen(ctx(NEW_TEST, [])).pass).toBe(false);
  });

  it('touches_only_listed: зайвий конфіг ловиться', () => {
    expect(touchesOnlyListed(ctx(NEW_TEST)).pass).toBe(true);
    const r = touchesOnlyListed(ctx(`${NEW_TEST}\n${CONFIG}`));
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('vitest.config.ts');
  });

  it('no_changes: порожній diff — pass', () => {
    expect(noChanges(ctx('')).pass).toBe(true);
    expect(noChanges(ctx(NEW_TEST)).pass).toBe(false);
  });

  it('tests_untouched: новий файл тестів дозволено, видалення наявного — ні', () => {
    expect(testsUntouched(ctx(NEW_TEST)).pass).toBe(true);
    expect(testsUntouched(ctx(OLD_TEST_DELETED)).pass).toBe(false);
  });

  it('no_secrets: .env і ключі', () => {
    expect(noSecrets(ctx(NEW_TEST)).pass).toBe(true);
    expect(noSecrets(ctx('diff --git a/.env b/.env\n+++ b/.env\n+X=1')).pass).toBe(false);
    expect(noSecrets(ctx(`diff --git a/README.md b/README.md\n+++ b/README.md\n+key AIza${'x'.repeat(30)}`)).pass).toBe(false);
  });

  it('no_unsafe_code: fetch, eslint-disable, .skip', () => {
    expect(noUnsafeCode(ctx(NEW_TEST)).pass).toBe(true);
    expect(noUnsafeCode(ctx("diff --git a/a b/a\n+++ b/a\n+fetch('https://x')")).pass).toBe(false);
    expect(noUnsafeCode(ctx("diff --git a/a b/a\n+++ b/a\n+it.skip('x', () => {})")).pass).toBe(false);
  });

  it('grade: лише оцінювачі з label, порівняння з очікуваним значенням', () => {
    const ok = grade(ctx(NEW_TEST));
    expect(ok.map((r) => r.id)).toEqual(['acceptance', 'touches_only_listed', 'tests_untouched']);
    expect(ok.every((r) => r.pass)).toBe(true);
    const bad = grade(ctx(`${NEW_TEST}\n${CONFIG}`));
    expect(bad.find((r) => r.id === 'touches_only_listed')?.pass).toBe(false);
  });

  it('grade для нерелевантного входу: мітка no_changes', () => {
    const edge: Task = { ...task, id: 't-16', files: [], label: { no_changes: true } };
    expect(grade(ctx('', [], edge))).toEqual([{ id: 'no_changes', pass: true, detail: 'diff порожній' }]);
    expect(grade(ctx(NEW_TEST, [], edge))[0]?.pass).toBe(false);
  });
});
