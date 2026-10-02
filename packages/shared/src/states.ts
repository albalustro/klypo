import { z } from "zod";

/** Estado local do cliente: pendente local → enviando → recebido (+ rejeitado). */
export const ClientCaptureState = z.enum(["pending", "uploading", "uploaded", "received", "rejected"]);
export type ClientCaptureState = z.infer<typeof ClientCaptureState>;

/**
 * Estado do servidor para uma fonte.
 * na fila → extraindo → estruturando → indexando → pronto,
 * com precisa de revisão, falhou e excluído explícitos.
 */
export const SourceState = z.enum([
  "queued",
  "extracting",
  "structuring",
  "indexing",
  "ready",
  "needs_review",
  "failed",
  "deleted",
]);
export type SourceState = z.infer<typeof SourceState>;

export const JobKind = z.enum(["process_source", "purge_source"]);
export type JobKind = z.infer<typeof JobKind>;
export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const PageState = z.enum(["active", "deleted"]);
export const PageType = z.enum(["reference", "guide", "recommendation", "note"]);
export type PageType = z.infer<typeof PageType>;
export const PageOrigin = z.enum(["single", "document", "synthesis"]);

export const ProposalStatus = z.enum(["pending", "accepted", "rejected"]);

/** Códigos de erro seguros (sem conteúdo) expostos ao cliente. */
export const ErrorCode = z.enum([
  "ai_notice_required",
  "batch_too_large",
  "file_missing",
  "file_too_large",
  "unsupported_mime",
  "unsupported_content",
  "text_too_long",
  "empty_text",
  "mode_not_supported",
  "quota_exceeded",
  "invalid_ai_output",
  "provider_error",
  "source_deleted",
  "unknown",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const NeedsReviewReason = z.enum(["illegible", "insufficient_content"]);
export type NeedsReviewReason = z.infer<typeof NeedsReviewReason>;
