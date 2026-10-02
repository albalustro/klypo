import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, uploadObject } from "./harness";
import { capture, claim, processWithSql, svc } from "./fixtures";

const db = new TestDb();
beforeAll(() => db.setup());
afterAll(() => db.teardown());

const finalize = (user: string, batch: string, items: unknown[], mode = "separate") =>
  db.user(user, (q) => q("select public.finalize_capture($1,$2,$3) r", [batch, mode, JSON.stringify(items)])).then((r) => r[0].r as any[]);
const img = (id: string, extra = {}) => ({ kind: "image", id, mime: "image/png", size_bytes: 1000, position: 0, ...extra });

describe("finalize_capture (RF01/RF02/RF04)", () => {
  it("só cria job depois de verificar existência/propriedade do arquivo", async () => {
    const a = await db.createUser("a1@x.com"), b = await db.createUser("b1@x.com");
    const id = randomUUID();
    // sem arquivo
    expect((await finalize(a, randomUUID(), [img(id)]))[0]).toMatchObject({ status: "rejected", error_code: "file_missing" });
    expect(await db.sql("select 1 from public.jobs where source_id=$1", [id])).toHaveLength(0);
    // arquivo enviado por OUTRA conta no caminho da A não vale (e B nem consegue gravar na pasta de A: ver isolation)
    await uploadObject(db, b, `${b}/${id}`);
    expect((await finalize(a, randomUUID(), [img(id)]))[0].error_code).toBe("file_missing");
    // upload correto
    const id2 = randomUUID();
    await uploadObject(db, a, `${a}/${id2}`);
    expect((await finalize(a, randomUUID(), [img(id2)]))[0]).toMatchObject({ status: "accepted" });
  });

  it("retry com a mesma chave devolve a mesma captura/job (idempotente)", async () => {
    const a = await db.createUser("a2@x.com");
    const { id, batchId } = await capture(db, a);
    for (let i = 0; i < 3; i++) expect((await finalize(a, batchId, [img(id)]))[0].status).toBe("accepted");
    expect(await db.sql("select 1 from public.sources where id=$1", [id])).toHaveLength(1);
    expect(await db.sql("select 1 from public.jobs where source_id=$1", [id])).toHaveLength(1);
  });

  it("itens do lote são independentes: falha de um não bloqueia os demais", async () => {
    const a = await db.createUser("a3@x.com");
    const ok1 = randomUUID(), bad = randomUUID(), ok2 = randomUUID();
    await uploadObject(db, a, `${a}/${ok1}`);
    await uploadObject(db, a, `${a}/${ok2}`);
    const r = await finalize(a, randomUUID(), [img(ok1), img(bad), img(ok2), { kind: "text", id: randomUUID(), text: "  ", position: 3 }]);
    expect(r.map((x) => x.status)).toEqual(["accepted", "rejected", "accepted", "rejected"]);
    expect(r[3].error_code).toBe("empty_text");
    // cada fonte tem identidade própria, mesmo lote; lote não consolida
    const rows = await db.sql("select count(distinct id)::int n, count(distinct batch_id)::int b from public.sources where owner_id=$1", [a]);
    expect(rows[0]).toMatchObject({ n: 2, b: 1 });
  });

  it("limites no servidor: tamanho, MIME, texto, lote, modo e aviso de IA", async () => {
    const a = await db.createUser("a4@x.com");
    const big = randomUUID(), gif = randomUUID();
    await uploadObject(db, a, `${a}/${big}`, { size: 16 * 1024 * 1024 });
    await uploadObject(db, a, `${a}/${gif}`, { mime: "image/gif" });
    const r = await finalize(a, randomUUID(), [img(big), img(gif), { kind: "text", id: randomUUID(), text: "x".repeat(20_001), position: 0 }]);
    expect(r.map((x) => x.error_code)).toEqual(["file_too_large", "unsupported_mime", "text_too_long"]);
    expect((await finalize(a, randomUUID(), Array.from({ length: 11 }, () => img(randomUUID()))))[0].error_code).toBe("batch_too_large");
    expect((await finalize(a, randomUUID(), [img(randomUUID())], "same_document"))[0].error_code).toBe("mode_not_supported");
    const noNotice = await db.createUser("nonotice@x.com", false);
    expect((await finalize(noNotice, randomUUID(), [{ kind: "text", id: randomUUID(), text: "oi", position: 0 }]))[0].error_code).toBe("ai_notice_required");
  });

  it("cota diária por conta é aplicada no servidor", async () => {
    const a = await db.createUser("quota@x.com");
    await db.sql("update public.server_config set value='2' where key='daily_source_quota'");
    const r = await finalize(a, randomUUID(), [1, 2, 3].map((i) => ({ kind: "text", id: randomUUID(), text: `t${i}`, position: i })));
    expect(r.map((x) => x.status)).toEqual(["accepted", "accepted", "rejected"]);
    expect(r[2].error_code).toBe("quota_exceeded");
    await db.sql("update public.server_config set value='200' where key='daily_source_quota'");
  });
});

