/** Eventos operacionais: só chaves permitidas, só valores primitivos curtos. Nunca conteúdo bruto. */
const ALLOWED = new Set([
  "job_id", "source_id", "kind", "stage", "code", "status", "attempt", "duration_ms", "model",
  "input_tokens", "output_tokens", "pipeline_version", "provider", "http_status", "error_name", "worker",
]);

export type LogSink = (line: string) => void;
let sink: LogSink = (l) => console.log(l);
export const setLogSink = (s: LogSink) => { sink = s; };

export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const out: Record<string, string | number | boolean> = { ts: new Date().toISOString() as string, event };
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 64);
  }
  sink(JSON.stringify(out));
}

/** Descreve um erro sem vazar mensagens do provedor (que podem conter trechos do conteúdo). */
export function safeErrorFields(e: unknown): Record<string, unknown> {
  const err = e as { name?: string; status?: number };
  return { error_name: err?.name ?? "Error", http_status: typeof err?.status === "number" ? err.status : undefined };
}
