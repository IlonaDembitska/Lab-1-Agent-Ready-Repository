import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkCite } from '../src/multi/cite';
import { headSha, isStale, MAX_TEXT, recall, reject, remember, type Entry, type StoreOptions } from '../src/memory/store';

const dir = mkdtempSync(join(tmpdir(), 'mem-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function gitRepo(name: string): string {
  const r = join(dir, name);
  execFileSync('git', ['init', '-q', r]);
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: r });
  writeFileSync(join(r, 'a.js'), 'one\ntwo\n');
  writeFileSync(join(r, 'b.js'), 'b\n');
  g('add', '.');
  g('commit', '-qm', `init ${name}`);
  return r;
}

const fork = gitRepo('fork');
const course = gitRepo('course');
const opts = (n: string): StoreOptions => ({ file: join(dir, `${n}.jsonl`), rejections: join(dir, `${n}-rej.jsonl`), forkDir: fork, courseDir: course });
const base = (o: Partial<Entry> = {}): Entry => ({
  at: '2026-11-12T10:00:00Z',
  kind: 'constraint',
  text: 'Звичайне твердження без секретів.',
  sha: headSha(fork),
  repo: 'fork',
  paths: ['a.js'],
  source: 'тест',
  ...o,
});

describe('детерміновані відмови', () => {
  it('приймає звичайний текст і відхиляє секрети, файли, довжину', () => {
    expect(reject({ text: 'parse бере parseInt для рядків без одиниці.' })).toBeNull();
    expect(reject({ text: `api_key = NOT_A_SECRET_${'x'.repeat(30)}` })).not.toBeNull();
    expect(reject({ text: 'token: abcdefghij12' })).toMatch(/ключ=значення/);
    expect(reject({ text: 'a\nb\nc\nd' })).toMatch(/файл/);
    expect(reject({ text: 'x'.repeat(MAX_TEXT + 1) })).toMatch(/довше/);
    expect(reject({ text: 'дані: QUJDREVGR0hJSktMTU5PUFFSU1Q=' })).toMatch(/base64/);
  });

  it('помилкова відмова: повний хеш у тексті схожий на токен (хеш має жити в sha/source)', () => {
    expect(reject({ text: `прогін на ${'a'.repeat(40)}` })).not.toBeNull();
  });
});

describe('remember', () => {
  it('дописує валідний запис і журналює відмову без самого тексту', () => {
    const o = opts('r1');
    expect(remember(base(), o)).toEqual({ ok: true });
    const bad = remember(base({ text: `secret = NOT_A_SECRET_${'y'.repeat(30)}` }), o);
    expect(bad.ok).toBe(false);
    expect(readFileSync(o.file, 'utf8').trim().split('\n')).toHaveLength(1);
    const log = readFileSync(o.rejections, 'utf8');
    expect(log).toMatch(/why/);
    expect(log).not.toMatch(/NOT_A_SECRET/);
  });

  it('невалідна схема не дописується (зайве поле, невідомий вид)', () => {
    const o = opts('r2');
    expect(remember({ ...base(), extra: 1 }, o).ok).toBe(false);
    expect(remember({ ...base(), kind: 'note' }, o).ok).toBe(false);
    expect(existsSync(o.file)).toBe(false);
  });
});

describe('застарілість', () => {
  it('у ТОМУ репозиторії, закрито на помилках', () => {
    const o = opts('s');
    const old = headSha(fork);
    expect(isStale(base({ sha: old }), o)).toBe(false);
    writeFileSync(join(fork, 'a.js'), 'changed\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'change a'], { cwd: fork });
    expect(isStale(base({ sha: old }), o)).toBe(true); // a.js змінено після sha
    expect(isStale(base({ sha: old, paths: ['b.js'] }), o)).toBe(false); // b.js — ні
    expect(isStale(base({ sha: 'deadbeef' }), o)).toBe(true); // невідомий коміт = застаріле
    expect(isStale(base({ sha: old, repo: 'course' }), o)).toBe(true); // sha форка в курсовому — невідомий
    expect(isStale(base({ sha: old, paths: [] }), o)).toBe(false); // глобальне
  });
});

describe('recall', () => {
  it('дві межі, застарілі не вантажаться, числа про обрізане', () => {
    const o = opts('rc');
    const sha = headSha(fork);
    for (let i = 0; i < 5; i += 1) remember(base({ sha, paths: ['b.js'], text: `запис номер ${i}` }), o);
    remember(base({ sha: 'deadbeef', text: 'застарілий' }), o);
    const r = recall(o, 3, 10_000);
    expect(r.total).toBe(6);
    expect(r.staleDropped).toBe(1);
    expect(r.used).toBe(3);
    expect(r.cutEntries).toBe(2);
    expect(r.text).toMatch(/запис номер 4/); // найновіші першими
    expect(r.text).not.toMatch(/застарілий/);
    expect(recall(o, 20, 50).used).toBe(0);
  });
});

describe('цитати', () => {
  it('коміт і рядок перевіряються git, а не моделлю', () => {
    const sha = headSha(course);
    expect(checkCite(course, { sha })).toBeNull();
    expect(checkCite(course, { sha, file: 'a.js', line: 2 })).toBeNull();
    expect(checkCite(course, { sha, file: 'a.js', line: 99 })).not.toBeNull();
    expect(checkCite(course, { sha: 'deadbeef' })).not.toBeNull();
  });
});
