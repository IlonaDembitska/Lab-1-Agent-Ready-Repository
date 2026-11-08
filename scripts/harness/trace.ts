/**
 * Траса прогону харнесу (Лаб. 3, крок 06).
 * Виконавець — CLI OpenCode, а не виклик AI SDK у нашому процесі, тож спани AI SDK тут не виникають.
 * Ми будуємо ту саму структуру за конвенціями GenAI з потоку подій OpenCode (agent.log, --format json):
 *   invoke_agent {model}  — увесь прогін (INTERNAL, кореневий)
 *     chat {model}        — один крок агента: від step_start до step_finish (CLIENT)
 *       execute_tool {tool} — один виклик інструмента всередині кроку (INTERNAL)
 * Час — справжні timestamp подій, тому те саме працює і наживо, і для відтворення старих журналів.
 * Уміст промптів, відповідей, входів і виходів інструментів у спани НЕ пишемо (recordInputs/Outputs = false).
 */
import { context, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export interface SpanPlan {
  readonly name: string;
  readonly kind: 'internal' | 'client';
  readonly start: number;
  readonly end: number;
  readonly attributes: Attributes;
  readonly errorType: string | null;
  readonly children: readonly SpanPlan[];
}

export interface RunSummary {
  readonly id: string;
  readonly model: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly turns: number;
  readonly deniedToolCalls?: number;
}

interface Ev {
  readonly type?: string;
  readonly timestamp?: number;
  readonly part?: {
    readonly reason?: string;
    readonly tool?: string;
    readonly callID?: string;
    readonly tokens?: { readonly input?: number; readonly output?: number };
    readonly state?: { readonly status?: string; readonly error?: unknown; readonly time?: { readonly start?: number; readonly end?: number } };
  };
}

const DENIED = 'prevents you from using this specific tool call';
/** Статуси, якими зупиняє НАШ код (крок 03) — клас «харнес», а не помилка агента. */
const HARNESS_STOPS = new Set(['timeout', 'max_turns', 'max_usd', 'stalled']);

export function parseEvents(lines: readonly string[]): Ev[] {
  const out: Ev[] = [];
  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    try {
      out.push(JSON.parse(l) as Ev);
    } catch {
      /* обрізаний рядок — пропускаємо */
    }
  }
  return out;
}

function toolSpan(e: Ev, fallbackEnd: number): SpanPlan {
  const st = e.part?.state ?? {};
  const err = st.error === undefined ? '' : String(st.error);
  const errorType = st.status === 'error' ? (err.includes(DENIED) ? 'permission_denied' : 'tool_error') : null;
  const start = st.time?.start ?? e.timestamp ?? fallbackEnd;
  return {
    name: `execute_tool ${e.part?.tool ?? 'unknown'}`,
    kind: 'internal',
    start,
    end: Math.max(start, st.time?.end ?? e.timestamp ?? start),
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': e.part?.tool ?? 'unknown',
      'gen_ai.tool.call.id': e.part?.callID ?? '',
      'harness.tool.status': st.status ?? 'unknown',
    },
    errorType,
    children: [],
  };
}

