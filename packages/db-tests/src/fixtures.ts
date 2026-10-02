import { randomUUID } from "node:crypto";
import { TestDb, uploadObject } from "./harness";

export const SEGMENTS = [
  { key: "s1", text: "Princípios de pistas em adventure games" },
  { key: "s2", text: "Toda pista deve ser justa: o jogador precisa ter visto o suficiente para deduzir a solução." },
  { key: "s3", text: "Evite puzzles que dependam de adivinhar a intenção do designer." },
];

export const legibleExtraction = (segments = SEGMENTS) => ({
  legibility: "legible", language: "pt", segments, issues: [],
});

export function pageFor(segIds: Record<string, string>, over: Record<string, unknown> = {}) {
  return {
    title: "Pistas justas em adventure games", titleIsGenerated: true,
    summary: "Pistas devem ser dedutíveis; evite puzzles que exigem adivinhar.", type: "guide", language: "pt",
    translatedFromSource: false, suggestedTopics: ["Puzzle design"],
    blocks: [
      { id: randomUUID(), origin: "extracted", type: "paragraph", text: "Toda pista deve ser justa.", evidence: [segIds.s2] },
      { id: randomUUID(), origin: "extracted", type: "list", items: ["Evite adivinhação"], evidence: [segIds.s3] },
    ],
    ...over,
  };
}

/** Captura de imagem fim a fim no banco: upload simulado + finalize. */
export async function capture(db: TestDb, userId: string, opts: { id?: string; batchId?: string } = {}) {
  const id = opts.id ?? randomUUID();
  const batchId = opts.batchId ?? randomUUID();
  await uploadObject(db, userId, `${userId}/${id}`);
  const res = await db.user(userId, (q) =>
    q("select public.finalize_capture($1, 'separate', $2) r", [batchId, JSON.stringify([{ kind: "image", id, mime: "image/png", size_bytes: 1000, position: 0 }])]));
  return { id, batchId, result: res[0].r };
}

export type Claimed = { id: string; lease_token: string; source_id: string; attempts: number };
export const claim = async (db: TestDb, lease = 120): Promise<Claimed | null> =>
  (await db.service((q) => q("select public.claim_job('w', $1) j", [lease])))[0].j;

export const svc = async (db: TestDb, sql: string, params: unknown[]) => (await db.service((q) => q(sql, params)))[0];

/** Roda o pipeline por SQL (como o worker faria), devolvendo ids. */
export async function processWithSql(db: TestDb, job: Claimed, opts: { extraction?: unknown; page?: (ids: Record<string, string>) => unknown } = {}) {
  const ex = (await svc(db, "select public.worker_save_extraction($1,$2,$3,'fake','p1') r", [job.id, job.lease_token, JSON.stringify(opts.extraction ?? legibleExtraction())])).r;
  if (ex.status !== "ok") return { ex, page: null };
  const page = (await svc(db, "select public.worker_persist_page($1,$2,$3,$4,'fake','{}') r", [job.id, job.lease_token, ex.extraction_id, JSON.stringify((opts.page ?? pageFor)(ex.segments))])).r;
  return { ex, page };
}
