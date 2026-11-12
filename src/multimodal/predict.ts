/** Прогноз токенів файлу (Лаб. 4, крок 05). Порівнюється НЕ з inputTokens, а з різницею «з файлом мінус текстова база». */

/** PDF: «Each document page is equivalent to 258 tokens». */
export const pdfTokens = (pages: number): number => pages * 258;

/** Зображення: 258, якщо ОБИДВІ сторони ≤ 384 px; інакше плитки 768×768 по 258. */
export function imageTokens(w: number, h: number): number {
  if (w <= 384 && h <= 384) return 258;
  return Math.ceil(w / 768) * Math.ceil(h / 768) * 258;
}

/** Аудіо: «32 tokens per second of audio (1 minute = 1,920 tokens)». */
export const audioTokens = (seconds: number): number => Math.ceil(seconds) * 32;

/** Ширина й висота PNG із заголовка IHDR (без бібліотек). null — не PNG. */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || b[0] !== 0x89) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/** Різниця з базою; «не повідомлено», якщо провайдер не дав чисел. */
export function fileTokenDelta(withFile: number | undefined, base: number | undefined): number | 'не повідомлено' {
  return withFile === undefined || base === undefined ? 'не повідомлено' : withFile - base;
}
