/**
 * Виконавець однієї задачі (Лаб. 3, крок 00).
 * Один виклик = один прогін = тека з чотирма файлами: patch.diff, output.txt, agent.log, run.json.
 * Ядро executeTask не знає ні про git, ні про OpenCode — їх підставляє викликач (у тестах — підробки).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface Task {
  readonly id: string;
  readonly input: string;
  readonly acceptance: readonly string[];
  readonly budget: { readonly max_turns: number; readonly max_usd: number; readonly timeout_s: number };
  readonly files?: readonly string[];
  // ---- поля evals (крок 04), необовʼязкові: старі рядки черги парсяться як і раніше ----
  /** Еталонна мітка: один ключ на оцінювача, значення — очікуваний результат. */
  readonly label?: Readonly<Record<string, boolean>>;
  /** Звідки задача взялася: тека прогону в docs/lab3/runs/, артефакт калібрування або траса. */
  readonly source?: string;
  readonly bucket?: 'regression' | 'new' | 'edge';
  /** Дата заморозки банку, РРРР-ММ-ДД. */
  readonly frozen_at?: string;
}

/**
 * stalled — агент замовк: довше за idle-ліміт не прийшло жодної події. Так OpenCode 1.19 поводиться
 * після відмови в дозволі на команду оболонки (крок 04: t-10 висіла до таймауту 420 с у кожному прогоні).
 */
export type Status = 'pass' | 'fail' | 'agent_error' | 'max_turns' | 'max_usd' | 'timeout' | 'stalled';

export interface CheckResult { readonly cmd: string; readonly code: number; readonly ms: number }

export interface RunRecord {
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: Status;
  readonly turns: number;
  readonly costUsd: number;
  /** Токени з подій OpenCode (поля tokens.input / tokens.output), якщо провайдер їх повертає. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly budget: Task['budget'];
  readonly agentExit: number | null;
  readonly agentError: string | null;
  /** Скільки разів OpenCode відмовив агенту в дозволі на виклик інструмента. */
  readonly deniedToolCalls: number;
  readonly checks: readonly CheckResult[];
  readonly changedFiles: readonly string[];
  readonly branch: string | null;
}

export interface Workspace {
  readonly dir: string;
  readonly branch: string | null;
  /** Фіксує зміни агента й повертає diff та список файлів. */
  collect(): Promise<{ diff: string; files: string[] }>;
  cleanup(): Promise<void>;
}

export interface Deps {
  readonly agent: string;
  readonly model: string;
  prepare(task: Task): Promise<Workspace>;
  /** Запускає агента; кожен рядок його виводу — в onLine; signal зупиняє процес. */
  runAgent(ws: Workspace, prompt: string, onLine: (line: string) => void, signal: AbortSignal): Promise<number>;
  runCheck(ws: Workspace, cmd: string): Promise<{ code: number; output: string }>;
  /**
   * Скільки чекати, поки агент завершиться після сигналу зупинки. Далі executeTask іде далі сам:
   * завислий процес не має права тримати чергу (баг кроку 04: таймаут 420 с, фактично 3660 с).
   */
  readonly abortGraceMs?: number;
  /** Скільки тиші (без жодної події від агента) вважати зависанням → status stalled. Типово HARNESS_IDLE_S або 120 с. */
  readonly idleMs?: number;
}

/** Хід агента = подія початку кроку у JSON-виводі OpenCode. */
export function isTurnEvent(e: Record<string, unknown>): boolean {
  return typeof e.type === 'string' && /step.?start/i.test(e.type);
}

/** Сума полів cost у події (якщо провайдер їх повертає). */
export function eventCost(e: unknown): number {
  if (e === null || typeof e !== 'object') return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'cost' && typeof v === 'number') sum += v;
    else if (typeof v === 'object') sum += eventCost(v);
  }
  return sum;
}

/** Сума токенів у події: обʼєкти tokens { input, output } на будь-якій глибині. */
export function eventTokens(e: unknown): { input: number; output: number } {
  const sum = { input: 0, output: 0 };
  if (e === null || typeof e !== 'object') return sum;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'tokens' && v !== null && typeof v === 'object') {
      const t = v as Record<string, unknown>;
      if (typeof t.input === 'number') sum.input += t.input;
      if (typeof t.output === 'number') sum.output += t.output;
    } else if (typeof v === 'object') {
      const inner = eventTokens(v);
      sum.input += inner.input;
      sum.output += inner.output;
    }
  }
  return sum;
}

