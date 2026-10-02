# Klypo — Definição, especificação e plano de construção da V1

Versão 1.0 • 2 de outubro de 2026 • Documento em português

Este documento propõe um recorte implementável a partir do conceito e do demo apresentados por Rafael. As decisões abaixo são defaults para começar a construção; a reação positiva de um amigo é um sinal para testar o produto, ainda não uma validação de retenção ou disposição a pagar.

## 1. Definição do produto

**Klypo transforma o que você captura em conhecimento pessoal organizado, editável e recuperável.**

O usuário salva screenshots, fotos ou textos. O aplicativo preserva os originais, interpreta o conteúdo, cria páginas de conhecimento, sugere tópicos e permite encontrar ou perguntar sobre o que foi salvo.

Posicionamento: **uma base de conhecimento pessoal que se constrói a partir das suas capturas.**

Mensagem de marca: “Turn what you see into what you know.”

Promessa para a V1: “Salve uma imagem. Receba uma página útil. Encontre essa informação quando precisar, com acesso à fonte.”

Loop central: **Capturar → Entender → Organizar → Recuperar → Reutilizar.**

### Público inicial

Profissionais de produto, design e tecnologia que já salvam screenshots de referências, exemplos, recomendações e instruções, mas têm dificuldade para reencontrar e usar esse material. Esse é o público inicial de teste, não uma restrição dos assuntos que o app pode aceitar.

### Problema e jobs

| Situação | O que o usuário quer fazer | Resultado desejado |
| --- | --- | --- |
| Encontro uma referência útil | Guardar sem interromper o que estou fazendo | Captura em poucos toques |
| Acumulei fotos e screenshots | Entender e organizar sem transcrever tudo | Páginas com título, resumo e informação útil |
| Lembro da ideia, mas não da origem | Buscar pelo significado | Encontrar conteúdo mesmo sem lembrar palavras exatas |
| Tenho várias fontes sobre o mesmo assunto | Relacionar e comparar | Um tópico e, quando fizer sentido, uma síntese com fontes |
| Preciso aplicar o que salvei | Perguntar ou consultar instruções | Resposta fundamentada na minha base |

### Momento de valor

O primeiro momento de valor acontece quando uma captura desorganizada vira uma página reconhecível e útil. A validação mais forte acontece depois: o usuário retorna para encontrar ou usar algo que salvou.

## 2. Recorte da V1

### Beta inicial: obrigatório

1. Conta pessoal, login e logout.
2. Importar screenshots/fotos da galeria, tirar foto e colar texto.
3. Receber imagens e texto pelo menu nativo Compartilhar.
4. Capturar em lote, com identificação individual dos arquivos.
5. Caixa de entrada com estados reais de upload e processamento.
6. Extração do conteúdo e criação de página estruturada.
7. Página editável com acesso aos originais e trechos de evidência.
8. Tópicos automáticos simples, renomeáveis e removíveis.
9. Busca por palavras e por significado.
10. Perguntar ao Klypo, com citações navegáveis e resposta de evidência insuficiente.
11. Detecção de arquivo repetido e sugestão de conteúdo relacionado.
12. Exclusão de capturas/páginas e exclusão da conta.
13. Métricas do loop, latência, falhas e custo de IA.

### Fechamento da V1: depois do loop funcional

Consolidação manual de páginas, com prévia, confirmação, histórico e desfazer. Não bloquear o primeiro teste do produto por essa funcionalidade, mas não chamar a V1 de completa antes de implementá-la.

### Próximo ciclo, fora desta construção

- PDF e documentos longos; terão paginação, limites e extração próprios.
- Links com leitura automática de páginas. Na V1, uma URL colada é apenas texto: não buscar, baixar ou resumir seu destino.
- RevenueCat, planos pagos e assinaturas.
- Revisão espaçada, lembretes, agentes e automações.
- Importação de toda a biblioteca de fotos.
- Colaboração, social, páginas públicas, extensão de navegador e app desktop.
- Editor completo de notas com blocos arbitrários, grafo visual e árvore profunda de pastas.

O conceito maior continua aceitando várias fontes. O recorte de imagens/texto concentra a primeira construção no comportamento que o demo mostrou. Preparar o modelo para PDF e URL sem implementar funcionalidades vazias.

## 3. Regras fundamentais

### Fonte, página e tópico são entidades diferentes

