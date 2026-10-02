# Setup e execução

Requisitos: Node ≥ 22, npm, Docker (para `supabase start`), Supabase CLI (`npx supabase`), PostgreSQL ≥ 15 só se quiser rodar os testes de banco sem Docker.

```bash
npm install                       # raiz (workspaces)
```

## 1. Testes (não precisam de Supabase nem de credenciais)

```bash
npm run typecheck                 # shared, db-tests, worker, mobile
npm test                          # shared + fila local/edição do app (puro TS)
npm run test:db                   # db-tests + worker contra um Postgres 15+ descartável
                                  #   (scripts/with-test-db.sh sobe/derruba um cluster temporário;
                                  #    ou defina TEST_PG_ADMIN_URL=postgres://postgres@host:porta/postgres)
```
Os testes de banco aplicam `packages/db-tests/shim.sql` (imita roles, `auth.uid()`, `storage.objects`) e depois **as migrations reais** de `supabase/migrations`. É uma prova de RLS/políticas/funções no Postgres, **não** do serviço Storage real.

## 2. Backend local (Supabase)

```bash
npx supabase start                # aplica supabase/migrations e supabase/seed.sql; imprime URL e chaves locais
npx supabase db reset             # recria do zero (somente banco LOCAL)
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> npm run e2e:supabase   # isolamento via HTTP (Auth+PostgREST+Storage reais)
```
`supabase/config.toml`: confirmação de e-mail desligada localmente; `klypo://reset-password` está em `additional_redirect_urls`. **Nenhum recurso remoto/pago é provisionado por este repositório.** Para um projeto remoto: `supabase link` + `supabase db push` (migrations são aditivas; nada destrutivo).

## 3. Worker

```bash
cp services/worker/.env.example services/worker/.env      # preencha DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# desenvolvimento sem provedor de IA (adaptador FAKE, claramente marcado, proibido em produção):
AI_PROVIDER=fake npm run worker
# com provedor real:
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... AI_MODEL=claude-opus-5-5 npm run worker
npm run worker:once               # drena a fila e sai
```
Carregue o `.env` no shell (`set -a; source services/worker/.env; set +a`) ou use seu gerenciador de processos. Variáveis **secretas**: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. Nada disso entra no app.

## 4. App

```bash
cp apps/mobile/.env.example apps/mobile/.env              # EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (públicas)
npm run app                       # expo start (Expo Go serve para tudo, EXCETO receber Compartilhar)
```
Development build (necessário para a captura nativa): `cd apps/mobile && npx expo prebuild --clean && npx expo run:ios` (ou `run:android`), ou `npx eas-cli build --profile development`. Antes de assinar, troque `app.klypo.mobile` / `group.app.klypo.mobile` (placeholders) em `app.json` pelos identificadores da sua conta Apple/Google.
Verificação de bundle sem dispositivo: `npm run bundle -w mobile` (Metro/Hermes, Android).

## O que falta para executar o fluxo REAL (nada disso existe no ambiente de construção)

1. Projeto Supabase (local via Docker ou remoto) com as migrations aplicadas e as chaves `anon` e `service_role`.
2. Credencial do provedor de IA (`ANTHROPIC_API_KEY`) e decisão de fornecedor/região/retenção (spec §9) antes do beta.
3. Um host para o worker (processo Node de longa duração).
4. Para captura nativa: Xcode + conta Apple (equipe/assinatura/App Group) e/ou Android SDK, e um aparelho.