/** Чиста функція: події → дерево спанів. Без мережі й без OTel — тому покрита тестами. */
export function planSpans(rec: RunSummary, events: readonly Ev[]): SpanPlan {
  const t0 = Date.parse(rec.startedAt);
  const t1 = Date.parse(rec.finishedAt);
  const steps: SpanPlan[] = [];
  // Відкритий крок тримаємо в обʼєкті: TS не відстежує присвоєння змінній усередині замикання.
  const cur: { open: { start: number; tools: SpanPlan[] } | null } = { open: null };
  let lastReason = '';
  let inTok = 0;
  let outTok = 0;
  const loose: SpanPlan[] = [];
  const closeStep = (end: number, reason: string | undefined, tk: { input?: number; output?: number } | undefined, finished: boolean) => {
    const open = cur.open;
    if (open === null) return;
    const input = tk?.input ?? 0;
    const output = tk?.output ?? 0;
    inTok += input;
    outTok += output;
    steps.push({
      name: `chat ${rec.model}`,
      kind: 'client',
      start: open.start,
      end: Math.max(open.start, end),
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'opencode',
        'gen_ai.request.model': rec.model,
        'gen_ai.response.finish_reasons': finished ? [reason ?? 'unknown'] : [],
        'gen_ai.usage.input_tokens': input,
        'gen_ai.usage.output_tokens': output,
        'harness.step.finished': finished,
      },
      // Крок почався, а відповіді моделі так і не прийшло — головна ознака зависання.
      errorType: finished ? null : 'no_response',
      children: open.tools,
    });
    if (finished && reason) lastReason = reason;
    cur.open = null;
  };
  for (const e of events) {
    const ts = e.timestamp ?? t1;
    if (e.type === 'step_start') {
      closeStep(ts, undefined, undefined, false);
      cur.open = { start: ts, tools: [] };
    } else if (e.type === 'tool_use') {
      (cur.open?.tools ?? loose).push(toolSpan(e, ts));
    } else if (e.type === 'step_finish') {
      closeStep(ts, e.part?.reason, e.part?.tokens, true);
    }
  }
  closeStep(t1, undefined, undefined, false);
  const harnessStop = HARNESS_STOPS.has(rec.status);
  return {
    name: `invoke_agent ${rec.model}`,
    kind: 'internal',
    start: t0,
    end: Math.max(t0, t1),
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'opencode',
      'gen_ai.request.model': rec.model,
      'gen_ai.agent.name': 'harness-run-task',
      'gen_ai.response.finish_reasons': lastReason === '' ? [] : [lastReason],
      'gen_ai.usage.input_tokens': inTok,
      'gen_ai.usage.output_tokens': outTok,
      'harness.task_id': rec.id,
      'harness.exit_status': rec.status,
      'harness.turns': rec.turns,
      'harness.chat_spans': steps.length,
      'harness.denied_tool_calls': rec.deniedToolCalls ?? 0,
      'harness.stopped_by_harness': harnessStop,
    },
    errorType: rec.status === 'pass' ? null : rec.status,
    children: [...loose, ...steps],
  };
}

/** Надсилає дерево спанів у зареєстрований TracerProvider; повертає trace_id. */
export function emitPlan(plan: SpanPlan): string {
  const tracer = trace.getTracer('lab3-harness');
  const emit = (p: SpanPlan, parentCtx: ReturnType<typeof context.active>): string => {
    const span = tracer.startSpan(
      p.name,
      { kind: p.kind === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL, startTime: p.start, attributes: p.attributes },
      parentCtx,
    );
    if (p.errorType !== null) {
      span.setAttribute('error.type', p.errorType);
      span.setStatus({ code: SpanStatusCode.ERROR, message: p.errorType });
    }
    const ctx = trace.setSpan(parentCtx, span);
    for (const c of p.children) emit(c, ctx);
    span.end(p.end);
    return span.spanContext().traceId;
  };
  return emit(plan, context.active());
}

/** Текстова витяжка для docs/lab3/traces/: поля, за якими зроблено висновок (без умісту промптів). */
export function extract(plan: SpanPlan, traceId: string): string {
  const lines = [`trace_id: ${traceId}`, `root: ${plan.name}`];
  for (const [k, v] of Object.entries(plan.attributes)) lines.push(`  ${k} = ${JSON.stringify(v)}`);
  if (plan.errorType !== null) lines.push(`  error.type = ${plan.errorType}`);
  lines.push(`тривалість: ${((plan.end - plan.start) / 1000).toFixed(1)} с · дочірніх спанів: ${plan.children.length}`);
  for (const c of plan.children) {
    const fr = c.attributes['gen_ai.response.finish_reasons'];
    lines.push(`- ${c.name} · ${((c.end - c.start) / 1000).toFixed(1)} с${fr !== undefined ? ` · finish_reasons=${JSON.stringify(fr)}` : ''}${c.errorType ? ` · error.type=${c.errorType}` : ''}`);
    for (const t of c.children) lines.push(`    - ${t.name} · ${String(t.attributes['harness.tool.status'])}${t.errorType ? ` · error.type=${t.errorType}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
