import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),                               // SECRETO
  SUPABASE_URL: z.string().url().optional(),                      // público
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),        // SECRETO — só no worker
  AI_PROVIDER: z.enum(["anthropic", "fake"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),                // SECRETO
  AI_MODEL: z.string().default("claude-opus-5-5"),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  LEASE_SECONDS: z.coerce.number().int().min(10).default(120),
  MAX_IMAGE_BYTES: z.coerce.number().int().default(15 * 1024 * 1024),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  if (c.AI_PROVIDER === "fake" && c.NODE_ENV === "production") {
    throw new Error("AI_PROVIDER=fake é proibido em produção (adaptador de desenvolvimento/teste).");
  }
  if (c.AI_PROVIDER === "anthropic" && !c.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY ausente: defina-a, ou use AI_PROVIDER=fake apenas em desenvolvimento.");
  }
  return c;
}
