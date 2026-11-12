/**
 * Мультимодальний маршрут (Лаб. 4, крок 05). multipart/form-data:
 *   mode=ask       file + mediaType + question → відповідь за файлом
 *   mode=baseline  question                   → той самий промпт БЕЗ файлу (текстова база токенів)
 *   mode=speak     text                       → аудіо відповіді (generateSpeech)
 *   mode=roundtrip text                       → generateSpeech → transcribe → схожість
 * Тіло понад 4,5 MB сюди не доходить: платформа віддає 413 FUNCTION_PAYLOAD_TOO_LARGE раніше.
 */
import { after } from 'next/server';

import { langfuseSpanProcessor } from '../../../instrumentation';
import { recordUsage } from '../../../src/budget';
import { guard } from '../../../src/lab4/guard';
import { askAboutFile, textBaseline } from '../../../src/multimodal/ask';
import { MAX_BYTES } from '../../../src/multimodal/limits';
import { listen, speak, wordRecall } from '../../../src/multimodal/speak';

export const runtime = 'nodejs';
export const maxDuration = 60;

const str = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === 'string' ? v.trim() : '';
};

export async function POST(request: Request) {
  after(async () => {
    await langfuseSpanProcessor.forceFlush();
  });
  // СЕРВЕРНА перевірка тієї ж константи: ловить запити не з нашої форми.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES + 100_000) {
    return Response.json({ ok: false, reason: 'size', detail: `тіло ${declared} B більше за ліміт ${MAX_BYTES} B` }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  if (form === null) return Response.json({ ok: false, reason: 'bad-request', detail: 'очікую multipart/form-data' }, { status: 400 });
  const mode = str(form, 'mode') || 'ask';
  // Крок 06: вимикач і стеля витрат — перед будь-якою моделлю
  const blocked = await guard();
  if (blocked !== null) return blocked;

  try {
    if (mode === 'baseline') {
      const q = str(form, 'question');
      if (q === '') return Response.json({ ok: false, reason: 'bad-request', detail: 'question порожній' }, { status: 400 });
      return Response.json(await textBaseline(q));
    }
    if (mode === 'speak' || mode === 'roundtrip') {
      const text = str(form, 'text').slice(0, 1000);
      if (text === '') return Response.json({ ok: false, reason: 'bad-request', detail: 'text порожній' }, { status: 400 });
      const s = await speak(text);
      if (mode === 'speak') {
        return Response.json({ ok: true, mediaType: s.mediaType, audioBase64: Buffer.from(s.bytes).toString('base64'), ms: s.ms });
      }
      const t = await listen(s.bytes);
      return Response.json({ ok: true, transcript: t.text, recall: wordRecall(text, t.text), ttsMs: s.ms, sttMs: t.ms, audioBytes: s.bytes.byteLength, audioMediaType: s.mediaType });
    }
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ ok: false, reason: 'empty', detail: 'файл не передано' }, { status: 400 });
    const mediaType = str(form, 'mediaType') || file.type;
    const r = await askAboutFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType,
      filename: file.name,
      question: str(form, 'question') || 'Що в цьому файлі?',
    });
    if (!r.ok) return Response.json(r, { status: r.reason === 'size' ? 413 : 415 });
    await recordUsage(r.usage).catch(() => undefined);
    return Response.json(r);
  } catch (err) {
    return Response.json({ ok: false, reason: 'model', detail: err instanceof Error ? err.message.slice(0, 300) : String(err) }, { status: 502 });
  }
}
