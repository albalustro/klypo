export interface ObjectStore {
  download(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
}

/** Storage do Supabase via REST com a service role (apenas no worker). */
export class SupabaseObjectStore implements ObjectStore {
  constructor(private url: string, private serviceKey: string, private bucket = "captures") {}
  private headers() { return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey }; }

  async download(path: string) {
    const r = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${path}`, { headers: this.headers() });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw Object.assign(new Error("storage_download_failed"), { status: r.status });
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(path: string) {
    const r = await fetch(`${this.url}/storage/v1/object/${this.bucket}`, {
      method: "DELETE", headers: { ...this.headers(), "content-type": "application/json" }, body: JSON.stringify({ prefixes: [path] }),
    });
    if (!r.ok && r.status !== 404) throw Object.assign(new Error("storage_remove_failed"), { status: r.status });
  }
}

export class MemoryObjectStore implements ObjectStore {
  files = new Map<string, Buffer>();
  async download(p: string) { return this.files.get(p) ?? null; }
  async remove(p: string) { this.files.delete(p); }
}
