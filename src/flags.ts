/**
 * Вимикач агентної функціональності БЕЗ деплою (Лаб. 4, крок 06): прапорець у Vercel Global Config
 * (колишній Edge Config, ID стору ecfg_…), читається на КОЖЕН запит. Клієнт — @vercel/edge-config,
 * createClient(рядок підключення).get(key). Рядок підключення Vercel кладе у змінну GLOBAL_CONFIG
 * (у старих проєктах — EDGE_CONFIG); перевірено на своєму проєкті 2026-11-12.
 * Межі на Hobby: 1 стор на проєкт, до 1 МБ, 100 000 читань — і лише 100 ЗАПИСІВ на місяць.
 * Тому тут лише прапорець і межі бюджету, а лічильники витрат — у Redis (src/budget.ts).
 */
import { createClient } from '@vercel/edge-config';

export type FlagReader = (key: string) => Promise<unknown>;

export function connectionString(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.GLOBAL_CONFIG ?? env.EDGE_CONFIG ?? '';
}

let client: ReturnType<typeof createClient> | null = null;

export const edgeConfigReader: FlagReader = async (key) => {
  const conn = connectionString();
  if (conn === '') throw new Error('немає рядка підключення (GLOBAL_CONFIG / EDGE_CONFIG)');
  client ??= createClient(conn);
  return client.get(key);
};

/** Тільки явне true вмикає. Сховище недосяжне → ВИМКНЕНО: запобіжник, що відкривається при збої, — не запобіжник. */
export async function isAgentEnabled(read: FlagReader = edgeConfigReader): Promise<boolean> {
  try {
    return (await read('agentEnabled')) === true;
  } catch {
    return false;
  }
}

/** Досяжність сховища — окремо і БЕЗ глушіння: isAgentEnabled дає false і при «вимкнено», і при збої. */
export async function probeFlagStore(read: FlagReader = edgeConfigReader): Promise<boolean> {
  try {
    await read('agentEnabled');
    return true;
  } catch {
    return false;
  }
}
