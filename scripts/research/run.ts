/**
 * Глибоке дослідження чужого проєкту (Лаб. 4, крок 04) — у двох конфігураціях: без пам'яті й з пам'яттю.
 *
 *   FORK_DIR=~/lab4/bytes.js npx tsx --env-file=.env.local scripts/research/run.ts --memory off
 *   FORK_DIR=~/lab4/bytes.js npx tsx --env-file=.env.local scripts/research/run.ts --memory on
 *
 * КРИТЕРІЙ ЗУПИНКИ (чотири рядки):
 *   1. смуг K = 4 у першому раунді (2 у наступному), гілки — лише читання, корінь — форк;
 *   2. кроків на смугу = 4 (isStepCount), раундів не більше 2;
 *   3. стеля часу 300 с на все дослідження (AbortController у fanOut), ходів ≤ 20, токенів ≤ 250 000;
 *   4. зупиняємося, коли КОЖНЕ твердження зводу має перевірену цитату, АБО коли раунд не додав жодної нової цитати.
 *
 * Цитати перевіряє КОД (git cat-file / git blame -L) ДО верифікатора; верифікатор (Ollama, інша родина)
 * бачить лише твердження з існуючими цитатами.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { google } from '@ai-sdk/google';
import { z } from 'zod';

import { defaultStore, headSha, memoryBlock, proposeMemoryTool, recall, type Recall } from '../../src/memory/store';
import { CATALOG } from '../../src/models';
import { startTracing } from '../../src/otel/script-tracing';
import { add, DEFAULT_BUDGET, empty, overBudget, type Budget, type Spent, type Stop } from '../../src/multi/budget';
import { checkCite, citeEvidence, permalink, type Cite } from '../../src/multi/cite';
import { fanOut, realGenerate, type LaneTrace } from '../../src/multi/fanout';
import { forkDir, readerTools } from '../../src/multi/reader-tools';
import { claim, READER_SYSTEM } from '../../src/multi/synth';
import { isBlockedStrict, judgeClaim, verifierModel } from '../../src/multi/verifier';
import type { CriterionVerdict } from '../../src/verify/schema';
import { extractJson } from '../verify';

export const QUESTION =
  "Чому parse('0x11') повертає 0, а не 17, і чому для рядка без одиниці функція parse досі бере parseInt, а не відкидає невалідний вхід?";
/** Еталон якості: факти, які правильна відповідь мусить назвати (перевірені на кроках 00–01). */
export const EXPECT = ['33cc74b', '581b2b5', 'test/byte-parse.js', 'parseInt'];
export const MAX_ROUNDS = 2;
const MAX_RESEARCH_CLAIMS = 6;
const FORK_URL = process.env.FORK_URL ?? 'https://github.com/IlonaDembitska/bytes.js';

export const RESEARCH_BUDGET: Budget = { ...DEFAULT_BUDGET, maxTurns: 20, tokenCeiling: 250_000, wallClockMs: 300_000 };

const researchDraft = z
  .object({ answer: z.string().min(20).max(4000), claims: z.array(claim).min(1).max(MAX_RESEARCH_CLAIMS) })
  .strict();
type ResearchDraft = z.infer<typeof researchDraft>;

const ROUND1 = [
  { lane: 'history', prompt: `Дослідницьке питання: ${QUESTION}\nТвоя смуга — ІСТОРІЯ index.js: git_log для index.js, потім git_show для комітів, що стосуються hex, parseInt і невалідних рядків. Назви хеші (7 символів), дати й суть.` },
  { lane: 'blame', prompt: `Дослідницьке питання: ${QUESTION}\nТвоя смуга — АВТОРСТВО РЯДКІВ: git_blame для index.js, рядки 141–170 (функція parse). Хто й яким комітом написав рядок з parseInt і рядки з return null.` },
  { lane: 'tests', prompt: `Дослідницьке питання: ${QUESTION}\nТвоя смуга — ТЕСТИ: grep "0x11", потім read_file потрібного тесту. Назви файл і номери рядків, що закріплюють цю поведінку.` },
  { lane: 'docs', prompt: `Дослідницьке питання: ${QUESTION}\nТвоя смуга — ДОКУМЕНТИ: grep "hex" і "parse" у History.md і Readme.md, read_file потрібних місць. Назви файл і рядки.` },
];

