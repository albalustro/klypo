import pg from "pg";
import { loadConfig } from "./config";
import { PgJobDb } from "./db";
import { AnthropicProvider } from "./ai/anthropic";
import { FakeProvider } from "./ai/fake";
import { MemoryObjectStore, SupabaseObjectStore } from "./storage";
import { runLoop, runOnce } from "./worker";
import { logEvent } from "./log";

const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 4 });
const ai = cfg.AI_PROVIDER === "fake" ? new FakeProvider() : new AnthropicProvider(cfg.ANTHROPIC_API_KEY!, cfg.AI_MODEL);
if (cfg.AI_PROVIDER === "fake") logEvent("fake_ai_provider_active", { provider: "fake" });
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários para ler/remover arquivos do Storage.");
const store = cfg.NODE_ENV === "test" ? new MemoryObjectStore() : new SupabaseObjectStore(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

const deps = { db: new PgJobDb(pool), ai, store, maxImageBytes: cfg.MAX_IMAGE_BYTES, leaseSeconds: cfg.LEASE_SECONDS };
if (process.argv.includes("--once")) {
  while (await runOnce(deps, cfg.WORKER_ID)) { /* drena a fila e sai */ }
  await pool.end();
} else {
  const ac = new AbortController();
  for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => ac.abort());
  await runLoop(deps, cfg.WORKER_ID, cfg.POLL_INTERVAL_MS, ac.signal);
  await pool.end();
}
