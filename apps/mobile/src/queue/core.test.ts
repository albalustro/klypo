import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CaptureQueue, UploadError, backoffMs, type FinalizeResult, type LocalFiles, type QueueItem, type Remote } from "./core";
import { MemoryQueueStore } from "./memory";

/** Servidor simulado com a mesma semântica idempotente do banco (id = chave). */
class FakeServer implements Remote {
  objects = new Set<string>();
  sources = new Map<string, QueueItem>();
  jobs = new Set<string>();
  uploadCalls = 0; finalizeCalls = 0;
  failUploads = 0; failFinalize = 0; authExpired = false;
  reject: Record<string, string> = {};
  loseResponseOnce = false;
  async upload(it: QueueItem) {
    this.uploadCalls++;
    if (this.authExpired) throw new UploadError("auth");
    if (this.failUploads > 0) { this.failUploads--; throw new UploadError("transient"); }
    if (this.objects.has(it.id)) throw new UploadError("exists");
    this.objects.add(it.id);
  }
  async finalize(_b: string, items: QueueItem[]): Promise<FinalizeResult[]> {
    this.finalizeCalls++;
    if (this.authExpired) throw new UploadError("auth");
    if (this.failFinalize > 0) { this.failFinalize--; throw new UploadError("transient"); }
    const out = items.map((i): FinalizeResult => {
      if (this.reject[i.id]) return { id: i.id, status: "rejected", error_code: this.reject[i.id] };
      if (i.kind === "image" && !this.objects.has(i.id)) return { id: i.id, status: "rejected", error_code: "file_missing" };
      this.sources.set(i.id, i); this.jobs.add(i.id);        // idempotente: Map/Set
      return { id: i.id, status: "accepted" };
    });
    if (this.loseResponseOnce) { this.loseResponseOnce = false; throw new UploadError("transient"); } // servidor aplicou, resposta se perdeu
    return out;
  }
}
class Files implements LocalFiles {
  present = new Set<string>();
  async exists(p: string) { return this.present.has(p); }
  async delete(p: string) { this.present.delete(p); }
}

const mk = (files: Files, over: Partial<QueueItem> = {}) => {
  const id = randomUUID(); const path = `/docs/captures/${id}.png`; files.present.add(path);
  return { id, ownerId: "u1", batchId: "b1", kind: "image" as const, localPath: path, mime: "image/png", sizeBytes: 100, position: 0, ...over };
};
let clock = 1_000_000;
const setup = () => {
  const store = new MemoryQueueStore(); const server = new FakeServer(); const files = new Files();
  const queue = () => new CaptureQueue(store, server, files, () => clock);   // nova instância = "app reaberto"
  return { store, server, files, queue };
};

