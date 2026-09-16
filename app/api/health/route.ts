import { HealthResponse } from '@/src/health';

export function GET() {
  const response = HealthResponse.parse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });

  return Response.json(response);
}
