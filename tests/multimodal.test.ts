import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MAX_BYTES, precheck, sniffMediaType } from '../src/multimodal/limits';
import { fileTokenDelta, imageTokens, pdfTokens, pngSize } from '../src/multimodal/predict';
import { wordRecall } from '../src/multimodal/speak';
import { pageOf } from '../scripts/multimodal/run-cases';

const fx = (f: string) => new Uint8Array(readFileSync(`fixtures/lab4-mm/${f}`));

describe('мультимодальні межі', () => {
  it('ліміт нижче за 4,5 MB і з запасом на base64', () => {
    expect(MAX_BYTES).toBeLessThan(4_500_000);
    expect(Math.ceil(MAX_BYTES / 3) * 4).toBeLessThan(4_500_000);
  });

  it('тип за сигнатурою байтів, а не за розширенням', () => {
    expect(sniffMediaType(fx('page-clear.png'))).toBe('image/png');
    expect(sniffMediaType(fx('scan-blurred.jpg'))).toBe('image/jpeg');
    expect(sniffMediaType(fx('spec-3p.pdf'))).toBe('application/pdf');
    expect(sniffMediaType(fx('photo.tiff'))).toBe('image/tiff');
  });

  it('відмови до моделі: тип, розмір, невідповідність, порожній', () => {
    expect(precheck('image/tiff', 10)?.reason).toBe('mediaType');
    expect(precheck('application/pdf', MAX_BYTES + 1)?.reason).toBe('size');
    expect(precheck('application/pdf', 100, fx('page-clear.png'))?.reason).toBe('mismatch');
    expect(precheck('image/png', 0)?.reason).toBe('empty');
    expect(precheck('image/png', 100, fx('page-clear.png'))).toBeNull();
  });
});

describe('прогноз токенів', () => {
  it('258 на сторінку / на малу картинку / плитки 768', () => {
    expect(pdfTokens(3)).toBe(774);
    expect(imageTokens(320, 200)).toBe(258);
    expect(imageTokens(1600, 1200)).toBe(1548);
    expect(pngSize(fx('big-1600x1200.png'))).toEqual({ w: 1600, h: 1200 });
    expect(fileTokenDelta(undefined, 10)).toBe('не повідомлено');
    expect(fileTokenDelta(400, 100)).toBe(300);
  });
});

describe('детерміновані перевірки набору', () => {
  it('номер сторінки з відповіді і схожість round-trip', () => {
    expect(pageOf('Таймаут — 45 секунд [стор. 3]')).toBe(3);
    expect(pageOf('без сторінки')).toBeNull();
    expect(wordRecall('Stop at the red light.', 'stop at the red light')).toBe(1);
    expect(wordRecall('Зупиніться на червоне', 'зупиніться')).toBeCloseTo(1 / 3);
  });
});