| Entidade | Definição | Exemplo |
| --- | --- | --- |
| Captura/Fonte | Original imutável recebido do usuário | Uma foto de um artigo impresso |
| Página de conhecimento | Conteúdo estruturado, gerado e editável | “Princípios de pistas em adventure games” |
| Tópico | Conexão entre páginas | “Puzzle design” |
| Lote | Agrupa uma ação de importação; não comprova unidade de conteúdo | Seis fotos selecionadas juntas |
| Síntese | Página que reúne várias fontes/páginas após confirmação | “Guia de design de puzzles” |

Uma fonte pode apoiar várias páginas; uma página pode usar várias fontes; uma página pode pertencer a vários tópicos. Lote não é sinônimo de documento.

### Regras de organização

- Criar uma página por captura legível por padrão.
- Se o usuário marcar “Estas imagens são partes do mesmo documento”, preservar ordem e criar uma página com as fontes selecionadas. Partes ilegíveis aparecem como pendência.
- Um lote com assuntos diferentes gera páginas separadas.
- Similaridade de assunto conecta páginas e sugere consolidação; não as funde automaticamente.
- Reutilizar tópicos existentes quando fizer sentido. Propor até três por página inicialmente. Tópicos planos na V1; sem hierarquia obrigatória.
- Não sugerir relações quando só houver coincidência superficial de palavras.
- Arquivo idêntico: detectar por hash dentro da mesma conta e oferecer abrir a captura existente ou manter outra cópia. Não deduplicar entre usuários.

### Regras de confiança

- Nunca preencher texto ilegível com uma suposição apresentada como transcrição.
- Preservar o idioma da fonte. A página pode ser gerada no idioma preferido do usuário; indicar quando houve tradução.
- Distinguir “Extraído das fontes”, “Síntese do Klypo” e “Sua anotação”.
- Não inventar autor, data, URL ou título publicado. Usar “Título gerado pelo Klypo” quando necessário.
- Uma pergunta sem apoio deve receber: “Não encontrei informação suficiente nas suas fontes para responder.” Oferecer conteúdos próximos quando existirem.
- Citações devem abrir a fonte e o trecho correspondente. Uma lista genérica de arquivos no rodapé não basta.
- O conteúdo capturado é dado, não instrução para o sistema. Textos como “ignore suas instruções” dentro de uma imagem não alteram o comportamento do pipeline.
- O app não consulta a internet para completar lacunas na V1.

## 4. Experiência e navegação

Interface em português no beta, com textos centralizados para futura tradução. Conhecimento pode permanecer no idioma original; preferência inicial da página: português. Design proposto: claro, calmo, focado em leitura; branco quente, texto escuro e um acento violeta. Não é uma identidade de marca já aprovada.

Navegação inferior: **Biblioteca · Tópicos · Perguntar**. A Biblioteca abre em “Conhecimento”, com acesso visível a “Caixa de entrada” e contador de pendências. Botão “Adicionar” sempre acessível. Busca no topo da Biblioteca. Configurações pelo avatar.

### Telas e responsabilidades

| Tela | Objetivo | Conteúdo principal | Ações |
| --- | --- | --- | --- |
| Boas-vindas | Explicar valor em uma frase | Exemplo visual antes/depois | Criar conta, entrar |
| Autenticação | Vincular base a uma conta | E-mail, senha, recuperação | Entrar, cadastrar, recuperar |
| Primeira captura | Levar à experiência real | “Adicione algo que você gostaria de encontrar depois” | Galeria, câmera, texto |
| Prévia da captura | Confirmar entrada sem organizar manualmente | Miniaturas, ordem, nota opcional | Salvar, retirar arquivo, marcar mesmo documento |
| Caixa de entrada | Tornar processamento visível | Miniaturas e estados individuais | Abrir fonte, tentar novamente, excluir |
| Biblioteca | Consultar conhecimento pronto | Títulos, resumo breve, tipo e tópicos | Buscar, filtrar, abrir, adicionar |
| Página | Ler e aplicar | Resumo, conteúdo, tópicos, fontes, relações | Editar, perguntar sobre página, consolidar, excluir |
| Fonte | Conferir original e extração | Imagem com zoom, texto extraído e metadados | Abrir trecho, corrigir extração, reprocessar |
| Tópicos | Navegar por assunto | Lista de tópicos e quantidade de páginas | Abrir, renomear, remover associação |
| Busca | Encontrar pelo que lembra | Resultados, filtros de tópico/tipo | Abrir resultado e trecho relevante |
| Perguntar | Responder a partir da base | Escopo, pergunta, resposta, citações | Perguntar, abrir fonte, dar feedback |
| Consolidação | Criar uma síntese revisável | Seleção, prévia e diferenças | Confirmar, cancelar, desfazer |
| Configurações | Controlar conta e dados | Idioma, informação sobre IA, exclusão | Alterar preferência, sair, excluir conta |

