import { describe, expect, it } from 'vitest';
import { unquote, unquoteEnv } from '../src/telemetry/env';

describe('unquote (секрети, вставлені з лапками)', () => {
  it('знімає подвійні та одинарні лапки по краях', () => {
    expect(unquote('"pk-lf-abc"')).toBe('pk-lf-abc');
    expect(unquote("'sk-lf-abc'")).toBe('sk-lf-abc');
  });
  it('не чіпає значення без лапок і непарні лапки', () => {
    expect(unquote('pk-lf-abc')).toBe('pk-lf-abc');
    expect(unquote('"pk-lf-abc')).toBe('"pk-lf-abc');
    expect(unquote(undefined)).toBeUndefined();
  });
  it('unquoteEnv чистить лише LANGFUSE_*', () => {
    const e = unquoteEnv({ LANGFUSE_PUBLIC_KEY: '"pk"', OTHER: '"x"' });
    expect(e.LANGFUSE_PUBLIC_KEY).toBe('pk');
    expect(e.OTHER).toBe('"x"');
  });
});
