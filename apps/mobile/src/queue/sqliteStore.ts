import * as SQLite from "expo-sqlite";
import type { QueueItem, QueueStore } from "./core";

/** Fila persistida em SQLite (uma linha por captura; escrita em lote transacional). */
export class SqliteQueueStore implements QueueStore {
  private db: Promise<SQLite.SQLiteDatabase>;
  constructor(name = "klypo-queue.db") {
    this.db = SQLite.openDatabaseAsync(name).then(async (db) => {
      await db.execAsync(`PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS capture_queue (
          id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, position INTEGER NOT NULL, json TEXT NOT NULL);`);
      return db;
    });
  }
  async list() {
    const db = await this.db;
    const rows = await db.getAllAsync<{ json: string }>("SELECT json FROM capture_queue ORDER BY created_at, position");
    return rows.map((r) => JSON.parse(r.json) as QueueItem);
  }
  async putMany(items: QueueItem[]) {
    const db = await this.db;
    await db.withTransactionAsync(async () => {
      for (const i of items) {
        await db.runAsync("INSERT OR REPLACE INTO capture_queue (id, owner_id, created_at, position, json) VALUES (?, ?, ?, ?, ?)", [i.id, i.ownerId, i.createdAt, i.position, JSON.stringify(i)]);
      }
    });
  }
  async remove(id: string) {
    const db = await this.db;
    await db.runAsync("DELETE FROM capture_queue WHERE id = ?", [id]);
  }
}
