import { z } from "zod";
import { ErrorCode } from "./states";
import { Blocks } from "./blocks";

export const Uuid = z.string().uuid();

/** Item de captura enviado a finalize_capture. O id é gerado no cliente e serve de chave de idempotência. */
export const FinalizeItem = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("image"),
    id: Uuid,
    mime: z.string().max(100),
    size_bytes: z.number().int().positive(),
    position: z.number().int().min(0).max(1000),
    note: z.string().max(2000).optional(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    id: Uuid,
    text: z.string().max(100_000),
    position: z.number().int().min(0).max(1000),
    note: z.string().max(2000).optional(),
  }),
]);
export type FinalizeItem = z.infer<typeof FinalizeItem>;

export const FinalizeRequest = z.strictObject({
  batch_id: Uuid,
  mode: z.enum(["separate", "same_document"]),
  items: z.array(FinalizeItem).min(1).max(50),
});
export type FinalizeRequest = z.infer<typeof FinalizeRequest>;

export const FinalizeItemResult = z.object({
  id: Uuid,
  status: z.enum(["accepted", "rejected"]),
  error_code: ErrorCode.nullable().optional(),
});
export const FinalizeResponse = z.array(FinalizeItemResult);
export type FinalizeResponse = z.infer<typeof FinalizeResponse>;

export const SaveVersionRequest = z.strictObject({
  page_id: Uuid,
  base_version_id: Uuid,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1500),
  blocks: Blocks,
});
export type SaveVersionRequest = z.infer<typeof SaveVersionRequest>;

export const SaveVersionResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), version_id: Uuid, version_no: z.number().int() }),
  /** Conflito: nenhuma das duas alterações é perdida; o cliente reconcilia. */
  z.object({ status: z.literal("conflict"), active_version_id: Uuid }),
]);
export type SaveVersionResponse = z.infer<typeof SaveVersionResponse>;

export const AcceptProposalResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("accepted"), version_id: Uuid }),
  z.object({ status: z.literal("conflict"), active_version_id: Uuid }),
]);

/** Eventos operacionais: nome + contadores; nunca texto bruto. */
export const EVENT_NAMES = [
  "capture_saved_local",
  "upload_completed",
  "processing_completed",
  "processing_failed",
  "page_opened",
  "page_edited",
  "source_opened",
  "capture_deleted",
] as const;
export const EventName = z.enum(EVENT_NAMES);
export type EventName = z.infer<typeof EventName>;
export const EventProps = z.record(z.string().max(40), z.union([z.number(), z.boolean(), z.string().max(40)])).refine((o) => Object.keys(o).length <= 10);

// ---- Contratos reservados para a etapa 3 (sem implementação nesta execução) ----
export const SearchRequest = z.strictObject({
  query: z.string().trim().min(1).max(500),
  topic_id: Uuid.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchRequest = z.infer<typeof SearchRequest>;

export const AskScope = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("topic"), topic_id: Uuid }),
  z.strictObject({ kind: z.literal("page"), page_id: Uuid }),
]);
export const AskRequest = z.strictObject({ scope: AskScope, question: z.string().trim().min(1).max(2000) });
export type AskRequest = z.infer<typeof AskRequest>;
/** Citações precisam apontar para segmentos reais; resposta sem evidência = "insuficiente". */
export const AskResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("answered"), answer: z.string(), citations: z.array(z.object({ segment_id: Uuid, source_id: Uuid })).min(1) }),
  z.object({ status: z.literal("insufficient_evidence") }),
]);

/** Dimensão/modelo de embeddings serão fixados na etapa 3 (migration + config). */
export const EMBEDDING_CONTRACT = { status: "reserved-for-stage-3" } as const;
