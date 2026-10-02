import { randomUUID } from "node:crypto";
import {
  AiPageOutput, ExtractionOutput, PIPELINE_VERSION, toPageBlocks, validateAiPage, type ExtractionOutput as Extraction,
} from "@klypo/shared";
import type { AiProvider, Usage } from "./ai/types";
import type { ClaimedJob, JobDb, Status } from "./db";
import { AbortJob, PermanentError, RetryableError } from "./errors";
import { prepareImage } from "./image";
import { logEvent, safeErrorFields } from "./log";
import type { ObjectStore } from "./storage";

export type Deps = {
  db: JobDb; ai: AiProvider; store: ObjectStore;
  maxImageBytes: number; leaseSeconds: number; newId?: () => string;
};
export type Outcome = "created" | "proposal" | "noop" | "needs_review" | "purged" | "retry_scheduled" | "failed" | "aborted";

/** Texto do usuário já é a "transcrição": segmentação determinística por parágrafo, sem IA. */
export function splitText(text: string): Extraction {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const segments: { key: string; text: string }[] = [];
  for (const p of paras) for (let i = 0; i < p.length; i += 4000) segments.push({ key: `s${segments.length + 1}`, text: p.slice(i, i + 4000) });
  return { legibility: "legible", language: "und", segments, issues: [] };
}

const MIN_IMAGE_TEXT_CHARS = 20;
const ok = (r: Status) => {
  if (r.status === "lease_lost" || r.status === "cancelled") throw new AbortJob(r.status);
  return r;
};

async function parseWithRepair<T>(
  label: string, call: (hint?: string) => Promise<{ output: unknown; usage: Usage }>,
  validate: (raw: unknown) => { value?: T; problem?: string }, usage: Usage,
): Promise<T> {
  let hint: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {            // 1 retry de correção de formato
    const r = await call(hint);
    usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens;
    const v = validate(r.output);
    if (v.value !== undefined) return v.value;
    hint = v.problem;
  }
  logEvent("ai_output_rejected", { kind: label });
  throw new PermanentError("invalid_ai_output");
}

export async function processJob(d: Deps, job: ClaimedJob): Promise<Outcome> {
  const t0 = Date.now();
  const base = { job_id: job.id, source_id: job.source_id, kind: job.kind, attempt: job.attempts };
  try {
    const outcome = job.kind === "purge_source" ? await purge(d, job) : await process(d, job);
    logEvent("job_done", { ...base, status: outcome, duration_ms: Date.now() - t0 });
    return outcome;
  } catch (e) {
    if (e instanceof AbortJob) { logEvent("job_aborted", { ...base, code: e.reason }); return "aborted"; }
    const retryable = e instanceof RetryableError;
    const code = e instanceof PermanentError || e instanceof RetryableError ? e.code : "unknown";
    logEvent("job_error", { ...base, code, ...safeErrorFields(e) });
    const r = await d.db.failJob(job, code, retryable || !(e instanceof PermanentError));
    if (job.kind === "process_source" && r.status === "failed") {
      await d.db.recordEvent(job.owner_id, "processing_failed", job.source_id, { code, attempts: job.attempts }).catch(() => {});
    }
    return r.status === "retry_scheduled" ? "retry_scheduled" : r.status === "failed" ? "failed" : "aborted";
  }
}

async function process(d: Deps, job: ClaimedJob): Promise<Outcome> {
  const t0 = Date.now();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const source = ok(await d.db.getSource(job)).source as any;

  // ---- extrair (reaproveita extração já gravada por este job: retry não repete a chamada de IA)
  ok(await d.db.setStage(job, "extracting"));
  let ex = ok(await d.db.getJobExtraction(job));
  if (ex.status === "none") {
    let extraction: Extraction;
    if (source.kind === "text") {
      extraction = splitText(source.text ?? "");
      if (extraction.segments.length === 0) throw new PermanentError("empty_text");
    } else {
      const bytes = await d.store.download(source.object_path);
      if (!bytes) throw new PermanentError("file_missing");
      const prep = await prepareImage(bytes, source.mime, d.maxImageBytes);
      ok(await d.db.setFileInfo(job, prep.hash, prep.mime, bytes.length));
      extraction = await parseWithRepair("extraction", () => d.ai.extract({ original: bytes, derivative: prep.derivative, mediaType: "image/jpeg" }),
        (raw) => { const p = ExtractionOutput.safeParse(raw); return p.success ? { value: p.data } : { problem: p.error.issues.slice(0, 3).map((i) => i.message).join("; ") }; }, usage);
    }
    ex = ok(await d.db.saveExtraction(job, extraction, source.kind === "text" ? "deterministic-split" : d.ai.model, PIPELINE_VERSION));
    ex = ok(await d.db.getJobExtraction(job));
  }

  const segs = Object.entries(ex.segments as Record<string, { id: string; text: string }>)
    .map(([key, v]) => ({ key, id: v.id, text: v.text }))
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
  const chars = segs.reduce((n, s) => n + s.text.length, 0);

  // ---- imagem ilegível/insuficiente: estado de revisão, nunca um resumo plausível
  if (ex.legibility === "illegible") { ok(await d.db.finishNeedsReview(job, "illegible")); return "needs_review"; }
  if (source.kind === "image" && chars < MIN_IMAGE_TEXT_CHARS) { ok(await d.db.finishNeedsReview(job, "insufficient_content")); return "needs_review"; }

  // ---- estruturar + validar evidências contra os segmentos reais
  ok(await d.db.setStage(job, "structuring"));
  const extraction: Extraction = { legibility: ex.legibility, language: ex.language ?? "und", segments: segs.map(({ key, text }) => ({ key, text })), issues: ex.issues ?? [] };
  const page = await parseWithRepair<AiPageOutput>("structure", (hint) => d.ai.structure({ extraction, repairHint: hint }),
    (raw) => {
      const p = AiPageOutput.safeParse(raw);
      if (!p.success) return { problem: p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      const problems = validateAiPage(p.data, extraction);
      return problems.length ? { problem: problems.map((x) => x.detail).slice(0, 3).join("; ") } : { value: p.data };
    }, usage);

  const idByKey = new Map(segs.map((s) => [s.key, s.id]));
  const blocks = toPageBlocks(page, idByKey, d.newId ?? randomUUID);
  ok(await d.db.setStage(job, "indexing"));
  const res = ok(await d.db.persistPage(job, ex.extraction_id, { ...page, blocks }, d.ai.model, { ...usage, provider: d.ai.id }));
  await d.db.recordEvent(job.owner_id, "processing_completed", job.source_id, {
    duration_ms: Date.now() - t0, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, model: d.ai.model, outcome: res.status,
  }).catch(() => {});
  return res.status as Outcome;
}

async function purge(d: Deps, job: ClaimedJob): Promise<Outcome> {
  const t = ok(await d.db.getPurgeTarget(job));
  if (t.kind === "image") await d.store.remove(t.object_path);   // arquivo primeiro; SQL só depois (idempotente)
  ok(await d.db.completePurge(job));
  return "purged";
}
