# Klypo — decisões de arquitetura (primeira execução: etapas 0, 1 e fluxo vertical da 2)

Escopo do produto: `Klypo_V1_Especificacao_Fluxos_Prompt_Claude.md`. Este documento só registra decisões **técnicas** e hipóteses; nada aqui altera o escopo.

## Estrutura do repositório

```
apps/mobile          App Expo (SDK 57) + TypeScript, Expo Router em src/app, textos em src/i18n/pt-BR.ts
packages/shared      Schemas Zod compartilhados (fonte, extração, página, bloco, evidência, estados, contratos de API)
packages/db-tests    Testes de migrations/RLS/fila contra Postgres real (+ shim.sql que imita o mínimo do Supabase)
services/worker      Worker Node/TS: fila com lease, pipeline de IA, limpeza física
supabase/            config.toml, migrations versionadas, seed.sql (vazio de propósito)
scripts/             with-test-db.sh (Postgres descartável), e2e-supabase.mjs (contra Supabase real; não executado aqui)
docs/                este arquivo, build-status.md, setup.md, events.md, spike-share-intent.md
```

## Versões (fonte: npm + `expo/bundledNativeModules.json`; docs.expo.dev estava bloqueado pelo proxy)

Expo SDK **57** (`expo ~57.0.26`, React 19.2.3, React Native 0.86.3), Expo Router ~57.0.24, `@supabase/supabase-js` ^2.117, `zod` ^4.6, `expo-share-intent` 8.0.1 (a tabela do README dela confirma "SDK 57 → 8.0+"), Node ≥ 22, PostgreSQL 15+ (Supabase local usa 17). Lockfile único na raiz (`package-lock.json`); `overrides` fixa `react`/`react-native` para evitar duplicata de módulo nativo (o `expo-doctor` acusou `react` duplicado antes do override).
`npx expo install` não funcionou (API de compatibilidade bloqueada); as versões dos módulos Expo foram tiradas do `bundledNativeModules.json` do próprio pacote `expo`. `expo-doctor`: 19/21 checks; os 2 que falham dependem de rede (schema do app.json e React Native Directory).

## Dados e segurança (Supabase/Postgres)

- **Cliente só lê.** RLS habilitada em todas as tabelas; `authenticated` tem apenas `SELECT` nas tabelas de conteúdo. Toda escrita passa por funções `SECURITY DEFINER` com `search_path = ''` que derivam o dono de `auth.uid()`. `search_chunks`, `usage_events` e `server_config` não têm nenhum acesso direto do cliente.
- **Isolamento por construção:** toda tabela de conteúdo tem `owner_id` e FKs compostas `(id, owner_id)`, então nem um UUID válido de outra conta cria relação cruzada. O caminho do arquivo é `{owner_id}/{source_id}` e é imposto por `CHECK` em `sources`.
- **Exclusão lógica imediata:** policies de `sources`, `source_extractions`, `source_segments`, páginas etc. escondem o que foi excluído; a policy de Storage só libera leitura enquanto existir uma fonte visível apontando para o arquivo. A limpeza física (arquivo, extrações, segmentos, chunks) é um job `purge_source`. A linha de `sources` vira *tombstone* (mantém o id) para que um retry de `finalize` nunca ressuscite o conteúdo (`source_deleted`).
- **Storage:** bucket `captures` privado, 15 MB, JPEG/PNG. INSERT só em `{auth.uid()}/{uuid}`; sem UPDATE/DELETE para o cliente. `finalize_capture` só cria fonte+job depois de encontrar o objeto em `storage.objects` com `owner_id = auth.uid()`, tamanho e MIME dentro dos limites.
- **Limites no servidor** (`server_config`): imagens/lote, bytes, caracteres, cota diária de capturas, orçamento diário de jobs de IA, tentativas, backoff. Sem orçamento de IA o job é adiado (`available_at`), a captura é preservada.
- **Aviso de IA** (`profiles.ai_notice_accepted_at`) é exigido pelo servidor em `finalize_capture`.

## Fila e idempotência