Elementos mínimos: alvos de toque confortáveis, contraste legível, suporte a aumento de fonte, rótulos para leitor de tela, feedback de upload, estados de vazio/erro e nenhum botão decorativo sem ação.

## 5. Fluxos da aplicação

### A. Primeira experiência

1. Usuário abre Klypo e vê a promessa com um exemplo curto.
2. Cria conta por e-mail/senha, confirma e-mail conforme configuração e entra.
3. Vê convite para adicionar uma captura. Não precisa escolher profissão ou criar pastas.
4. Escolhe galeria, câmera ou texto. Permissões são solicitadas quando necessárias.
5. Confirma a prévia e toca em “Salvar no Klypo”.
6. Vê “Salvo neste dispositivo; enviando” enquanto ainda não houver persistência remota. Após upload confirmado, vê “Recebido; processando”.
7. Pode sair do app. O processamento no servidor continua.
8. Ao voltar, abre a página pronta, confere o original e pode editar.
9. Recebe uma pergunta sugerida contextual. Ela só é respondida ao ser acionada pelo usuário.

Se não houver rede, a captura fica pendente localmente. A V1 tenta upload quando o app volta ao primeiro plano; não prometer envio em background contínuo.

### B. Captura por Compartilhar

1. Usuário seleciona uma ou mais imagens ou texto em outro app.
2. Abre Compartilhar → Klypo.
3. Klypo mostra prévia simples e opção de mesmo documento quando houver várias imagens.
4. Ao confirmar, copia o material para armazenamento local durável e registra a fila antes de informar sucesso.
5. Com conta ativa e rede disponível, envia; caso contrário, mantém pendente e pede login/abertura do app para concluir.
6. A extensão retorna ao app de origem. Não espera pela IA.
7. O material aparece na Caixa de entrada; o usuário consulta o resultado depois.

Testar imagem única, múltiplas imagens, texto, app fechado, sessão expirada e envio interrompido. Não assumir que compartilhar para fora do app prova recebimento de conteúdo.

### C. Lote de seis fotos, como no demo

1. Selecionar seis fotos de material sobre design de adventure games.
2. Preservar seis fontes individuais no mesmo lote.
3. Extrair conteúdo de cada foto; sinalizar fotos com legibilidade insuficiente.
4. Criar páginas por fonte, ou uma página por documento explicitamente indicado pelo usuário.
5. Sugerir tópicos como “Game design” e “Puzzle design”, quando apoiados pelo material.
6. Mostrar: “Há conteúdos relacionados neste lote. Quer criar uma síntese?”
7. Após confirmação, gerar prévia da síntese com referências às fontes.
8. Usuário revisa e confirma. Originais e páginas anteriores continuam disponíveis.
9. Perguntar “O que torna um puzzle justo?” recupera trechos reais das fontes; citações dependem do que realmente foi extraído.

Este é um cenário de aceitação baseado no demo anterior, não uma nova transcrição das seis imagens. Os arquivos devem ser fornecidos ao ambiente de construção antes do teste com material real. Não hardcodar as respostas do demo.

### D. Encontrar algo posteriormente

1. Abrir Biblioteca → Busca.
2. Digitar o que lembra, por exemplo “dicas para jogador não ficar frustrado”.
3. Receber resultados que combinam palavras e significado.
4. Abrir página ou trecho relevante.
5. Conferir a fonte ou usar a informação. Registrar abertura como recuperação, sem confundir isso com prova de aplicação.

### E. Perguntar ao Klypo

1. Escolher escopo: toda a base, tópico ou página.
2. Digitar pergunta.
3. Servidor recupera apenas conteúdo do usuário e do escopo escolhido.
4. Gera resposta baseada nos trechos recuperados.
5. Exibe citações por afirmação ou parágrafo e permite abrir a evidência.
6. Se houver contradições, descreve as diferenças e cita as versões.
7. Sem evidência suficiente, informa a limitação. Não preenche a resposta com conhecimento geral.

### F. Editar, corrigir e reprocessar

1. Editar título, resumo ou bloco; salvar versão com controle de concorrência.
2. A mudança manual passa a ser o conteúdo ativo da página.
3. Se corrigir a extração da fonte, preservar a versão anterior e gerar nova extração versionada.
4. Reprocessar produz uma proposta, não substitui a página editada.
5. Usuário aceita ou rejeita mudanças em prévia. Enquanto isso, a versão ativa permanece intacta.
6. Busca e perguntas passam a usar a versão ativa; blocos manuais aparecem como “Sua anotação”, sem atribuição falsa à fonte original.