function synthPrompt(outs: readonly { lane: string; text: string }[], memory: string): string {
  return [
    `Дослідницьке питання: ${QUESTION}`,
    'Зведи результати смуг у відповідь на кілька абзаців. Кожне твердження — з цитатою.',
    'Поверни ЛИШЕ JSON без іншого тексту:',
    '{"answer":"3–6 речень українською","claims":[{"text":"одне твердження","sha":"7-символьний хеш коміту","file":"шлях (необовʼязково)","line":номер_рядка_необовʼязково}]}',
    `Від 1 до ${MAX_RESEARCH_CLAIMS} тверджень. Для рядка коду sha — коміт, на якому рядок існує (наприклад, найновіший хеш із git_log). Не вигадуй хешів і рядків: бери лише ті, що є в текстах нижче.`,
    memory,
    '',
    ...outs.map((o) => `### смуга ${o.lane}\n${o.text.slice(0, 5000)}`),
  ].join('\n');
}

const key = (c: Cite) => `${c.sha.slice(0, 7)}|${c.file ?? ''}|${c.line ?? ''}`;
const toCite = (c: ResearchDraft['claims'][number]): Cite => ({ sha: c.sha, ...(c.file !== undefined ? { file: c.file } : {}), ...(c.line !== undefined ? { line: c.line } : {}) });

