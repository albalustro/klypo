import { processJob, type Deps } from "./pipeline";
import { logEvent } from "./log";
import { AbortJob } from "./errors";

/** Processa um job (se houver) mantendo o lease vivo durante chamadas longas. */
export async function runOnce(d: Deps, workerId: string): Promise<boolean> {
  const job = await d.db.claim(workerId, d.leaseSeconds);
  if (!job) return false;
  const timer = setInterval(() => {
    d.db.heartbeat(job, d.leaseSeconds).catch(() => {});
  }, Math.max(1000, (d.leaseSeconds * 1000) / 3));
  try { await processJob(d, job); } finally { clearInterval(timer); }
  return true;
}

export async function runLoop(d: Deps, workerId: string, pollMs: number, signal: AbortSignal) {
  logEvent("worker_started", { worker: workerId });
  while (!signal.aborted) {
    let worked = false;
    try { worked = await runOnce(d, workerId); }
    catch (e) { if (!(e instanceof AbortJob)) logEvent("worker_loop_error", { error_name: (e as Error).name }); }
    if (!worked) await new Promise((r) => setTimeout(r, pollMs));
  }
  logEvent("worker_stopped", { worker: workerId });
}
