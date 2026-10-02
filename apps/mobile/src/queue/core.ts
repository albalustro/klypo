/**
 * Fila local DURÁVEL de capturas (puro TypeScript; sem imports de React Native, testável em Node).
 *
 * Garantias:
 *  - o registro na fila é o ponto de commit: só informamos "salvo neste dispositivo" depois de putMany();
 *  - upload e finalize são idempotentes (id da fonte gerado no cliente = chave de idempotência);
 *  - fechar/reabrir o app não perde itens: o estado vive no QueueStore; 'uploading' órfão volta a 'pending';
 *  - nenhum item é descartado por erro transitório; só rejeições definitivas do servidor viram 'rejected'.
 */
import type { ClientCaptureState } from "@klypo/shared";

export type QueueItem = {
  id: string;
  ownerId: string;
  batchId: string;
  kind: "image" | "text";
  localPath?: string;
  mime?: string;
  sizeBytes?: number;
  text?: string;
  note?: string;
  position: number;
  state: ClientCaptureState;
  attempts: number;
  nextAttemptAt: number;
  errorCode?: string;
  createdAt: number;
};

export interface QueueStore {
  list(): Promise<QueueItem[]>;
  putMany(items: QueueItem[]): Promise<void>; // atômico
  remove(id: string): Promise<void>;
}

export type UploadFailure = "exists" | "transient" | "auth" | "fatal";
export class UploadError extends Error {
  constructor(public kind: UploadFailure, message = kind) { super(message); }
}
export type FinalizeResult = { id: string; status: "accepted" | "rejected"; error_code?: string | null };

export interface Remote {
  /** Envia o arquivo para {owner}/{id}. Lança UploadError. "exists" (já enviado antes) conta como sucesso. */
  upload(item: QueueItem): Promise<void>;
  finalize(batchId: string, items: QueueItem[]): Promise<FinalizeResult[]>;
}
export interface LocalFiles {
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}

export type RunResult = { authRequired: boolean; received: number; pending: number; rejected: number };

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
export const backoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));

/** Códigos em que o próprio material é o problema: não adianta tentar de novo sem o usuário agir. */
const PERMANENT = new Set(["file_too_large", "unsupported_mime", "text_too_long", "empty_text", "mode_not_supported", "source_deleted", "unknown", "batch_too_large"]);
/** Códigos que dependem de uma ação/condição futura: o item fica pendente. */
const WAITING = new Set(["ai_notice_required", "quota_exceeded"]);
const MAX_REUPLOADS = 3;

export class CaptureQueue {
  private running: Promise<RunResult> | null = null;
  constructor(private store: QueueStore, private remote: Remote, private files: LocalFiles, private now: () => number = Date.now) {}

  list() { return this.store.list(); }

  async enqueue(items: Omit<QueueItem, "state" | "attempts" | "nextAttemptAt" | "createdAt">[]) {
    const t = this.now();
    await this.store.putMany(items.map((i) => ({ ...i, state: "pending", attempts: 0, nextAttemptAt: 0, createdAt: t })));
  }

  async retry(id: string) {
    const it = (await this.store.list()).find((i) => i.id === id);
    if (it) await this.store.putMany([{ ...it, state: "pending", attempts: 0, nextAttemptAt: 0, errorCode: undefined }]);
  }

  async discard(id: string) {
    const it = (await this.store.list()).find((i) => i.id === id);
    if (it?.localPath) await this.files.delete(it.localPath).catch(() => {});
    await this.store.remove(id);
  }

  /** Uma execução por vez; chamadas concorrentes (foreground + botão) compartilham o mesmo resultado. */
  run(ownerId: string, opts: { force?: boolean } = {}): Promise<RunResult> {
    if (!this.running) this.running = this.runInner(ownerId, !!opts.force).finally(() => { this.running = null; });
    return this.running;
  }

