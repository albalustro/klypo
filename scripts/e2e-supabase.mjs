#!/usr/bin/env node
// E2E contra um Supabase REAL/LOCAL (`supabase start`): isolamento via API HTTP (PostgREST + Storage + Auth).
// NÃO foi executado no ambiente de construção (sem Docker/Supabase). Uso:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... node scripts/e2e-supabase.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
if (!url || !anon) { console.error("Defina SUPABASE_URL e SUPABASE_ANON_KEY"); process.exit(2); }
const mk = () => createClient(url, anon, { auth: { persistSession: false } });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) failed++; };

async function user(tag) {
  const c = mk(); const email = `e2e-${tag}-${Date.now()}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: "senha-e2e-123" });
  if (error || !data.session) throw new Error("signUp falhou (confirmação de e-mail ligada?)");
  await c.rpc("accept_ai_notice");
  return { c, id: data.user.id };
}
const A = await user("a"), B = await user("b");
const sid = randomUUID(), path = `${A.id}/${sid}`;

let r = await A.c.storage.from("captures").upload(path, png, { contentType: "image/png", upsert: false });
ok(!r.error, "A envia arquivo para a própria pasta");
r = await B.c.storage.from("captures").upload(`${A.id}/${randomUUID()}`, png, { contentType: "image/png" });
ok(!!r.error, "B NÃO envia para a pasta de A");
r = await B.c.storage.from("captures").download(path);
ok(!!r.error, "B NÃO baixa o arquivo de A");
r = await A.c.rpc("finalize_capture", { p_batch_id: randomUUID(), p_mode: "separate", p_items: [{ kind: "image", id: sid, mime: "image/png", size_bytes: png.length, position: 0 }] });
ok(r.data?.[0]?.status === "accepted", "finalize aceita arquivo verificado");
r = await B.c.from("sources").select("id").eq("id", sid);
ok(!r.error && r.data.length === 0, "B não lê a fonte de A (RLS)");
r = await A.c.storage.from("captures").createSignedUrl(path, 60);
ok(!r.error && !!r.data?.signedUrl, "A obtém URL temporária do próprio arquivo");
r = await B.c.storage.from("captures").createSignedUrl(path, 60);
ok(!!r.error, "B NÃO obtém URL temporária do arquivo de A");
await A.c.rpc("delete_source", { p_source_id: sid });
r = await A.c.storage.from("captures").createSignedUrl(path, 60);
ok(!!r.error, "após exclusão lógica, nem A obtém o arquivo");
console.log(failed ? `\n${failed} falha(s)` : "\ntudo certo");
process.exit(failed ? 1 : 0);
