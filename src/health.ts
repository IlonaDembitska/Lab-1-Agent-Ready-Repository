import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  /** Версія застосунку: коміт деплою (Vercel додає VERCEL_GIT_COMMIT_SHA сам). Лаб. 4, крок 06. */
  commit: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