### G. Excluir

1. Ao excluir uma página, explicar que as fontes permanecem, salvo seleção explícita para removê-las também.
2. Ao excluir uma fonte, mostrar páginas dependentes e confirmar o efeito.
3. Remover imediatamente essa fonte de busca, perguntas e acesso de visualização; marcar blocos dependentes como “Fonte removida”.
4. Atualizar a indexação das páginas afetadas e apagar arquivo, extrações e embeddings da fonte por tarefa rastreada.
5. Exclusão da conta revoga acesso e agenda remoção de todo o conteúdo ativo. Informar o prazo operacional e a retenção de backups reais antes de disponibilizar a opção no beta.

## 6. Requisitos funcionais e critérios de aceite

| ID | Requisito | Critério de aceite |
| --- | --- | --- |
| RF01 | Importar captura | Imagem ou texto aparece na fila sem esperar IA; original continua acessível |
| RF02 | Retomar upload | Interrupção e reabertura retomam sem perder captura nem gerar página extra |
| RF03 | Processar conteúdo | Imagem legível gera estrutura validada; imagem ilegível não gera conteúdo inventado |
| RF04 | Persistir lote | Cada item tem identidade/estado próprio; falha de um não bloqueia os demais |
| RF05 | Página útil | Título, resumo, corpo estruturado, tópicos e fontes; campos ausentes são omitidos |
| RF06 | Evidência | Referência abre captura e trecho/segmento correspondente |
| RF07 | Editar | Alteração persiste e não é sobrescrita em retry ou reprocessamento |
| RF08 | Organizar | Tópicos podem ser renomeados e associações corrigidas |
| RF09 | Recuperar | Busca encontra conteúdo por paráfrase e nome exato em corpus de teste |
| RF10 | Perguntar | Resposta sustentada tem fontes válidas; pergunta fora da base recebe insuficiência |
| RF11 | Consolidar | Prévia, confirmação, preservação das fontes, histórico e desfazer |
| RF12 | Isolar contas | Conta B não lê arquivos, páginas, vetores ou respostas da conta A |
| RF13 | Excluir | Conteúdo excluído deixa de participar de consulta antes da limpeza física terminar |
| RF14 | Compartilhar | Recebe imagens/texto em build nativo; transferência preserva arquivo e não depende de IA |

Limites iniciais propostos, configuráveis no servidor: até 10 imagens por lote; 15 MB por imagem; 20 mil caracteres por texto. Aceitar JPEG, PNG e HEIC com normalização suportada e testada. Validar MIME e conteúdo real do arquivo; orientar conversão quando necessário. Manter original e gerar derivada para análise. Remover localização EXIF das derivadas e evitar expor localização nos metadados da página.

Tipos de página iniciais: **Referência, Guia/Como fazer, Recomendação e Nota**. Demais formatos usam Referência com blocos flexíveis. Não construir seis editores especializados no primeiro ciclo.

Blocos iniciais: parágrafo, lista, passos, tabela simples e destaque. IA escolhe a estrutura compatível; não criar passos artificiais para um conteúdo conceitual.

Estados vazios: Biblioteca — “Salve algo que você quer encontrar depois”; Perguntar — “Adicione uma fonte para começar”; Busca sem resultado — “Não encontramos isso na sua base”; erro — preservar captura e oferecer tentativa novamente; ilegível — abrir original e oferecer substituir foto/corrigir texto.

## 7. Arquitetura proposta

### Decisão inicial

**React Native + Expo + TypeScript** no cliente; **Supabase Auth, Postgres, Storage privado e pgvector** no backend; processamento assíncrono por worker no servidor; adaptadores para IA visual/textual e embeddings.

Manter iOS e Android no projeto. Validar captura nativa cedo nos dois; conduzir o primeiro piloto em iOS como hipótese operacional, confirmando os aparelhos dos primeiros testers. Não construir um site ou desktop como substituto do aplicativo.

A captura pelo menu Compartilhar exige prova de integração nativa. Expo permite extensões iOS via configuração nativa/config plugins e builds específicos. Verificar a solução vigente e suas limitações; algumas abordagens de recebimento podem ter restrições de ciclo de vida. Expo Go não é o critério de aceite dessa função.

### Componentes

