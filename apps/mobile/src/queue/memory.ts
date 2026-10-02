import type { QueueItem, QueueStore } from "./core";

/** Store em memória (testes). Para simular "reabrir o app", reutilize a mesma instância em uma nova CaptureQueue. */
export class MemoryQueueStore implements QueueStore {
  rows = new Map<string, string>(); // serializado, como um banco de verdade (sem aliasing de objetos)
  async list() { return [...this.rows.values()].map((r) => JSON.parse(r) as QueueItem).sort((a, b) => a.createdAt - b.createdAt || a.position - b.position); }
  async putMany(items: QueueItem[]) { for (const i of items) this.rows.set(i.id, JSON.stringify(i)); }
  async remove(id: string) { this.rows.delete(id); }
}