  private async runInner(ownerId: string, force: boolean): Promise<RunResult> {
    const res: RunResult = { authRequired: false, received: 0, pending: 0, rejected: 0 };
    let items = (await this.store.list()).filter((i) => i.ownerId === ownerId);

    // recuperação de crash: 'uploading' órfão não é prova de envio → volta a pendente
    const orphan = items.filter((i) => i.state === "uploading");
    if (orphan.length) { await this.store.putMany(orphan.map((i) => ({ ...i, state: "pending" as const }))); items = items.map((i) => (i.state === "uploading" ? { ...i, state: "pending" as const } : i)); }

    const due = (i: QueueItem) => force || i.nextAttemptAt <= this.now();
    const todo = items.filter((i) => (i.state === "pending" || i.state === "uploaded") && due(i));

    // ---- 1) upload dos arquivos
    for (const it of todo.filter((i) => i.kind === "image" && i.state === "pending")) {
      if (!it.localPath || !(await this.files.exists(it.localPath))) {
        await this.store.putMany([{ ...it, state: "rejected", errorCode: "local_file_missing" }]);
        continue;
      }
      await this.store.putMany([{ ...it, state: "uploading" }]);
      try {
        await this.remote.upload(it);
        await this.store.putMany([{ ...it, state: "uploaded", errorCode: undefined }]);
      } catch (e) {
        const kind = e instanceof UploadError ? e.kind : "transient";
        if (kind === "exists") await this.store.putMany([{ ...it, state: "uploaded" }]);
        else if (kind === "auth") { await this.store.putMany([{ ...it, state: "pending" }]); res.authRequired = true; return this.summarize(res, ownerId); }
        else if (kind === "fatal") await this.store.putMany([{ ...it, state: "rejected", errorCode: "upload_failed" }]);
        else await this.store.putMany([{ ...it, state: "pending", attempts: it.attempts + 1, nextAttemptAt: this.now() + backoffMs(it.attempts + 1) }]);
      }
    }

    // ---- 2) finalize por lote (texto não tem upload)
    const fresh = (await this.store.list()).filter((i) => i.ownerId === ownerId);
    const ready = fresh.filter((i) => due(i) && (i.state === "uploaded" || (i.kind === "text" && i.state === "pending")));
    const byBatch = new Map<string, QueueItem[]>();
    for (const i of ready) byBatch.set(i.batchId, [...(byBatch.get(i.batchId) ?? []), i]);
    for (const [batchId, group] of byBatch) {
      let results: FinalizeResult[];
      try {
        results = await this.remote.finalize(batchId, group);
      } catch (e) {
        if (e instanceof UploadError && e.kind === "auth") { res.authRequired = true; return this.summarize(res, ownerId); }
        await this.store.putMany(group.map((i) => ({ ...i, attempts: i.attempts + 1, nextAttemptAt: this.now() + backoffMs(i.attempts + 1) })));
        continue;
      }
      for (const it of group) {
        const r = results.find((x) => x.id === it.id);
        if (r?.status === "accepted") {
          if (it.localPath) await this.files.delete(it.localPath).catch(() => {});
          await this.store.remove(it.id);                          // o servidor já tem a fonte
          res.received++;
        } else if (r?.error_code === "file_missing") {
          // arquivo ainda não visível/ausente no Storage: reenviar (limitado)
          const attempts = it.attempts + 1;
          await this.store.putMany([attempts > MAX_REUPLOADS
            ? { ...it, state: "rejected", errorCode: "file_missing", attempts }
            : { ...it, state: "pending", attempts, nextAttemptAt: this.now() + backoffMs(attempts), errorCode: "file_missing" }]);
        } else if (r?.error_code && WAITING.has(r.error_code)) {
          await this.store.putMany([{ ...it, state: it.kind === "image" ? "uploaded" : "pending", errorCode: r.error_code, nextAttemptAt: this.now() + 60_000 }]);
        } else if (r?.error_code && PERMANENT.has(r.error_code)) {
          await this.store.putMany([{ ...it, state: "rejected", errorCode: r.error_code }]);
        } else {
          await this.store.putMany([{ ...it, attempts: it.attempts + 1, nextAttemptAt: this.now() + backoffMs(it.attempts + 1), errorCode: r?.error_code ?? undefined }]);
        }
      }
    }
    return this.summarize(res, ownerId);
  }

  private async summarize(res: RunResult, ownerId: string): Promise<RunResult> {
    const items = (await this.store.list()).filter((i) => i.ownerId === ownerId);
    res.pending = items.filter((i) => i.state !== "rejected" && i.state !== "received").length;
    res.rejected = items.filter((i) => i.state === "rejected").length;
    return res;
  }
}