export function buildPrompt(task: Task): string {
  return [
    task.input,
    '',
    'Правила: працюй лише в поточному репозиторії; не комітуй і не пуш; не змінюй файли поза потрібними.',
    `Після змін перевір себе командами: ${task.acceptance.join(' ; ')}`,
    'Оболонка обмежена: дозволені лише npm test, npx vitest, npx tsc, npm run typecheck, npm run lint, git status, git diff. ' +
      'Файли й теки дивись інструментами read / glob / grep, а не ls чи cat — інші команди оболонки буде відхилено.',
  ].join('\n');
}

export async function executeTask(task: Task, deps: Deps, outDir: string): Promise<RunRecord> {
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const log: string[] = [];
  let turns = 0;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: Status | null = null;
  let agentExit: number | null = null;
  let agentError: string | null = null;
  let deniedToolCalls = 0;
  let lastEventAt = Date.now();
  const checks: CheckResult[] = [];
  const outputs: string[] = [];
  let diff = '';
  let files: string[] = [];
  let ws: Workspace | null = null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    stopReason = 'timeout';
    ctrl.abort();
  }, task.budget.timeout_s * 1000);
  const idleMs = deps.idleMs ?? Number(process.env.HARNESS_IDLE_S ?? 120) * 1000;
  const watchdog = setInterval(() => {
    if (stopReason === null && Date.now() - lastEventAt > idleMs) {
      stopReason = 'stalled';
      ctrl.abort();
    }
  }, Math.max(10, Math.min(5_000, Math.floor(idleMs / 4))));

  try {
    ws = await deps.prepare(task);
    const onLine = (line: string): void => {
      log.push(line);
      lastEventAt = Date.now();
      if (line.includes('prevents you from using this specific tool call')) deniedToolCalls += 1;
      let e: unknown;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      if (e === null || typeof e !== 'object') return;
      if (isTurnEvent(e as Record<string, unknown>)) turns += 1;
      costUsd += eventCost(e);
      const tk = eventTokens(e);
      inputTokens += tk.input;
      outputTokens += tk.output;
      if (turns > task.budget.max_turns && stopReason === null) {
        stopReason = 'max_turns';
        ctrl.abort();
      }
      if (costUsd > task.budget.max_usd && stopReason === null) {
        stopReason = 'max_usd';
        ctrl.abort();
      }
    };
    const run = deps.runAgent(ws, buildPrompt(task), onLine, ctrl.signal);
    // Жорсткий запобіжник: після abort чекаємо не довше abortGraceMs, навіть якщо процес не закрився.
    const hard = new Promise<number>((res) => {
      ctrl.signal.addEventListener(
        'abort',
        () => {
          const t = setTimeout(() => res(-2), deps.abortGraceMs ?? 15_000);
          t.unref();
        },
        { once: true },
      );
    });
    agentExit = await Promise.race([run, hard]);
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    clearInterval(watchdog);
  }

  try {
    if (ws !== null) {
      if (stopReason === null && agentError === null) {
        for (const cmd of task.acceptance) {
          const t0 = Date.now();
          const r = await deps.runCheck(ws, cmd);
          checks.push({ cmd, code: r.code, ms: Date.now() - t0 });
          outputs.push(`$ ${cmd}\n${r.output}\n[код виходу ${r.code}]\n`);
        }
      }
      const c = await ws.collect();
      diff = c.diff;
      files = c.files;
    }
  } catch (err) {
    agentError = agentError ?? (err instanceof Error ? err.message : String(err));
  } finally {
    if (ws !== null) await ws.cleanup().catch(() => undefined);
  }

  let status: Status;
  if (stopReason !== null) status = stopReason;
  else if (agentError !== null) status = 'agent_error';
  else status = checks.length > 0 && checks.every((c) => c.code === 0) ? 'pass' : 'fail';

  const record: RunRecord = {
    id: task.id,
    agent: deps.agent,
    model: deps.model,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(1, Date.now() - started),
    status,
    turns,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    inputTokens,
    outputTokens,
    budget: task.budget,
    agentExit,
    agentError,
    deniedToolCalls,
    checks,
    changedFiles: files,
    branch: ws === null ? null : ws.branch,
  };
  writeFileSync(join(outDir, 'patch.diff'), diff);
  writeFileSync(join(outDir, 'output.txt'), outputs.join('\n') || `перевірки не запускались: ${status}\n`);
  writeFileSync(join(outDir, 'agent.log'), `${log.join('\n')}\n`);
  writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// ---------------- справжні залежності: git worktree + OpenCode ----------------