- Cliente: fila local durável (SQLite) → `uploading/uploaded` → `finalize_capture` → recebido. O **id da fonte é gerado no cliente** e serve de chave de idempotência (upload `upsert:false` + `finalize` com `ON CONFLICT`).
- Servidor: tabela `jobs` com `dedupe_key` única, `lease_token`/`lease_until`, `attempts/max_attempts`, backoff exponencial. `claim_job` usa `FOR UPDATE SKIP LOCKED`. Toda função `worker_*` revalida lease, existência e exclusão da fonte (`job_guard`); um worker "zumbi" recebe `lease_lost`.
- Efeitos únicos por constraint: `knowledge_pages(owner_id, generation_key)` única; `source_extractions.job_id` único; `page_proposals.job_id` único; `jobs.dedupe_key` único.
- Persistência da página é uma transação (`worker_persist_page`): página + versão 1 + vínculos + `block_evidence` + chunks + estado da fonte + sucesso do job.

## Versões, edição e reprocessamento

- `page_versions` é imutável; `knowledge_pages.active_version_id` aponta a ativa. `save_page_version(page, base_version_id, …)` trava a página; base diferente → `{status:'conflict'}` (nada é sobrescrito; o app mantém o rascunho e oferece reaplicar/descartar). Retry do mesmo salvamento devolve a mesma versão.
- `manual_fields` (título/resumo editados) é calculado **no servidor**. Bloco editado pelo usuário vira `origin:'user'` ("Sua anotação") sem evidência — decisão: nunca atribuir à fonte um texto que a pessoa escreveu (custo: o vínculo com o trecho original se perde naquele bloco; a versão anterior continua no histórico).
- Reprocessar gera `page_proposals` (nunca altera a versão ativa). `accept_proposal` exige a versão-base que o usuário viu, troca só blocos `extracted` e **preserva** título/resumo manuais e todos os blocos `user`/`synthesis`.
- O banco valida os blocos de novo (`validate_blocks`): tipos, ids únicos, `user` sem evidência, `extracted` com evidência, evidência = segmento vivo de fonte da própria página.

## Pipeline de IA (services/worker)

validar → preparar (magic bytes; derivada JPEG ≤2000 px sem EXIF/GPS) → extrair → estruturar → validar schema+evidências+URLs → persistir. `AiProvider` tem dois adaptadores: `AnthropicProvider` (real; **não verificado contra a API** por falta de chave) e `FakeProvider` (determinístico, só dev/teste; recusado com `NODE_ENV=production`; grava `model = fake-deterministic-v1`, o app mostra aviso). Regras: 1 retry de correção de formato; ids de evidência inexistentes e URLs que não estão na fonte são rejeitados; `insufficient_content`/`illegible` → `needs_review` sem página; conteúdo da fonte vai delimitado como dado não confiável. Modelo e `pipeline_version` ficam em cada extração/versão. Modelo padrão `claude-opus-5-5` é **configuração** (`AI_MODEL`), trocável sem código.
Logs: lista de chaves permitidas (`log.ts`); erros do provedor nunca são propagados/logados com mensagem.

## Captura nativa (etapa 0) — veja `docs/spike-share-intent.md`

## Hipóteses registradas (decisões reversíveis)

1. Indexação "pronta" nesta execução = chunks lexicais em `search_chunks` (sem embeddings; pgvector/dimensão ficam para a etapa 3 por migration própria). Não há busca nem "Perguntar" na UI.
2. Agrupar imagens como "mesmo documento" não está implementado: `finalize_capture` rejeita `same_document` com `mode_not_supported`; a prévia avisa. Cada imagem do lote é uma fonte/página.
3. HEIC é convertido para JPEG **no aparelho** (ImageManipulator) antes do upload; a prebuilt do `sharp` não decodifica HEIC. Não testado em aparelho.
4. Derivadas não são persistidas; o app exibe o original por URL assinada de 5 min. Miniaturas dedicadas ficam para depois.
5. Tópicos: a IA já devolve `suggestedTopics` (guardado em `page_versions.suggested_topics`), sem tabelas/UI de tópicos ainda.
6. Excluir conta **não** está exposto (a especificação exige prazos operacionais/backups antes de oferecer).
7. Edição de extração ("corrigir extração") e edição de tabelas ficaram fora; tabelas são somente leitura.
8. O worker conecta com `DATABASE_URL` e só executa funções `worker_*`/`claim_job` (EXECUTE concedido a `service_role`). Recomenda-se um papel de banco dedicado antes de produção.
9. `finalize_capture` lê `storage.objects` de dentro de função definer: validado no shim e a ser reconfirmado no Supabase real (`scripts/e2e-supabase.mjs`).
