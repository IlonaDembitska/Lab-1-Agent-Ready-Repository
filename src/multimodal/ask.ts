/**
 * Питання до файлу (Лаб. 4, крок 05): FilePart з обов'язковим mediaType, модель безкоштовного рівня.
 * Перевірки — ДО моделі: білий список, розмір, збіг заявленого типу з сигнатурою байтів.
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { CATALOG } from '../models';

import { precheck, type Rejected } from './limits';

export const MM_MODEL = CATALOG['gemini-3.5-flash-lite'].id;

export const UNKNOWN = 'не знаю';

export function instruction(question: string): string {
  return [
    question,
    `Відповідай коротко, українською. Якщо відповіді у файлі немає або файл нечитабельний — відповідай рівно «${UNKNOWN}» і нічого не вгадуй.`,
    'Якщо файл — PDF, наприкінці відповіді додай номер сторінки у форматі [стор. N].',
  ].join('\n');
}

export type Usage = { inputTokens: number | undefined; outputTokens: number | undefined };
export type Answer = { ok: true; text: string; usage: Usage; ms: number };

export async function askAboutFile(a: { bytes: Uint8Array; mediaType: string; filename: string; question: string }): Promise<Answer | Rejected> {
  const rejected = precheck(a.mediaType, a.bytes.byteLength, a.bytes);
  if (rejected !== null) return rejected;
  const t0 = performance.now();
  const r = await generateText({
    model: google(MM_MODEL),
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction(a.question) },
          // FilePart: mediaType ОБОВ'ЯЗКОВИЙ; data — тегована форма «сирі байти».
          { type: 'file', mediaType: a.mediaType, filename: a.filename, data: { type: 'data', data: a.bytes } },
        ],
      },
    ],
    experimental_telemetry: { isEnabled: true, functionId: `multimodal/${a.mediaType}`, recordInputs: false, recordOutputs: false },
  });
  return { ok: true, text: r.text, usage: { inputTokens: r.totalUsage.inputTokens, outputTokens: r.totalUsage.outputTokens }, ms: Math.round(performance.now() - t0) };
}

/** Текстова база: ТОЙ САМИЙ промпт без файлу — від неї рахується різниця для прогнозу токенів. */
export async function textBaseline(question: string): Promise<Answer> {
  const t0 = performance.now();
  const r = await generateText({
    model: google(MM_MODEL),
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction(question) }] }],
    experimental_telemetry: { isEnabled: true, functionId: 'multimodal/text-baseline', recordInputs: false, recordOutputs: false },
  });
  return { ok: true, text: r.text, usage: { inputTokens: r.totalUsage.inputTokens, outputTokens: r.totalUsage.outputTokens }, ms: Math.round(performance.now() - t0) };
}
