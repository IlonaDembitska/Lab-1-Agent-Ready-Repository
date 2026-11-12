import { HealthResponse } from '@/src/health';

/** «Процес живий» + версія. Модель НЕ викликається: інакше монітор палить квоту. */
export function GET() {
  const response = HealthResponse.parse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_COMMIT_SHA ?? 'unknown',
  });

  return Response.json(response);
}