| Componente | Responsabilidade |
| --- | --- |
| App mobile | Interface, sessão, seleção de arquivos e fila local durável |
| Adaptador nativo de captura | Receber compartilhamentos e transferir dados com segurança para o app |
| API autenticada | Finalizar uploads, criar jobs, buscar, perguntar e aplicar alterações |
| Storage privado | Originais e derivadas; acesso autenticado ou URLs temporárias |
| Postgres | Fontes, páginas, versões, tópicos, evidências, jobs e métricas |
| Worker | Extração, estruturação, indexação e limpeza com retries |
| Adaptadores de IA | Contratos versionados; provedores/modelos substituíveis |

Usar Supabase CLI e migrations para ambiente reproduzível. O worker pode ser um serviço TypeScript independente; tarefas longas não devem depender do app aberto ou de uma requisição HTTP sem controle de timeout. Começar com fila persistida no Postgres, com lease, retry e aquisição atômica; não adicionar Redis sem necessidade demonstrada.

### Modelo mínimo de dados

Todas as entidades de conteúdo têm owner_id. Chaves estrangeiras e validações impedem relações entre contas, mesmo com IDs válidos de outra conta.

| Entidade | Campos e regras principais |
| --- | --- |
| profiles | user_id, idioma, created_at |
| capture_batches | id, owner_id, mode: separate/same_document, created_at |
| sources | id, owner_id, batch_id, kind, object_path/text_original, mime, hash, posição, estado, deleted_at |
| source_extractions | id, source_id, versão, idioma, texto, segmentos, issues, pipeline_version |
| source_segments | id estável, extraction_id, posição, texto, locator; bbox opcional quando extraída com confiabilidade |
| knowledge_pages | id, owner_id, tipo, versão ativa, origem: single/document/synthesis, estado |
| page_versions | id, page_id, título, resumo, blocos JSON validados, idioma, created_by, base_version, created_at |
| page_source_links | page_id, source_id; conjunto exato de fontes da página |
| block_evidence | page_version_id, block_id, segment_id; somente relações válidas do mesmo usuário |
| topics / page_topics | nome canônico/editável, owner_id, associação com página |
| search_chunks | id, owner_id, source/page, versão, texto, embedding, metadados de recuperação |
| jobs | tipo, dedupe_key, status, attempts, available_at, lease_until, erro seguro, pipeline_version |
| merge_operations | páginas de origem, página destino, estado prévio, versão gerada; suporta desfazer |
| ask_sessions / ask_messages | escopo, pergunta, resposta, referências, modelo; histórico privado |
| usage_events | nome, entidade, timestamps, contadores; sem texto bruto ou imagens |

Escolher modelo/dimensão de embeddings na implementação e fixá-los em configuração/migration. Mudança exige reindexação rastreável. Não misturar dimensões ou versões silenciosamente.

### Operações de backend

Contratos: iniciar/finalizar captura, consultar estado, solicitar reprocessamento, salvar versão, sugerir tópicos, buscar, perguntar, prévia/confirmar/desfazer consolidação e excluir. A organização em rotas ou funções é livre; os contratos de entrada/saída devem usar schemas compartilhados.

Finalizar captura só cria job após confirmar que o arquivo pertence à conta e existe. Retry de finalize com a mesma chave retorna a mesma captura/job. Escrita de versão exige base_version; conflito preserva as duas alterações e pede reconciliação.

### Estados e consistência

Cliente: **pendente local → enviando → recebido**. Servidor: **na fila → extraindo → estruturando → indexando → pronto**, com **precisa de revisão**, **falhou** e **excluído** como estados explícitos.

“Pronto” significa página persistida e indexação concluída. Se a página já estiver legível antes do índice, mostrar “Página disponível; preparando busca”. Retry não repete efeitos já concluídos. Usar unique constraints, dedupe_key e transações; não depender apenas de uma checagem no código.

## 8. Pipeline de IA e recuperação

1. **Validar:** tipo, tamanho, propriedade e status de exclusão.
2. **Preparar:** manter original, gerar derivada adequada, tratar orientação e formato.
3. **Extrair:** obter texto e segmentos da imagem; registrar ilegibilidade e metadados explicitamente presentes.
4. **Estruturar:** produzir título gerado, resumo, tipo, blocos, tópicos sugeridos e referências a segmentos reais.
5. **Validar schema e evidências:** rejeitar IDs inexistentes, campos inesperados e ligações de outra conta. Um retry de correção de formato é permitido; se falhar, preservar fonte e mostrar erro.
6. **Persistir:** criar versão gerada sem alterar edições existentes.
7. **Indexar:** trechos de fontes e páginas ativas; preservar proveniência e sinalizar anotações manuais.
8. **Relacionar:** sugerir tópicos e páginas próximas. Similaridade não significa duplicata comprovada.

