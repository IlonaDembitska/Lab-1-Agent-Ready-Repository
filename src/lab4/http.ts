/** Спільний помічник відповідей (у файлах маршрутів Next.js експортуються лише обробники методів). */
export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
