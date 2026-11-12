/**
 * Межі мультимодального входу (Лаб. 4, крок 05). Цей файл імпортують І браузер (app/multimodal/page.tsx),
 * І сервер (app/api/multimodal/route.ts) — константа одна, перевірки дві.
 */

/** Білий список — підмножина MIME, які приймає Gemini. Усе інше відхиляємо самі, до моделі. */
export const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as const;

/**
 * 3 000 000 байтів — СВІДОМО нижче за 4,5 MB тіла функції Vercel Hobby (понад це платформа віддає
 * 413 FUNCTION_PAYLOAD_TOO_LARGE ще до нашого коду). Файл іде у multipart/form-data сирими байтами,
 * без base64; але й у разі base64 (+≈1/3) 3 MB → ~4 MB — усе ще під стелею.
 */
export const MAX_BYTES = 3_000_000;

export const isAllowed = (t: string): boolean => (ALLOWED as readonly string[]).includes(t);

export function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`;
}

/**
 * Справжній тип за СИГНАТУРОЮ байтів (не за розширенням і не за тим, що заявив клієнт).
 * null — сигнатура невідома.
 */
export function sniffMediaType(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? -1;
  const ascii = (i: number, s: string) => [...s].every((ch, k) => at(i + k) === ch.charCodeAt(0));
  if (at(0) === 0x89 && ascii(1, 'PNG')) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (ascii(0, '%PDF')) return 'application/pdf';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if ((ascii(0, 'II') && at(2) === 42 && at(3) === 0) || (ascii(0, 'MM') && at(2) === 0 && at(3) === 42)) return 'image/tiff';
  if (ascii(4, 'ftyp') && (ascii(8, 'heic') || ascii(8, 'heix') || ascii(8, 'mif1'))) return 'image/heic';
  return null;
}

export type Rejected = { ok: false; reason: 'mediaType' | 'size' | 'mismatch' | 'empty'; detail: string };

/** Перевірка до моделі. Повертає відмову або null. Ту саму функцію кличе браузер (без байтів — лише тип і розмір). */
export function precheck(declared: string, size: number, bytes?: Uint8Array): Rejected | null {
  if (size === 0) return { ok: false, reason: 'empty', detail: 'порожній файл' };
  if (!isAllowed(declared)) return { ok: false, reason: 'mediaType', detail: `тип ${declared || 'невідомий'} не підтримується; можна: PNG, JPEG, WEBP, HEIC, PDF` };
  if (size > MAX_BYTES) return { ok: false, reason: 'size', detail: `файл ${formatBytes(size)} більший за ліміт ${formatBytes(MAX_BYTES)}` };
  if (bytes !== undefined) {
    const real = sniffMediaType(bytes);
    if (real !== declared) return { ok: false, reason: 'mismatch', detail: `заявлено ${declared}, а за вмістом це ${real ?? 'невідомий тип'}` };
  }
  return null;
}
