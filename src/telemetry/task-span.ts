/**
 * Один прогін задачі = один батьківський спан = один trace_id у журналі (Лаб. 4, крок 06).
 * Імена API звірені з @opentelemetry/api 1.9.1 (встановлена версія):
 *   trace.getTracer(name) · tracer.startActiveSpan(name, fn) · span.setAttribute · span.spanContext().traceId · span.end()
 */
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('lab4-app');

export async function withTaskSpan<T>(taskId: string, fn: (traceId: string) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan('invoke_workflow lab4-task', async (span: Span) => {
    // ім'я з конвенції GenAI: "invoke_workflow {gen_ai.workflow.name}"
    span.setAttribute('gen_ai.workflow.name', 'lab4-task');
    // власний атрибут: у конвенції поля для task_id немає
    span.setAttribute('lab4.task_id', taskId);
    try {
      return await fn(span.spanContext().traceId);
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
