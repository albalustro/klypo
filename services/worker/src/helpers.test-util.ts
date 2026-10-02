import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgJobDb } from "./db";
import { FakeProvider, makeFixtureImage, type FixtureSpec } from "./ai/fake";
import type { AiProvider, ImageInput } from "./ai/types";
import { MemoryObjectStore } from "./storage";
import type { Deps } from "./pipeline";
import { TestDb, uploadObject } from "../../../packages/db-tests/src/harness";

export { TestDb };

export class Rig {
  db = new TestDb();
  store = new MemoryObjectStore();
  pool!: pg.Pool;
  async up() { await this.db.setup(); this.pool = this.db.admin; }
  async down() { await this.db.teardown(); }
  deps(ai: AiProvider = new FakeProvider(), over: Partial<Deps> = {}): Deps {
    return { db: new PgJobDb(this.pool), ai, store: this.store, maxImageBytes: 15 * 1024 * 1024, leaseSeconds: 120, ...over };
  }
  /** Captura de imagem de fixture: bytes no "Storage" + linha em storage.objects + finalize. */
  async captureImage(user: string, spec: FixtureSpec | Buffer, opts: { mime?: string } = {}) {
    const id = randomUUID();
    const bytes = Buffer.isBuffer(spec) ? spec : await makeFixtureImage(spec);
    const path = `${user}/${id}`;
    this.store.files.set(path, bytes);
    await uploadObject(this.db, user, path, { size: bytes.length, mime: opts.mime ?? "image/png" });
    const r = await this.db.user(user, (q) => q("select public.finalize_capture($1,'separate',$2) r", [randomUUID(),
      JSON.stringify([{ kind: "image", id, mime: opts.mime ?? "image/png", size_bytes: bytes.length, position: 0 }])]));
    if (r[0].r[0].status !== "accepted") throw new Error("finalize recusou: " + JSON.stringify(r[0].r));
    return { id, path };
  }
  async captureText(user: string, text: string) {
    const id = randomUUID();
    await this.db.user(user, (q) => q("select public.finalize_capture($1,'separate',$2)", [randomUUID(), JSON.stringify([{ kind: "text", id, text, position: 0 }])]));
    return { id };
  }
  /** Executa jobs até a fila esvaziar (ignora backoff: libera available_at). */
  async drain(deps: Deps, max = 20) {
    const { runOnce } = await import("./worker");
    let n = 0;
    while (n < max) {
      await this.db.sql("update public.jobs set available_at = now() where status='queued'");
      if (!(await runOnce(deps, "test-worker"))) break;
      n++;
    }
    return n;
  }
  one = async (sql: string, p: unknown[] = []) => (await this.db.sql(sql, p))[0];
  count = async (sql: string, p: unknown[] = []) => (await this.db.sql(`select count(*)::int n from (${sql}) t`, p))[0].n as number;
}

/** Provedor que delega ao fake, com ganchos para injetar falhas/efeitos. */
export class ScriptedProvider implements AiProvider {
  readonly id = "scripted"; readonly model = "scripted-test";
  extractCalls = 0; structureCalls = 0;
  inner = new FakeProvider();
  onExtract?: (n: number, img: ImageInput) => Promise<void> | void;
  structureOverride?: (n: number, hint?: string) => unknown | undefined;
  async extract(img: ImageInput) { this.extractCalls++; await this.onExtract?.(this.extractCalls, img); return this.inner.extract(img); }
  async structure(i: { extraction: any; repairHint?: string }) {
    this.structureCalls++;
    const o = this.structureOverride?.(this.structureCalls, i.repairHint);
    if (o !== undefined) return { output: o, usage: { inputTokens: 1, outputTokens: 1 } };
    return this.inner.structure(i);
  }
}
