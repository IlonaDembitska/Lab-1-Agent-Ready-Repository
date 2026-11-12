/**
 * Лаб. 4, крок 06 — знахідка: значення LANGFUSE_* на Vercel були вставлені з .env.local РАЗОМ із лапками
 * ("pk-lf-…") → Langfuse 401 → трейси мовчки губились. Знімаємо одну пару лапок по краях.
 */
const KEYS = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_BASE_URL'] as const;

export function unquote(v: string | undefined): string | undefined {
  if (v === undefined) return v;
  const t = v.trim();
  return /^(["']).*\1$/s.test(t) ? t.slice(1, -1) : t;
}

export function unquoteEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const k of KEYS) out[k] = unquote(env[k]);
  return out;
}
