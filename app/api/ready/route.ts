/** «Мені можна давати запит»: ключ на місці, сховище прапорця досяжне, добовий бюджет не вичерпано. Модель НЕ викликається. */
import { checkDailyBudget } from '@/src/budget';
import { probeFlagStore } from '@/src/flags';
import { readiness } from '@/src/lab4/guard';
import { json } from '@/src/lab4/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const r = await readiness({ probe: () => probeFlagStore(), budget: () => checkDailyBudget() });
  return json(r, r.ok ? 200 : 503);
}
