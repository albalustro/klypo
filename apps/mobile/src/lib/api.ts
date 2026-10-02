import {
  AcceptProposalResponse, Blocks, FinalizeRequest, FinalizeResponse, SaveVersionRequest, SaveVersionResponse, type Block,
  type SourceState,
} from "@klypo/shared";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); }
}
function check(r: { data: any; error: { message: string; code?: string } | null }): any {
  if (r.error) {
    // mensagens de erro do servidor não são exibidas cruas; mapeamos para códigos curtos
    const m = r.error.message ?? "";
    if (/not_authenticated|JWT/i.test(m)) throw new ApiError("auth");
    if (/not_found/.test(m)) throw new ApiError("not_found");
    if (/Failed to fetch|Network request failed/i.test(m)) throw new ApiError("offline");
    throw new ApiError("server", m);
  }
  return r.data;
}

const rows = (r: Parameters<typeof check>[0]): any[] => (check(r) as any[] | null) ?? [];

export type SourceRow = {
  id: string; kind: "image" | "text"; state: SourceState; review_reason: string | null; error_code: string | null;
  created_at: string; updated_at: string; position: number; object_path: string | null; mime: string | null; note: string | null; text_original: string | null;
};
export type PageListItem = { id: string; type: string; updated_at: string; title: string; summary: string; version_id: string };
export type PageDetail = {
  page: { id: string; type: string; active_version_id: string; updated_at: string };
  version: { id: string; version_no: number; title: string; summary: string; blocks: Block[]; language: string | null; translated: boolean; title_is_generated: boolean; model: string | null; manual_fields: string[]; created_by: string };
  sources: { id: string; state: SourceState }[];
  /** segmentos citados que ainda existem (os demais = fonte removida) */
  segments: Record<string, { source_id: string; text: string }>;
  proposal: null | { id: string; title: string; summary: string; blocks: Block[]; base_version_id: string };
  hasProcessingJob: boolean;
};

// ---------------------------------------------------------------- perfil / aviso de IA
export async function getProfile() {
  const r = await supabase.from("profiles").select("ai_notice_accepted_at, language").maybeSingle();
  return check(r);
}
export async function acceptAiNotice() { check(await supabase.rpc("accept_ai_notice")); }

// ---------------------------------------------------------------- captura
export async function finalizeCapture(req: FinalizeRequest): Promise<FinalizeResponse> {
  const body = FinalizeRequest.parse(req);
  const r = check(await supabase.rpc("finalize_capture", { p_batch_id: body.batch_id, p_mode: body.mode, p_items: body.items }));
  return FinalizeResponse.parse(r);
}
export async function requestProcessing(sourceId: string, requestKey: string) {
  return check(await supabase.rpc("request_processing", { p_source_id: sourceId, p_request_key: requestKey })) as { status: string; mode?: string };
}

// ---------------------------------------------------------------- leitura
export async function listPages(): Promise<PageListItem[]> {
  const pages = rows(await supabase.from("knowledge_pages").select("id, type, updated_at, active_version_id").order("updated_at", { ascending: false }).limit(200));
  if (pages.length === 0) return [];
  const versions = rows(await supabase.from("page_versions").select("id, title, summary").in("id", pages.map((p) => p.active_version_id)));
  const byId = new Map(versions.map((v) => [v.id, v]));
  return pages.map((p) => ({ id: p.id, type: p.type, updated_at: p.updated_at, version_id: p.active_version_id, title: byId.get(p.active_version_id)?.title ?? "", summary: byId.get(p.active_version_id)?.summary ?? "" }));
}

export async function listSources(): Promise<SourceRow[]> {
  return rows(await supabase.from("sources").select("id, kind, state, review_reason, error_code, created_at, updated_at, position, object_path, mime, note, text_original").order("created_at", { ascending: false }).limit(60)) as SourceRow[];
}

export async function signedImageUrl(objectPath: string, seconds = 300): Promise<string | null> {
  const r = await supabase.storage.from("captures").createSignedUrl(objectPath, seconds);
  return r.data?.signedUrl ?? null;
}

