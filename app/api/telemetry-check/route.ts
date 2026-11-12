/** Діагностика (Лаб. 4, крок 06): до якого проєкту Langfuse належать ключі ЦЬОГО деплою. Секретів не повертає. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = (process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
  const pk = process.env.LANGFUSE_PUBLIC_KEY ?? '';
  const sk = process.env.LANGFUSE_SECRET_KEY ?? '';
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
