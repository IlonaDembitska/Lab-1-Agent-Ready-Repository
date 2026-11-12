/**
 * Вихід (Лаб. 4, крок 05): відповідь асистента голосом — generateSpeech; transcribe — для round-trip перевірки.
 * Обидві функції в ai@7 НЕ експериментальні (experimental_* — застарілі аліаси). Моделі — «Free of charge».
 * voice / outputFormat / language НЕ задаю: допустимих значень у перевірених джерелах немає — спершу дивлюсь результат.
 */
import { google } from '@ai-sdk/google';
import { generateSpeech, transcribe } from 'ai';

export const TTS_MODEL = 'gemini-3.8-flash-tts';
export const STT_MODEL = 'gemini-3.5-transcribe';

export async function speak(text: string): Promise<{ bytes: Uint8Array; mediaType: string; ms: number }> {
  const t0 = performance.now();
  const res = await generateSpeech({ model: google.speech(TTS_MODEL), text });
  return { bytes: res.audio.uint8Array, mediaType: res.audio.mediaType, ms: Math.round(performance.now() - t0) };
}

export async function listen(audio: Uint8Array): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  const res = await transcribe({ model: google.transcription(STT_MODEL), audio });
  return { text: res.text, ms: Math.round(performance.now() - t0) };
}

/** Схожість транскрипції з оригіналом: частка слів оригіналу, що є в транскрипції (без регістру й розділових знаків). */
export function wordRecall(original: string, transcript: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w !== '');
  const a = words(original);
  const b = new Set(words(transcript));
  return a.length === 0 ? 0 : a.filter((w) => b.has(w)).length / a.length;
}