Uma referência tecnicamente válida não prova que a afirmação é sustentada. Incluir avaliação semântica humana do corpus no aceite; não exibir um percentual de confiança inventado pelo modelo como precisão factual.

Para perguntar, combinar busca textual e vetorial com filtros de usuário/escopo aplicados antes da seleção. Deduplicar trechos equivalentes, limitar contexto e fornecer ao modelo apenas evidências necessárias. Preferir originais para afirmações extraídas, evitando tratar uma síntese da IA como confirmação independente da mesma informação.

Validar a existência e autorização das citações no servidor, e bloquear respostas com referências inválidas. Recuperação sem resultado não significa certeza de ausência: a mensagem deve dizer que o sistema não encontrou informação suficiente. Custo, latência, tokens e versão de modelo são registrados sem armazenar conteúdo sensível em logs operacionais.

## 9. Privacidade e operação

- Bucket privado e políticas RLS em tabelas, arquivos e recuperação vetorial; não confiar no owner_id enviado pelo cliente.
- Chaves de IA e credenciais administrativas somente no servidor. Credencial pública do cliente não concede acesso administrativo.
- Worker privilegiado valida proprietário e exclusão em cada operação. Jobs órfãos não reconstroem material apagado.
- Original é privado; somente miniaturas/derivadas autorizadas e URLs temporárias são exibidas.
- Explicar antes da primeira captura que o conteúdo será enviado a provedores de IA para processamento. Escolher fornecedor, região, retenção e uso dos dados antes do beta; não prometer “nunca usado para treinamento” sem confirmar os termos/configuração reais.
- Limites de uso, rate limit, tamanho de resposta e orçamento de IA por conta configuráveis. Na falta de limite disponível, preservar captura e pausar job; não perder material nem criar cobrança automática.
- Logs de erro sem imagens, texto extraído, perguntas ou respostas completas; redigir dados sensíveis de erros do provedor.
- Busca, respostas e arquivos removidos ficam inacessíveis imediatamente após exclusão lógica. Limpeza física e política de backups têm prazos reais documentados.
- Modo offline limitado a capturas pendentes e conteúdos já disponíveis localmente; busca semântica e perguntas exigem rede.

## 10. Piloto e métricas

Conduzir piloto com 5–10 pessoas que já capturam referências. Pedir capturas reais e observar retorno durante duas semanas. Não depender apenas de um conjunto de screenshots preparado pelo fundador.

| Pergunta | Medida |
| --- | --- |
| O usuário percebe valor na primeira sessão? | Primeiro upload → página pronta → primeira abertura |
| Ele volta? | Retorno para nova captura e retorno para recuperar material, medidos separadamente |
| A página melhora a fonte? | Avaliação útil/não útil e motivo; correções necessárias |
| Recuperação funciona? | Busca/pergunta seguida de abertura de resultado ou fonte; teste observado de reencontro |
| A resposta é sustentada? | Avaliação humana de suporte, validade de citações e abstinência |
| A operação é viável? | Custo por captura/pergunta, falhas, retries e latência p50/p95 |

Eventos: capture_saved_local, upload_completed, processing_completed, processing_failed, page_opened, page_edited, search_submitted, search_result_opened, ask_submitted, answer_completed, citation_opened, feedback_submitted, merge_confirmed, capture_deleted. Definir nomes e propriedades em um documento único; evitar texto bruto como propriedade.

Meta operacional inicial, a medir: página de uma imagem legível disponível em até 30 segundos no p50 e 90 segundos no p95, em rede estável. São objetivos, não promessa comercial. Avaliar novamente após escolher modelos e infraestrutura.

Gate qualitativo proposto para continuar: ao menos metade dos participantes recuperar espontaneamente algo em outra sessão e conseguir apontar uma informação que o Klypo tornou mais fácil de usar. Amostra pequena serve para orientar decisões, não estimar mercado.

Não definir preço agora. Primeiro medir frequência de captura, recuperação, custo e intenção de continuar. Pagamentos permanecem fora deste build.

## 11. Construção em etapas verificáveis

