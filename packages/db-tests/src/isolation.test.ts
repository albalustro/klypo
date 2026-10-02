import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, uploadObject } from "./harness";
import { capture, claim, processWithSql } from "./fixtures";

const db = new TestDb();
beforeAll(() => db.setup());
afterAll(() => db.teardown());

const TABLES = ["profiles", "capture_batches", "sources", "source_extractions", "source_segments", "knowledge_pages",
  "page_versions", "page_source_links", "block_evidence", "page_proposals", "jobs"];

describe("RF12 — isolamento entre contas (banco)", () => {
  let a: string, b: string, pageId: string, sourceId: string, versionId: string, segId: string;
  beforeAll(async () => {
    a = await db.createUser("iso-a@x.com");
    b = await db.createUser("iso-b@x.com");
    const cap = await capture(db, a);
    sourceId = cap.id;
    const job = (await claim(db))!;
    const { page, ex } = await processWithSql(db, job);
    pageId = page.page_id; versionId = page.version_id; segId = ex.segments.s2;
    // B também tem dados, para provar que a RLS filtra e não que "tudo está vazio"
    const capB = await capture(db, b);
    await processWithSql(db, (await claim(db))!);
    void capB;
    // proposta de reprocessamento de A (para que page_proposals também tenha dados)
    await db.user(a, (q) => q("select public.request_processing($1,$2)", [sourceId, randomUUID()]));
    await processWithSql(db, (await claim(db))!);
  });

  it("A enxerga o próprio conteúdo em todas as tabelas de leitura", async () => {
    for (const t of TABLES) {
      const n = (await db.user(a, (q) => q(`select count(*)::int n from public.${t}`)))[0].n;
      expect(n, t).toBeGreaterThan(0);
    }
  });

  it("B não lê nenhuma linha de A em nenhuma tabela", async () => {
    for (const t of TABLES) {
      const rows = await db.user(b, (q) => q(`select * from public.${t}`));
      const leaked = rows.filter((r) => (r.owner_id ?? r.user_id) === a);
      expect(leaked, t).toHaveLength(0);
    }
    expect(await db.user(b, (q) => q("select 1 from public.sources where id=$1", [sourceId]))).toHaveLength(0);
    expect(await db.user(b, (q) => q("select 1 from public.source_segments where id=$1", [segId]))).toHaveLength(0);
  });

  it("tabelas internas (search_chunks, usage_events, server_config) são inacessíveis ao cliente", async () => {
    for (const t of ["search_chunks", "usage_events", "server_config"]) {
      await expect(db.user(a, (q) => q(`select * from public.${t}`)), t).rejects.toThrow(/permission denied/);
    }
  });

  it("B não escreve nem altera nada de A (RPCs com dono derivado de auth.uid())", async () => {
    await expect(db.user(b, (q) => q("select public.save_page_version($1,$2,'x','y','[]')", [pageId, versionId]))).rejects.toThrow(/not_found/);
    await expect(db.user(b, (q) => q("select public.delete_source($1)", [sourceId]))).rejects.toThrow(/not_found/);
    await expect(db.user(b, (q) => q("select public.delete_page($1,true)", [pageId]))).rejects.toThrow(/not_found/);
    await expect(db.user(b, (q) => q("select public.request_processing($1,$2)", [sourceId, randomUUID()]))).rejects.toThrow(/not_found/);
    // reusar id de fonte/lote alheio não revela nem altera nada
    const r = (await db.user(b, (q) => q("select public.finalize_capture($1,'separate',$2) r", [randomUUID(),
      JSON.stringify([{ kind: "text", id: sourceId, text: "invasor", position: 0 }])])))[0].r;
    expect(r[0]).toMatchObject({ status: "rejected", error_code: "unknown" });
    await expect(db.user(b, (q) => q("select public.finalize_capture((select batch_id from public.sources limit 1),'separate','[]')"))).resolves.toBeDefined();
    const afterTitle = (await db.sql("select title from public.page_versions where id=$1", [versionId]))[0].title;
    expect(afterTitle).toBe("Pistas justas em adventure games");
  });

  it("escritas diretas por tabela são negadas ao cliente", async () => {
    await expect(db.user(a, (q) => q("update public.page_versions set title='hack' where id=$1", [versionId]))).rejects.toThrow(/permission denied/);
    await expect(db.user(a, (q) => q("insert into public.knowledge_pages (owner_id,type,origin,generation_key) values ($1,'note','single','k')", [a]))).rejects.toThrow(/permission denied/);
    await expect(db.user(a, (q) => q("delete from public.sources where id=$1", [sourceId]))).rejects.toThrow(/permission denied/);
  });

  it("funções do worker não são chamáveis por authenticated/anon", async () => {
    await expect(db.user(a, (q) => q("select public.claim_job('x')"))).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, (q) => q("select public.claim_job('x')"))).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, (q) => q("select public.finalize_capture($1,'separate','[]')", [randomUUID()]))).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, (q) => q("select * from public.sources"))).rejects.toThrow(/permission denied/);
  });

  it("sem JWT, RPCs do cliente falham", async () => {
    await expect(db.as("authenticated", null, (q) => q("select public.accept_ai_notice()"))).rejects.toThrow(/not_authenticated/);
  });
});