describe("fila local durável (RF01/RF02)", () => {
  it("fluxo normal: pendente → recebido, arquivo local liberado, 1 fonte/1 job", async () => {
    const { server, files, queue, store } = setup();
    const item = mk(files);
    const q = queue();
    await q.enqueue([item]);
    expect((await store.list())[0]!.state).toBe("pending");     // salvo localmente antes de qualquer rede
    expect(await q.run("u1")).toMatchObject({ received: 1, pending: 0 });
    expect(server.sources.size).toBe(1); expect(server.jobs.size).toBe(1);
    expect(files.present.has(item.localPath)).toBe(false);
    expect(await store.list()).toHaveLength(0);
  });

  it("fechar/reabrir o app preserva capturas pendentes (sem rede) e conclui depois", async () => {
    const { server, files, queue, store } = setup();
    const a = mk(files), b = mk(files, { kind: "text", localPath: undefined, text: "nota", mime: undefined });
    await queue().enqueue([a, { ...b, localPath: undefined }]);
    server.failUploads = 99; server.failFinalize = 99;           // sem rede
    const r1 = await queue().run("u1", { force: true });
    expect(r1.received).toBe(0);
    expect(await store.list()).toHaveLength(2);                  // nada foi perdido
    expect(files.present.has(a.localPath)).toBe(true);
    // "app reaberto": nova instância, rede de volta
    server.failUploads = 0; server.failFinalize = 0;
    const r2 = await queue().run("u1", { force: true });
    expect(r2.received).toBe(2);
    expect(server.sources.size).toBe(2);
  });

  it("crash no meio do upload: 'uploading' órfão é retomado, sem duplicar fonte", async () => {
    const { server, files, queue, store } = setup();
    const it = mk(files);
    await queue().enqueue([it]);
    const [row] = await store.list();
    await store.putMany([{ ...row!, state: "uploading" }]);      // o processo morreu aqui
    server.objects.add(it.id);                                   // ...mas o upload tinha chegado ao servidor
    expect((await queue().run("u1", { force: true })).received).toBe(1);
    expect(server.sources.size).toBe(1);
    expect(server.jobs.size).toBe(1);
  });

  it("retry de finalize com resposta perdida não cria fonte/job extras", async () => {
    const { server, files, queue } = setup();
    const it = mk(files);
    await queue().enqueue([it]);
    server.loseResponseOnce = true;
    await queue().run("u1", { force: true });                    // servidor aplicou, cliente não soube
    expect(server.sources.size).toBe(1);
    expect((await queue().run("u1", { force: true })).received).toBe(1);
    expect(server.sources.size).toBe(1); expect(server.jobs.size).toBe(1);
    expect(server.uploadCalls).toBe(1);                          // upload não repetido
  });

  it("backoff exponencial limitado; itens fora da janela não são tentados sem force", async () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([5000, 10000, 20000]);
    expect(backoffMs(50)).toBe(15 * 60_000);
    const { server, files, queue } = setup();
    await queue().enqueue([mk(files)]);
    server.failUploads = 1;
    await queue().run("u1");
    expect(server.uploadCalls).toBe(1);
    await queue().run("u1");                                      // ainda em backoff
    expect(server.uploadCalls).toBe(1);
    clock += 6000;
    await queue().run("u1");
    expect(server.uploadCalls).toBe(2);
  });

  it("sessão expirada: para sem perder nada; só retoma para o dono; outra conta não envia o item", async () => {
    const { server, files, queue, store } = setup();
    await queue().enqueue([mk(files)]);
    server.authExpired = true;
    expect((await queue().run("u1", { force: true })).authRequired).toBe(true);
    expect((await store.list())[0]!.state).toBe("pending");
    server.authExpired = false;
    expect((await queue().run("u2", { force: true })).received).toBe(0);   // outra conta
    expect(server.sources.size).toBe(0);
    expect((await queue().run("u1", { force: true })).received).toBe(1);
  });

  it("falha de um item não bloqueia os demais do lote; rejeições definitivas ficam visíveis", async () => {
    const { server, files, queue, store } = setup();
    const a = mk(files), b = mk(files), c = mk(files);
    await queue().enqueue([a, b, c]);
    server.reject[b.id] = "unsupported_mime";
    const r = await queue().run("u1", { force: true });
    expect(r).toMatchObject({ received: 2, rejected: 1 });
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: b.id, state: "rejected", errorCode: "unsupported_mime" });
    expect(files.present.has(b.localPath)).toBe(true);           // o material do item rejeitado é preservado
    await queue().retry(b.id);
    expect((await store.list())[0]!.state).toBe("pending");
    await queue().discard(b.id);
    expect(await store.list()).toHaveLength(0);
    expect(files.present.has(b.localPath)).toBe(false);
  });

  it("aviso de IA pendente mantém o item (não rejeita nem perde)", async () => {
    const { server, files, queue, store } = setup();
    const a = mk(files);
    await queue().enqueue([a]);
    server.reject[a.id] = "ai_notice_required";
    await queue().run("u1", { force: true });
    expect((await store.list())[0]).toMatchObject({ state: "uploaded", errorCode: "ai_notice_required" });
    delete server.reject[a.id];
    expect((await queue().run("u1", { force: true })).received).toBe(1);
  });

  it("arquivo do Storage ausente no finalize: reenvia; arquivo local sumiu: rejeita explicitamente", async () => {
    const { server, files, queue, store } = setup();
    const a = mk(files);
    await queue().enqueue([a]);
    await queue().run("u1", { force: true });                    // upload ok + finalize ok (caso normal)
    const b = mk(files);
    await queue().enqueue([b]);
    server.objects.clear();                                      // objeto sumiu no servidor após o upload
    const s = await store.list(); await store.putMany(s.map((i) => ({ ...i, state: "uploaded" as const })));
    await queue().run("u1", { force: true });
    expect((await store.list())[0]).toMatchObject({ state: "pending", errorCode: "file_missing" });
    await queue().run("u1", { force: true });
    expect(server.sources.has(b.id)).toBe(true);
    const c = mk(files); await queue().enqueue([c]); files.present.delete(c.localPath);
    await queue().run("u1", { force: true });
    expect((await store.list())[0]).toMatchObject({ id: c.id, state: "rejected", errorCode: "local_file_missing" });
  });

  it("execuções concorrentes compartilham uma única passada (sem uploads duplicados)", async () => {
    const { server, files, queue } = setup();
    await queue().enqueue([mk(files), mk(files)]);
    const q = queue();
    await Promise.all([q.run("u1", { force: true }), q.run("u1", { force: true }), q.run("u1", { force: true })]);
    expect(server.uploadCalls).toBe(2);
  });
});
