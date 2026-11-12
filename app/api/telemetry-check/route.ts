/** Діагностика (Лаб. 4, крок 06): чи приймає Langfuse ключі ЦЬОГО деплою і який це проєкт. Секретів не повертає. */
import { unquoteEnv } from '../../../src/telemetry/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = unquoteEnv(process.env);
  const base = (env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
  const pk = env.LANGFUSE_PUBLIC_KEY ?? '';
  const sk = env.LANGFUSE_SECRET_KEY ?? '';
  const out = { base, publicKeyPrefix: pk.slice(0, 12), hasSecret: sk !== '' };
  try {
    const r = await fetch(`${base}/api/public/projects`, {
      headers: { authorization: 'Basic ' + Buffer.from(`${pk}:${sk}`).toString('base64') },
    });
    const j = (await r.json().catch(() => null)) as { data?: { id: string; name: string }[] } | null;
    return Response.json({ ...out, status: r.status, projects: j?.data?.map((p) => ({ id: p.id, name: p.name })) ?? null });
  } catch (e) {
    return Response.json({ ...out, error: String(e) });
  }
}