function sh(cmd: string, args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, [...args], { cwd, env: process.env });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', (e) => res({ code: 127, output: `${out}${e.message}` }));
    p.on('close', (code) => res({ code: code ?? 1, output: out }));
  });
}

export function realDeps(root: string, opts: { model: string; push: boolean }): Deps {
  const config = resolve(root, 'scripts/harness/opencode.harness.json');
  return {
    agent: 'opencode run --format json (дозволи: scripts/harness/opencode.harness.json, без --auto)',
    model: opts.model,
    async prepare(task) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const branch = `harness/${task.id}-${stamp}`;
      const dir = resolve(root, '..', 'harness-runs', `${task.id}-${stamp}`);
      // База — main; у CI HARNESS_BASE=HEAD, щоб оцінювати саме поточний коміт.
      const add = await sh('git', ['worktree', 'add', '-b', branch, dir, process.env.HARNESS_BASE ?? 'main'], root);
      if (add.code !== 0) throw new Error(`git worktree add: ${add.output}`);
      symlinkSync(resolve(root, 'node_modules'), join(dir, 'node_modules'));
      const exclude = ['.', ':(exclude)node_modules', ':(exclude).agent-log'];
      return {
        dir,
        branch,
        async collect() {
          await sh('git', ['add', '-A', '--', ...exclude], dir);
          const names = await sh('git', ['diff', '--cached', '--name-only'], dir);
          const d = await sh('git', ['diff', '--cached'], dir);
          const files = names.output.split('\n').filter((l) => l.trim() !== '');
          if (files.length > 0) {
            await sh('git', ['commit', '-q', '-m', `harness ${task.id}: зміни агента`], dir);
            if (opts.push) await sh('git', ['push', '-q', '-u', 'origin', branch], dir);
          }
          return { diff: d.output, files };
        },
        async cleanup() {
          await sh('git', ['worktree', 'remove', '--force', dir], root);
        },
      };
    },
    runAgent(ws, prompt, onLine, signal) {
      return new Promise((res, rej) => {
        // detached: процес OpenCode — лідер власної групи, тож зупиняємо всю групу разом
        // із дочірніми процесами, які тримали відкритими stdout/stderr (через них 'close' не приходив).
        const p = spawn('opencode', ['run', '--format', 'json', '-m', opts.model, '--dir', ws.dir, prompt], {
          cwd: ws.dir,
          env: { ...process.env, OPENCODE_CONFIG: config },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
        const killGroup = (sig: NodeJS.Signals): void => {
          try {
            if (p.pid !== undefined) process.kill(-p.pid, sig);
          } catch {
            /* група вже завершилась */
          }
        };
        const onAbort = (): void => {
          killGroup('SIGTERM');
          setTimeout(() => killGroup('SIGKILL'), 5_000).unref();
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        let buf = '';
        const feed = (d: Buffer): void => {
          buf += d.toString();
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) onLine(l);
        };
        p.stdout.on('data', feed);
        p.stderr.on('data', (d: Buffer) => onLine(`[stderr] ${d.toString().trim()}`));
        p.on('error', (e) => (signal.aborted ? res(-1) : rej(e)));
        // 'exit', а не лише 'close': close чекає закриття потоків, які могли успадкувати онуки процесу.
        p.on('exit', (code) => {
          signal.removeEventListener('abort', onAbort);
          if (buf !== '') onLine(buf);
          buf = '';
          res(code ?? -1);
        });
      });
    },
    runCheck(ws, cmd) {
      return sh('sh', ['-c', cmd], ws.dir);
    },
  };
}
