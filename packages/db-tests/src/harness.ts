import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

export type Role = "authenticated" | "service_role" | "anon";

export class TestDb {
  admin!: pg.Pool;
  dbName = `klypo_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  private adminUrl: string;
  constructor() {
    const url = process.env.TEST_PG_ADMIN_URL;
    if (!url) throw new Error("TEST_PG_ADMIN_URL não definido (use `npm run test:db` na raiz).");
    this.adminUrl = url;
  }

  async setup() {
    const boot = new pg.Client({ connectionString: this.adminUrl });
    await boot.connect();
    await boot.query(`create database ${this.dbName}`);
    await boot.end();
    const u = new URL(this.adminUrl);
    u.pathname = `/${this.dbName}`;
    this.admin = new pg.Pool({ connectionString: u.toString(), max: 8 });
    // roles são globais no cluster: criar só se faltarem, via shim tolerante
    await this.admin.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$`);
    const shim = readFileSync(join(here, "..", "shim.sql"), "utf8").replace(/^create role .*$/gm, "");
    await this.admin.query(shim);
    const dir = join(root, "supabase", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await this.admin.query(readFileSync(join(dir, f), "utf8"));
      } catch (e) {
        throw new Error(`migration ${f} falhou: ${(e as Error).message}`);
      }
    }
  }

  async teardown() {
    await this.admin.end();
    const boot = new pg.Client({ connectionString: this.adminUrl });
    await boot.connect();
    await boot.query(`drop database if exists ${this.dbName} with (force)`);
    await boot.end();
  }

  /** Executa como um papel do Supabase (com JWT simulado). Transação própria; erro → rollback. */
  async as<T>(role: Role, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await this.admin.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      const q: Q = async (sql, params) => (await c.query(sql, params)).rows;
      const out = await fn(q);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  user<T>(id: string, fn: (q: Q) => Promise<T>) { return this.as("authenticated", id, fn); }
  service<T>(fn: (q: Q) => Promise<T>) { return this.as("service_role", null, fn); }
  /** Superusuário (setup/inspeção que ignora RLS). */
  async sql(sql: string, params?: unknown[]) { return (await this.admin.query(sql, params)).rows; }

  async createUser(email: string, acceptNotice = true): Promise<string> {
    const [{ id }] = await this.sql("insert into auth.users (email) values ($1) returning id", [email]);
    if (acceptNotice) await this.user(id, (q) => q("select public.accept_ai_notice()"));
    return id;
  }
}
export type Q = (sql: string, params?: unknown[]) => Promise<any[]>;

/** Simula o Storage: o cliente (como authenticated) insere o objeto; o shim fixa owner_id. */
export async function uploadObject(db: TestDb, userId: string, path: string, opts: { size?: number; mime?: string } = {}) {
  await db.user(userId, (q) =>
    q("insert into storage.objects (bucket_id, name, metadata) values ('captures', $1, $2)", [
      path,
      JSON.stringify({ size: opts.size ?? 1000, mimetype: opts.mime ?? "image/png" }),
    ]),
  );
}