export async function getPage(id: string): Promise<PageDetail | null> {
  const page = check(await supabase.from("knowledge_pages").select("id, type, active_version_id, updated_at").eq("id", id).maybeSingle());
  if (!page) return null;
  const v = check(await supabase.from("page_versions").select("id, version_no, title, summary, blocks, language, translated, title_is_generated, model, manual_fields, created_by").eq("id", page.active_version_id).single());
  const blocks = Blocks.parse(v.blocks);
  const links = rows(await supabase.from("page_source_links").select("source_id").eq("page_id", id));
  const srcIds = links.map((l) => l.source_id);
  const sources = srcIds.length ? rows(await supabase.from("sources").select("id, state").in("id", srcIds)) : [];
  const evIds = [...new Set(blocks.flatMap((b) => b.evidence))];
  const segs = evIds.length ? rows(await supabase.from("source_segments").select("id, text, extraction_id").in("id", evIds)) : [];
  const exIds = [...new Set(segs.map((s) => s.extraction_id))];
  const exs = exIds.length ? rows(await supabase.from("source_extractions").select("id, source_id").in("id", exIds)) : [];
  const exSource = new Map(exs.map((e) => [e.id, e.source_id]));
  const segments: PageDetail["segments"] = {};
  for (const s of segs) { const sid = exSource.get(s.extraction_id); if (sid) segments[s.id] = { source_id: sid, text: s.text }; }
  const prop = check(await supabase.from("page_proposals").select("id, title, summary, blocks, base_version_id").eq("page_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle());
  const jobs = srcIds.length ? rows(await supabase.from("jobs").select("id").in("source_id", srcIds).in("status", ["queued", "running"]).limit(1)) : [];
  return {
    page, version: { ...v, blocks }, sources, segments,
    proposal: prop ? { id: prop.id, title: prop.title, summary: prop.summary, blocks: Blocks.parse(prop.blocks), base_version_id: prop.base_version_id } : null,
    hasProcessingJob: jobs.length > 0,
  };
}

export type SourceDetail = {
  source: SourceRow; imageUrl: string | null;
  extraction: null | { id: string; version: number; legibility: string; issues: { code: string; message: string }[]; model: string; pipeline_version: string; language: string | null };
  segments: { id: string; key: string; position: number; text: string }[];
  pages: { id: string; title: string }[];
  processing: boolean;
};
export async function getSource(id: string): Promise<SourceDetail | null> {
  const source = check(await supabase.from("sources").select("id, kind, state, review_reason, error_code, created_at, updated_at, position, object_path, mime, note, text_original").eq("id", id).maybeSingle()) as SourceRow | null;
  if (!source) return null;
  const imageUrl = source.object_path ? await signedImageUrl(source.object_path) : null;
  const ex = check(await supabase.from("source_extractions").select("id, version, legibility, issues, model, pipeline_version, language").eq("source_id", id).order("version", { ascending: false }).limit(1).maybeSingle());
  const segments = ex ? rows(await supabase.from("source_segments").select("id, key, position, text").eq("extraction_id", ex.id).order("position")) : [];
  const links = rows(await supabase.from("page_source_links").select("page_id").eq("source_id", id));
  const pageIds = links.map((l) => l.page_id);
  const pages = pageIds.length ? rows(await supabase.from("knowledge_pages").select("id, active_version_id").in("id", pageIds)) : [];
  const vers = pages.length ? rows(await supabase.from("page_versions").select("id, title").in("id", pages.map((p) => p.active_version_id))) : [];
  const jobs = rows(await supabase.from("jobs").select("id").eq("source_id", id).eq("kind", "process_source").in("status", ["queued", "running"]).limit(1));
  return {
    source, imageUrl, extraction: ex as SourceDetail["extraction"], segments,
    pages: pages.map((p) => ({ id: p.id, title: vers.find((v) => v.id === p.active_version_id)?.title ?? "" })),
    processing: jobs.length > 0,
  };
}

// ---------------------------------------------------------------- escrita (sempre via RPC)
export async function saveVersion(req: SaveVersionRequest): Promise<SaveVersionResponse> {
  const b = SaveVersionRequest.parse(req);
  const r = check(await supabase.rpc("save_page_version", { p_page_id: b.page_id, p_base_version_id: b.base_version_id, p_title: b.title, p_summary: b.summary, p_blocks: b.blocks }));
  return SaveVersionResponse.parse(r);
}
export async function acceptProposal(proposalId: string, baseVersionId: string) {
  return AcceptProposalResponse.parse(check(await supabase.rpc("accept_proposal", { p_proposal_id: proposalId, p_base_version_id: baseVersionId })));
}
export async function rejectProposal(proposalId: string) { check(await supabase.rpc("reject_proposal", { p_proposal_id: proposalId })); }
export async function deletePage(id: string, withSources: boolean) { check(await supabase.rpc("delete_page", { p_page_id: id, p_delete_sources: withSources })); }
export async function deleteSource(id: string) { check(await supabase.rpc("delete_source", { p_source_id: id })); }
export async function recordEvent(name: "capture_saved_local" | "page_opened" | "source_opened", entity?: string) {
  await supabase.rpc("record_event", { p_name: name, p_entity: entity ?? null, p_props: {} }); // melhor esforço; sem conteúdo
}
