# Eventos operacionais

Armazenados em `usage_events` (nome + `entity_id` + contadores/códigos). **Nunca** texto bruto, imagens, perguntas ou respostas. O cliente só pode emitir `capture_saved_local`, `page_opened`, `source_opened` (lista permitida em `record_event`); o resto é emitido pelo servidor.

| Evento | Origem | Propriedades |
|---|---|---|
| capture_saved_local | app | — |
| upload_completed | servidor (`finalize_capture`) | kind |
| processing_completed | worker | duration_ms, input_tokens, output_tokens, model, outcome |
| processing_failed | worker | code, attempts |
| page_opened / source_opened | app | — |
| page_edited | servidor (`save_page_version`) | version_no |
| capture_deleted | servidor | entity |

Reservados para etapas seguintes (não emitidos): search_submitted, search_result_opened, ask_submitted, answer_completed, citation_opened, feedback_submitted, merge_confirmed.
Logs do worker (stdout, JSON): apenas chaves da lista permitida em `services/worker/src/log.ts`.
