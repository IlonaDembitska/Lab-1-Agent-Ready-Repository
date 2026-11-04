/**
 * Запис вердиктів брам (Лаб. 3, крок 01). Запускається задачею record у gates.yml.
 * Читає GATE_TYPES / GATE_LINT / GATE_TESTS / GATE_BUILD (pass | fail | skipped | cancelled)
 * GATE_EVALS — регресійну браму evals (крок 04) і GATE_VERIFY — фінальну браму верифікатора (крок 02; skipped для гілок, що не harness/t-…),
 * пише gate-record.json і копію найсвіжішого docs/lab3/runs/<id>/run.json із полем gates → gate-run.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = ['types', 'lint', 'tests', 'build', 'evals'];
const ALL = [...NAMES, 'verify'];
const norm = (v) => (v === 'success' ? 'pass' : v === 'failure' ? 'fail' : v || 'skipped');
const gates = Object.fromEntries(ALL.map((n) => [n, norm(process.env[`GATE_${n.toUpperCase()}`])]));
const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY ?? 'local';
const runId = process.env.GITHUB_RUN_ID ?? 'local';

const record = {
  at: new Date().toISOString(),
  sha: process.env.GITHUB_SHA ?? 'local',
  ref: process.env.GITHUB_REF_NAME ?? 'local',
  run: runId === 'local' ? 'local' : `${server}/${repo}/actions/runs/${runId}`,
  gates,
  // verify пропускається на звичайних гілках — це не провал; на гілці харнесу він має бути pass.
  allPass: NAMES.every((n) => gates[n] === 'pass') && ['pass', 'skipped'].includes(gates.verify),
  firstFailed: ALL.find((n) => gates[n] === 'fail') ?? null,
  verifier: existsSync('gate-logs/verdict.json') ? JSON.parse(readFileSync('gate-logs/verdict.json', 'utf8')) : null,
};
writeFileSync('gate-record.json', `${JSON.stringify(record, null, 2)}\n`);

const dir = 'docs/lab3/runs';
if (existsSync(dir)) {
  const runs = readdirSync(dir)
    .map((d) => join(dir, d, 'run.json'))
    .filter((f) => existsSync(f))
    .map((f) => ({ f, r: JSON.parse(readFileSync(f, 'utf8')) }))
    .sort((a, b) => String(b.r.finishedAt).localeCompare(String(a.r.finishedAt)));
  if (runs.length > 0) {
    const latest = { ...runs[0].r, gates: record };
    writeFileSync('gate-run.json', `${JSON.stringify(latest, null, 2)}\n`);
    console.log(`поле gates дописано до ${runs[0].f} → gate-run.json`);
  }
}
console.log(JSON.stringify(record, null, 2));