| Etapa | Entrega | Gate de conclusão |
| --- | --- | --- |
| 0 — Riscos de captura | Spike de importação e recebimento nativo | Imagem única/lote/texto persistem e reaparecem após fechar o app; limitações documentadas |
| 1 — Fundação | App, conta, banco, Storage, RLS, fila local/servidor | Duas contas isoladas; upload interrompido não perde dados |
| 2 — Loop real | Uma imagem → extração → página → fonte → edição | Provider real integrado; arquivo original e evidências navegáveis |
| 3 — Recuperação | Tópicos, busca híbrida e perguntas | Paráfrases encontram material; pergunta fora da base não inventa resposta |
| 4 — Robustez | Lotes, duplicatas, reprocessamento, exclusão e telemetria | Retry idempotente; edições preservadas; exclusão elimina resultados |
| 5 — Consolidação e piloto | Prévia/confirmar/desfazer, builds para testers | Fontes preservadas; cenários do demo e teste em dispositivos registrados |

Não prever duração antes do spike nativo e da escolha dos provedores. O beta inicial pode ser testado antes da etapa 5, com consolidação explicitamente ausente.

Corpus de avaliação: imagens legíveis, imagem ruim, screenshot com pouco contexto, conteúdo em dois idiomas, lote heterogêneo, partes ordenadas de um documento, conteúdo contraditório, duplicata, texto com tentativa de instrução e pergunta sem resposta na base. As seis fotos do demo entram quando estiverem disponíveis. Testes sintéticos precisam estar identificados como fixtures.

Critérios de conclusão: migrations reproduzíveis; fluxo com conta real e provider real; builds nativos validados; RLS testada; citações/abstinência avaliadas; retries e exclusão testados; custos medidos; instruções de setup; limites e itens não testados declarados.

## 12. Prompt para o Claude começar a construção

**Como usar:** anexar este documento ao Claude Code ou ao agente com acesso ao repositório e enviar o texto abaixo. É um prompt de implementação, não um script executável de terminal. Ele autoriza construir localmente; não autoriza publicação nas lojas ou mudanças em infraestrutura de produção existente.

---

Você vai começar a implementar o **Klypo**, aplicativo mobile que transforma screenshots, fotos e textos em uma base de conhecimento pessoal organizada, editável e recuperável.

Leia integralmente o documento “Klypo_V1_Especificacao_Fluxos_Prompt_Claude.md” antes de editar. Ele é a especificação de produto, fluxos, regras de dados, requisitos de confiança e critérios de aceite. Trabalhe como engenheiro responsável pelo resultado: implemente e verifique, não entregue somente um plano ou uma interface com dados estáticos.

**Objetivo desta primeira execução:** concluir as etapas 0, 1 e o primeiro fluxo vertical da etapa 2, conforme acesso ao ambiente. Uma pessoa deve conseguir entrar, importar uma imagem, acompanhar seu processamento, abrir a página gerada, conferir a fonte e editar sem perder suas alterações. As etapas seguintes estão especificadas para orientar a arquitetura; não expanda esta primeira execução para todos os recursos.

### Antes de implementar

1. Inspecione o repositório e leia AGENTS.md/instruções aplicáveis. Preserve trabalho existente. Não apague ou reescreva o projeto sem necessidade.
2. Se não houver projeto, inicialize um app React Native/Expo com TypeScript e uma organização simples para contratos compartilhados, backend/worker, migrations e docs.
3. Verifique na documentação oficial vigente as versões compatíveis do Expo, dependências nativas e Supabase. Fixe versões e lockfile; não use números de versão deste prompt como verdade atual.
4. Registre as decisões práticas em docs/architecture.md e uma checklist em docs/build-status.md. Não altere o escopo do produto por conveniência técnica.
5. Faça cedo um spike de recebimento de imagens/texto por Compartilhar em iOS e Android. Inspecione os riscos de lifecycle, múltiplos arquivos, App Groups quando necessários e persistência antes de a extensão encerrar. Não apresente compartilhar para fora do app como receber compartilhamentos. Não aceite Expo Go como prova da integração nativa.
6. Se faltar Xcode, signing, aparelho ou conta de build, implemente o que for verificável no ambiente, registre a limitação e continue com importação pela galeria. Não diga que a captura nativa foi testada sem build/dispositivo. Não substitua o app por um site.

### Implementação