describe("fila no servidor: lease, retries, backoff, idempotência", () => {
  it("claim concorrente entrega o job a apenas um worker", async () => {
    const a = await db.createUser("q1@x.com");
    await db.sql("update public.jobs set status='cancelled' where status='queued'");
    await capture(db, a);
    const results = await Promise.all(Array.from({ length: 6 }, () => claim(db)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lease expirado é retomado; token antigo perde o direito de gravar", async () => {
    const a = await db.createUser("q2@x.com");
    await db.sql("update public.jobs set status='cancelled' where status='queued'");
    const { id } = await capture(db, a);
    const first = (await claim(db, 120))!;
    expect(first.source_id).toBe(id);
    await db.sql("update public.jobs set lease_until = now() - interval '1 second' where id=$1", [first.id]);
    const second = (await claim(db))!;
    expect(second.id).toBe(first.id);
    expect(second.attempts).toBe(2);
    // worker "zumbi" (token antigo) tenta persistir
    const stale = await processWithSql(db, first);
    expect(stale.ex.status).toBe("lease_lost");
    expect(await db.sql("select 1 from public.knowledge_pages where owner_id=$1", [a])).toHaveLength(0);
    // o novo dono conclui normalmente
    const ok = await processWithSql(db, second);
    expect(ok.page.status).toBe("created");
  });

  it("retry com backoff exponencial e limite de tentativas", async () => {
    const a = await db.createUser("q3@x.com");
    await db.sql("update public.jobs set status='cancelled' where status='queued'");
    const { id } = await capture(db, a);
    let job = (await claim(db))!;
    let r = await svc(db, "select public.worker_fail_job($1,$2,'provider_error',true) r", [job.id, job.lease_token]);
    expect(r.r.status).toBe("retry_scheduled");
    const t1 = (await db.sql("select extract(epoch from available_at - now())::int s from public.jobs where id=$1", [job.id]))[0].s;
    expect(t1).toBeGreaterThan(20); // ~30s
    expect(await claim(db)).toBeNull(); // ainda em backoff
    for (let i = 0; i < 3; i++) {
      await db.sql("update public.jobs set available_at = now() where id=$1", [job.id]);
      job = (await claim(db))!;
      r = await svc(db, "select public.worker_fail_job($1,$2,'provider_error',true) r", [job.id, job.lease_token]);
    }
    expect(r.r.status).toBe("failed"); // 4ª tentativa esgota
    const s = (await db.sql("select state, error_code from public.sources where id=$1", [id]))[0];
    expect(s).toMatchObject({ state: "failed", error_code: "provider_error" });
    const t2 = (await db.sql("select attempts from public.jobs where id=$1", [job.id]))[0];
    expect(t2.attempts).toBe(4);
  });

  it("orçamento diário de IA adia o job sem perder a captura", async () => {
    const a = await db.createUser("q4@x.com");
    await db.sql("update public.jobs set status='cancelled' where status='queued'");
    const { id } = await capture(db, a);
    await db.sql("update public.server_config set value='0' where key='ai_daily_job_limit'");
    expect(await claim(db)).toBeNull();
    const j = (await db.sql("select status, last_error_code, available_at > now() as later from public.jobs where source_id=$1", [id]))[0];
    expect(j).toMatchObject({ status: "queued", last_error_code: "quota_exceeded", later: true });
    expect((await db.sql("select state from public.sources where id=$1", [id]))[0].state).toBe("queued");
    await db.sql("update public.server_config set value='100' where key='ai_daily_job_limit'");
  });
});
