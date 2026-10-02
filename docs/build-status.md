# Status da construção — primeira execução (etapas 0, 1 e fluxo vertical da 2)

Legenda: ✅ feito e verificado • 🧪 feito, verificado só com fixture/simulação • ⚠️ feito, **não executado** neste ambiente • ⛔ bloqueado/fora de escopo

## Funcionalidades

| Item | Estado | Observação |
|---|---|---|
| Conta e-mail/senha, sessão persistente, recuperação | ⚠️ | Código + tipos + bundle OK; nunca rodou contra um Supabase Auth. Link de recuperação usa PKCE (`klypo://reset-password?code=`). |
| Importar da galeria / câmera / texto | ⚠️ | Código; sem aparelho. HEIC→JPEG no aparelho (não testado). |
| Prévia, nota, salvar | ⚠️ | idem |
| Fila local durável (SQLite) + upload/finalize idempotentes | ✅ lógica / ⚠️ adaptadores | Lógica testada (`core.test.ts`); `SqliteQueueStore`, `expo-file-system` e upload Storage não rodaram. |
| Caixa de entrada com estados reais | ⚠️ | Código; polling de 3 s. |
| Página estruturada, fonte com original + trechos, evidência navegável | 🧪/⚠️ | Backend verificado (fixture); telas não renderizadas. Sem bbox (nenhuma fabricada). |
| Edição com versões, conflito, rascunho persistido | ✅ backend / ⚠️ UI | RPC testada; rascunho em AsyncStorage não testado em runtime. |
| Reprocessar → proposta → aceitar/rejeitar | ✅ backend / ⚠️ UI | Edição manual sobrevive. |
| Exclusão de fonte/página (lógica imediata + limpeza física) | ✅ backend / ⚠️ UI | |
| Receber por Compartilhar (iOS/Android) | ⚠️ | Só configuração gerada/inspecionada (`docs/spike-share-intent.md`). **Não testado.** |
| Adaptador de IA real (Anthropic) | ⚠️ | Escrito, tipado, **nunca chamado**. |
| Adaptador FAKE | 🧪 | Dev/teste; marcado na UI (`fake-deterministic-v1`). |
| Eventos operacionais sem conteúdo | ✅ | `docs/events.md`. |
| Tópicos, busca, Perguntar, duplicatas, consolidação, exclusão de conta | ⛔ | Etapas seguintes. Só contratos Zod reservados (`SearchRequest`, `AskRequest`/`AskResponse`); **nenhuma tela ou resposta fictícia**. |
| Agrupar imagens em um documento | ⛔ | Rejeitado explicitamente no servidor (`mode_not_supported`). |

## Validação obrigatória (8 itens)

| # | Critério | Resultado | Onde |
|---|---|---|---|
| 1 | Imagem legível → página estruturada com fonte | ✅ automatizado (fixture) | `worker/pipeline.test.ts` |
| 2 | Imagem ilegível preserva original e pede revisão | ✅ automatizado (fixture) | `worker/pipeline.test.ts`, `db-tests/content.test.ts` |
| 3 | Retry de upload/finalize/processamento não cria páginas extras | ✅ automatizado | `mobile/queue/core.test.ts`, `db-tests/finalize-queue`, `content`, `worker/pipeline.test.ts` |
| 4 | Fechar/reabrir preserva capturas pendentes | ✅ lógica (store simulado: nova instância sobre o mesmo store) / ⚠️ SQLite real | `core.test.ts` |
| 5 | Edição manual sobrevive ao reprocessamento | ✅ automatizado | `db-tests/content.test.ts`, `worker/pipeline.test.ts` |
| 6 | Duas contas isoladas (banco **e** Storage) | ✅ banco e políticas de Storage em Postgres real com shim / ⚠️ Storage HTTP real | `db-tests/isolation.test.ts`; `scripts/e2e-supabase.mjs` **não executado** |
| 7 | Exclusão lógica vs. tarefas em andamento | ✅ automatizado | `db-tests/content.test.ts`, `worker/pipeline.test.ts` |
| 8 | Validação de schemas e referências | ✅ automatizado | `shared/schemas.test.ts`, `validate_blocks` (SQL), pipeline |

### Testes automatizados (75, todos passando em `npm test` + `npm run test:db`)
- `packages/shared` 6 — schemas de blocos, extração, saída da IA, evidências/URLs, contratos.
- `apps/mobile` 13 — fila local (10) e regras de edição (3).
- `packages/db-tests` 38 — finalize/limites/cota, fila (concorrência, lease, backoff, orçamento), isolamento RLS/Storage, evidências, versões/conflito, propostas, exclusão vs. jobs, injeção em dados.
- `services/worker` 18 — pipeline ponta a ponta com banco real + IA fixture, imagem (magic bytes, EXIF), logs sem conteúdo, config.
Mutação manual feita uma vez (desligar a checagem de URL derrubou o teste esperado).

### Inspeção manual realizada
`tsc --noEmit` nos 4 pacotes; `expo export` (Metro + Hermes) para **Android e iOS** compilaram; `expo prebuild` iOS+Android gerou e inspecionei extensão/entitlements/intent filters; migrations aplicadas do zero por `psql` e worker iniciado/encerrado. **Nenhuma tela foi aberta/renderizada** (sem simulador/navegador com react-native-web).

### Não executado (ambiente não permitiu)
Supabase local (sem Docker) e serviço Storage real; provedor de IA real (sem chave); build e execução em iOS/Android; Compartilhar em runtime; HEIC; câmera/galeria; deep link de recuperação; `expo lint`; `expo-doctor` 2 checks que dependem de rede.

## O que usa provider real × fixture
- Provider real: **nada** foi executado com IA real.
- Fixture/fake: todo o fluxo de IA nos testes (`FakeProvider` + `makeFixtureImage`). O fake não lê a imagem; ele não é evidência de qualidade de extração.

## Próximos passos (ordem sugerida)
1. Subir Supabase local, rodar `npm run e2e:supabase` e um fluxo manual no app com `AI_PROVIDER=fake`.
2. Com chave de IA: `AI_PROVIDER=anthropic`, rodar o corpus de avaliação (imagem legível, ruim, pouco contexto, dois idiomas, lote heterogêneo, instrução embutida…) e avaliar manualmente suporte semântico; ajustar prompts/limites de `output_config`.
3. Development builds iOS/Android e fechar o spike (decidir extensão própria × `expo-share-intent`).
4. Etapa 3: pgvector + embeddings (migration fixando modelo/dimensão), tópicos, busca híbrida, Perguntar com citações validadas no servidor.
5. Etapa 4: lote "mesmo documento", duplicatas por hash (coluna `content_hash` já gravada), telemetria/painéis.
6. Antes de produção: papel de banco dedicado ao worker, retenção/região do provedor, prazos de exclusão de conta, políticas de backup, rate limiting HTTP.