async function main(): Promise<void> {
  const mem = process.argv.includes('--memory') && process.argv[process.argv.indexOf('--memory') + 1] === 'on';
  const tag = mem ? 'memory-on' : 'memory-off';
  const root = forkDir();
  const tools = readerTools(root);
  const modelId = process.env.BRANCH_MODEL ?? CATALOG['gemini-3.5-flash-lite'].id;
  const model = google(modelId);
  const vModel = verifierModel();
  const budget = RESEARCH_BUDGET;
  const store = defaultStore();

  const r: Recall | null = mem ? recall(store) : null;
  const memText = r !== null ? memoryBlock(r) : '';
  const system = READER_SYSTEM + memText;

  const stopTracing = await startTracing();
  const wall0 = performance.now();
  let spent: Spent = empty();
  let stop: Stop = 'none';
  let reason = '';
  const lanes: LaneTrace[] = [];
  const outs: { lane: string; text: string }[] = [];
  let draft: ResearchDraft | null = null;
  const validKeys = new Set<string>();
  let firstDraftBadCites = -1; // «чи повторив помилку»: вигадані цитати в ПЕРШОМУ зводі
  let rounds = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const branchList =
        round === 0
          ? ROUND1
          : ['history', 'blame'].map((lane) => ({
              lane: `${lane}-r2`,
              prompt: `Дослідницьке питання: ${QUESTION}\nЦі твердження зводу не мають підтвердженої цитати — знайди для них точний хеш коміту або файл і рядок (лише з виводу інструментів):\n${(draft?.claims ?? [])
                .filter((c) => checkCite(root, toCite(c)) !== null)
                .map((c) => `- ${c.text}`)
                .join('\n')}`,
            }));
      const fan = await fanOut({ model, system, readOnlyTools: tools, rounds: [branchList], budget, taskId: `research-${tag}-r${round + 1}`, initial: spent });
      spent = fan.spent;
      lanes.push(...fan.lanes);
      outs.push(...fan.out.map((o) => ({ lane: o.lane, text: o.text })));
      rounds = round + 1;
      if (fan.stop !== 'none') {
        stop = fan.stop;
        reason = `межа бюджету: ${fan.stop}`;
        break;
      }

      // звід — ще один хід
      if (overBudget(spent, budget, 1, false) !== 'none') {
        stop = 'turn-budget';
        reason = 'межа ходів перед зводом';
        break;
      }
      const t0 = performance.now();
      const s = await realGenerate({ model, system: `Ти — звідник. Без інструментів.${memText}`, prompt: synthPrompt(outs, ''), tools: {}, steps: 1, signal: AbortSignal.timeout(budget.wallClockMs), functionId: `research-${tag}/synth-r${round + 1}` });
      spent = add(spent, s.usage, performance.now() - t0, s.steps);
      const parsed = researchDraft.safeParse(extractJson(s.text));
      if (!parsed.success) {
        reason = `звід не пройшов схему в раунді ${round + 1}`;
        continue; // наступний раунд — нова спроба, якщо межі дозволяють
      }
      draft = parsed.data;

      const cites = draft.claims.map(toCite);
      const bad = cites.filter((c) => checkCite(root, c) !== null).length;
      if (firstDraftBadCites < 0) firstDraftBadCites = bad;
      const before = validKeys.size;
      for (const c of cites) if (checkCite(root, c) === null) validKeys.add(key(c));
      if (bad === 0) {
        reason = `кожне твердження має перевірену цитату (раунд ${round + 1})`;
        break;
      }
      if (round > 0 && validKeys.size === before) {
        reason = `раунд ${round + 1} не додав жодної нової перевіреної цитати`;
        break;
      }
      reason = `раунд ${round + 1}: ${bad} цитат не перевірено — ще раунд`;
    }
    if (reason.endsWith('ще раунд')) reason = `досягнуто максимуму раундів (${MAX_ROUNDS})`;

    // Детермінована перевірка цитат — ДО верифікатора на моделі.
    const verdicts: CriterionVerdict[] = [];
    const citeRows: { claim: string; cite: Cite; ok: boolean; why: string | null; link: string }[] = [];
    if (draft !== null) {
      for (const [i, c] of draft.claims.entries()) {
        const cite = toCite(c);
        const why = checkCite(root, cite);
        citeRows.push({ claim: c.text, cite, ok: why === null, why, link: permalink(FORK_URL, cite) });
        const id = `C${i + 1}`;
        if (why !== null) {
          verdicts.push({ id, verdict: 'fail', reason: `детермінована перевірка: ${why}`, evidence: '' });
          continue;
        }
        if (overBudget(spent, budget, 1, false) !== 'none') {
          verdicts.push({ id, verdict: 'unknown', reason: 'межа ходів до верифікації', evidence: '' });
          continue;
        }
        const v = await judgeClaim(id, c.text, citeEvidence(root, cite), vModel);
        spent = add(spent, v.usage, v.ms, 1);
        verdicts.push(v.verdict);
      }
    }

    // Модель ПРОПОНУЄ запис у пам'ять (лише з пам'яттю). Пропозиції йдуть у proposed.jsonl, а не в store:
    // у пам'ять потрапляє лише те, що я прочитала очима й закомітила (пастка OWASP LLM01).
    let proposal: unknown = null;
    if (mem && draft !== null && overBudget(spent, budget, 1, false) === 'none') {
      const proposedStore = { ...store, file: 'docs/lab4/memory/proposed.jsonl' };
      const t0 = performance.now();
      const p = await realGenerate({
        model,
        system: 'Ти пропонуєш ОДИН запис у пам\'ять харнеса через інструмент propose_memory. Без хешів і посилань у text — вони йдуть у source.',
        prompt: `Підсумок дослідження: ${draft.answer}\nЗапропонуй один запис kind=outcome про те, що встановлено, repo=fork, paths=["index.js"].`,
        tools: { propose_memory: proposeMemoryTool(proposedStore, (repo) => headSha(repo === 'fork' ? root : '.')) },
        steps: 2,
        signal: AbortSignal.timeout(60_000),
        functionId: `research-${tag}/propose-memory`,
      });
      spent = add(spent, p.usage, performance.now() - t0, p.steps);
      proposal = p.text;
    }

    const wallMs = Math.round(performance.now() - wall0);
    const hay = draft === null ? '' : [draft.answer, ...draft.claims.map((c) => `${c.text} ${c.sha} ${c.file ?? ''}`)].join('\n').toLowerCase();
    const quality = EXPECT.filter((x) => hay.includes(x.toLowerCase())).length / EXPECT.length;
    const blocked = draft === null || isBlockedStrict(verdicts);
    const row = {
      at: new Date().toISOString(),
      config: tag,
      question: QUESTION,
      branchModel: modelId,
      verifierModel: vModel,
      budget,
      rounds,
      stopReason: reason,
      stop,
      wallMs,
      computeMs: Math.round(spent.ms),
      calls: spent.calls,
      modelRequests: spent.modelRequests,
      inputTokens: spent.input,
      outputTokens: spent.output,
      unreported: spent.unreported,
      quality: Number(quality.toFixed(2)),
      repeatedError: firstDraftBadCites > 0,
      firstDraftBadCites,
      citesTotal: citeRows.length,
      citesUnconfirmed: citeRows.filter((c) => !c.ok).length,
      verdicts,
      blocked,
      recall: r === null ? null : { used: r.used, total: r.total, staleDropped: r.staleDropped, staleTexts: r.staleTexts, cutEntries: r.cutEntries, cutBytes: r.cutBytes, bytes: Buffer.byteLength(memText, 'utf8') },
      proposal,
      lanes,
    };

    mkdirSync('docs/lab4/research', { recursive: true });
    mkdirSync('docs/lab4/traces', { recursive: true });
    appendFileSync('docs/lab4/research-runs.jsonl', `${JSON.stringify(row)}\n`);
    writeFileSync(`docs/lab4/traces/research-${tag}.json`, `${JSON.stringify(row, null, 2)}\n`);
    writeFileSync(`docs/lab4/research/cites-${tag}.json`, `${JSON.stringify(citeRows.map((c) => c.cite), null, 2)}\n`);
    writeFileSync('docs/lab4/research-cites.json', `${JSON.stringify(citeRows.map((c) => c.cite), null, 2)}\n`);
    if (draft !== null) {
      const md = [
        `# Дослідження (${tag})`,
        '',
        `**Питання:** ${QUESTION}`,
        '',
        draft.answer,
        '',
        ...draft.claims.map((c, i) => {
          const row2 = citeRows[i];
          const v = verdicts[i];
          return `${i + 1}. ${c.text}\n   — ${row2?.link ?? ''} · цитата: ${row2?.ok === true ? 'існує' : `НЕ існує (${row2?.why ?? '?'})`} · верифікатор: ${v?.verdict ?? '—'}`;
        }),
        '',
        `Брама: ${blocked ? 'ЗАБЛОКОВАНО (не всі твердження pass)' : 'пройдено'} · зупинка: ${reason}`,
        '',
      ].join('\n');
      writeFileSync(`docs/lab4/research/answer-${tag}.md`, md);
    }

    console.log(
      `${tag}: ${blocked ? 'blocked' : 'ok'} · ${(wallMs / 1000).toFixed(1)} с · раундів ${rounds} (${reason}) · ходів ${row.calls} (запитів ${row.modelRequests}) · ` +
        `токени ${row.inputTokens}/${row.outputTokens} · якість ${row.quality} · цитат ${row.citesTotal}, не підтверджено ${row.citesUnconfirmed} · ` +
        `вигадані цитати в 1-му зводі: ${firstDraftBadCites} · вердикти ${verdicts.map((v) => `${v.id}:${v.verdict}`).join(' ') || '—'}` +
        (r !== null ? ` · пам'ять: ${r.used} із ${r.total}, застарілих ${r.staleDropped}, обрізано ${r.cutEntries} (${r.cutBytes} Б)` : ''),
    );
    if (stop === 'quota-429') process.exitCode = 3;
  } finally {
    await stopTracing();
  }
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