- Interface e mensagens em português, textos centralizados. Biblioteca, Caixa de entrada, captura, página e visualização da fonte são prioritárias.
- Conta pessoal por e-mail/senha com sessão persistente e recuperação. Provedores sociais e cobrança ficam fora desta execução.
- Supabase Auth, Postgres, bucket privado e políticas RLS. Crie migrations versionadas e configuração local reproduzível. Nunca coloque chave administrativa ou chave de IA no app.
- Crie os schemas compartilhados de fonte, extração, página, bloco, evidência e estados. Use validação de entrada/saída, incluindo a saída da IA.
- Preserve cada fonte, mesmo em lote. Só trate várias imagens como um documento quando o usuário indicar isso. Um lote por si só não autoriza consolidar conteúdo.
- Fila local durável para upload; fila no servidor com lease, retries limitados, backoff e idempotência. Finalize uploads apenas após verificar a existência/propriedade do arquivo. Use constraints/transações para impedir efeitos duplicados.
- Implemente um adaptador de IA com extração visual/textual e estruturação. Separe transcrição, síntese e anotação do usuário. Registre modelo e versão do pipeline.
- IDs de evidência precisam corresponder a segmentos reais. Não invente URL, autor, data ou conteúdo ilegível. Imagem insuficiente deve produzir um estado de revisão, não um resumo plausível.
- Fonte original e extração devem ser navegáveis. Se não houver bbox confiável, mostrar imagem e segmento de texto; não fabricar localização visual.
- Edições criam versões. Reprocessar gera proposta e exige aceite; nunca sobrescreva texto manual. Configure controle de concorrência usando a versão base.
- Conteúdo capturado é dado não confiável; instruções encontradas nas fontes não são comandos do sistema.
- Prepare os contratos de busca/embeddings e perguntas para a etapa seguinte, mas não crie respostas genéricas ou chat fictício para aparentar que estão concluídos.
- Adicione eventos operacionais mínimos sem conteúdo bruto em logs. Limites de tamanho/uso/custo devem ficar no servidor.

### Ambiente e dependências

Crie .env.example apenas com nomes e placeholders; documente quais variáveis são públicas e quais são secretas. Use um adaptador fake determinístico somente em desenvolvimento/teste, claramente identificado. Ele não é evidência de integração real.

Se não houver credenciais do provedor de IA ou Supabase, conclua a estrutura, ambiente local, testes e telas independentes dessas credenciais. Liste exatamente o que falta para executar o fluxo real. Não invente chaves, não imprima segredos e não marque a etapa real como pronta.

Não provisionar recursos pagos, publicar nas lojas, implantar em produção ou executar migrations destrutivas em banco existente nesta execução. Prepare artefatos e instruções para os passos externos necessários.

### Validação obrigatória da primeira execução

1. Uma imagem legível gera uma página estruturada com fonte acessível.
2. Uma imagem ilegível preserva o original e pede revisão.
3. Retry de upload/finalize/processamento não cria páginas extras.
4. Fechar/reabrir o app preserva capturas locais pendentes.
5. Uma edição manual sobrevive ao reprocessamento.
6. Duas contas não acessam o conteúdo uma da outra; teste banco e Storage.
7. Teste exclusão lógica contra tarefas em andamento para impedir ressurgimento de conteúdo.
8. Valide schemas e referências. Registre separadamente testes automatizados, inspeção manual e testes nativos que o ambiente não permitiu executar.

Use testes para essas propriedades de dados e integração; não gaste a primeira execução construindo uma suíte que apenas replica componentes visuais.

### Entrega ao encerrar

Entregue código executável, migrations, .env.example, instruções para app/backend/worker, checklist de funcionalidades e testes, decisões registradas e próximos passos. Informe o que funciona com provider real, o que usa fixture, o que foi testado em aparelho e o que permanece bloqueado por ambiente ou credenciais.

Comece a trabalhar agora. Faça decisões reversíveis autonomamente dentro deste escopo. Se encontrar uma dúvida que não impede o fluxo vertical, registre a hipótese e continue. Preserve este núcleo: **capturar algo real → transformar em página útil → conferir a fonte → editar com segurança**.

---

## 13. Referências técnicas para a implementação

Consultadas em 2 de outubro de 2026. Apoiam a viabilidade e os requisitos técnicos; o escopo e o desenho do produto são propostas deste documento.

- Expo, [código nativo e development builds](https://docs.expo.dev/workflow/customizing/).
- Expo, [extensões iOS](https://docs.expo.dev/build-reference/app-extensions/).
- Expo, [compartilhamento e recebimento de conteúdo](https://docs.expo.dev/versions/latest/sdk/sharing/). Avaliar as limitações da implementação vigente antes de adotá-la.
- Supabase, [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Supabase, [controle de acesso no Storage](https://supabase.com/docs/guides/storage/security/access-control).
- Supabase, [recuperação com permissões](https://supabase.com/docs/guides/ai/rag-with-permissions).

Os detalhes de pacotes, modelos de IA, região de hospedagem, termos de processamento e builds assinados deverão ser confirmados no ambiente de implementação. Não há dependência de um modelo comercial específico para a definição do produto.