describe("RF12 — isolamento no Storage (políticas em storage.objects)", () => {
  let a: string, b: string;
  beforeAll(async () => { a = await db.createUser("st-a@x.com"); b = await db.createUser("st-b@x.com"); });

  it("upload só na própria pasta e no formato uuid/uuid", async () => {
    const id = randomUUID();
    await uploadObject(db, a, `${a}/${id}`);
    await expect(uploadObject(db, b, `${a}/${randomUUID()}`)).rejects.toThrow(/row-level security/);   // pasta alheia
    await expect(uploadObject(db, b, `${b}/qualquer-nome.png`)).rejects.toThrow(/row-level security/);   // formato
    await expect(uploadObject(db, b, `outro-bucket-ou-raiz`)).rejects.toThrow(/row-level security/);
  });

  it("leitura exige fonte visível: antes do finalize ninguém lê; B nunca lê; após exclusão, ninguém lê", async () => {
    const id = randomUUID();
    await uploadObject(db, a, `${a}/${id}`);
    const read = (u: string) => db.user(u, (q) => q("select name from storage.objects where name=$1", [`${a}/${id}`]));
    expect(await read(a)).toHaveLength(0);                                   // sem fonte ainda
    await db.user(a, (q) => q("select public.finalize_capture($1,'separate',$2)", [randomUUID(),
      JSON.stringify([{ kind: "image", id, mime: "image/png", size_bytes: 1000, position: 0 }])]));
    expect(await read(a)).toHaveLength(1);                                   // dono, fonte viva
    expect(await read(b)).toHaveLength(0);                                   // outra conta
    await db.user(a, (q) => q("select public.delete_source($1)", [id]));
    expect(await read(a)).toHaveLength(0);                                   // exclusão lógica: imediato
  });

  it("cliente não atualiza nem apaga objetos", async () => {
    const id = randomUUID();
    await uploadObject(db, a, `${a}/${id}`);
    const upd = await db.user(a, (q) => q("update storage.objects set metadata='{}' where name=$1 returning 1", [`${a}/${id}`]));
    const del = await db.user(a, (q) => q("delete from storage.objects where name=$1 returning 1", [`${a}/${id}`]));
    expect(upd).toHaveLength(0);
    expect(del).toHaveLength(0);
    expect(await db.sql("select 1 from storage.objects where name=$1", [`${a}/${id}`])).toHaveLength(1);
  });

  it("bucket é privado com limites de tamanho/MIME", async () => {
    const [bk] = await db.sql("select public, file_size_limit, allowed_mime_types from storage.buckets where id='captures'");
    expect(bk).toMatchObject({ public: false, file_size_limit: "15728640" });
    expect(bk.allowed_mime_types).toEqual(["image/jpeg", "image/png"]);
  });
});
