-- Funções chamadas pelo app (autenticado). Todas: SECURITY DEFINER, search_path vazio,
-- dono derivado de auth.uid(). Nenhuma confia em owner_id vindo do cliente.

create function klypo_private.require_uid() returns uuid
language plpgsql stable security definer set search_path = '' as
$$ declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- validação de blocos
-- Espelha o schema Zod compartilhado (packages/shared/src/blocks.ts) como última barreira no banco.
create function klypo_private.validate_blocks(p_owner uuid, p_page uuid, p_blocks jsonb, p_base_version uuid)
returns void language plpgsql stable security definer set search_path = '' as
$$
declare
  b jsonb; ids text[] := '{}'; v_id text; v_type text; v_origin text; ev text; n int := 0;
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'invalid_blocks: esperado array' using errcode = 'KL010';
  end if;
  if jsonb_array_length(p_blocks) > 200 or octet_length(p_blocks::text) > 1000000 then
    raise exception 'invalid_blocks: tamanho excedido' using errcode = 'KL010';
  end if;

  for b in select * from jsonb_array_elements(p_blocks) loop
    n := n + 1;
    if jsonb_typeof(b) <> 'object' then raise exception 'invalid_blocks: bloco % não é objeto', n using errcode = 'KL010'; end if;
    v_id := b->>'id'; v_type := b->>'type'; v_origin := b->>'origin';
    if v_id is null or length(v_id) = 0 or length(v_id) > 64 then raise exception 'invalid_blocks: id inválido (bloco %)', n using errcode = 'KL010'; end if;
    if v_id = any(ids) then raise exception 'invalid_blocks: id duplicado %', v_id using errcode = 'KL010'; end if;
    ids := ids || v_id;
    if v_type not in ('paragraph', 'list', 'steps', 'table', 'callout') then raise exception 'invalid_blocks: tipo inválido (bloco %)', n using errcode = 'KL010'; end if;
    if v_origin not in ('extracted', 'synthesis', 'user') then raise exception 'invalid_blocks: origem inválida (bloco %)', n using errcode = 'KL010'; end if;
    if jsonb_typeof(b->'evidence') is distinct from 'array' then raise exception 'invalid_blocks: evidence ausente (bloco %)', n using errcode = 'KL010'; end if;

    if v_type in ('paragraph', 'callout') then
      if jsonb_typeof(b->'text') is distinct from 'string' or length(btrim(b->>'text')) = 0 then
        raise exception 'invalid_blocks: texto vazio (bloco %)', n using errcode = 'KL010'; end if;
    elsif v_type in ('list', 'steps') then
      if jsonb_typeof(b->'items') is distinct from 'array' or jsonb_array_length(b->'items') = 0 then
        raise exception 'invalid_blocks: itens vazios (bloco %)', n using errcode = 'KL010'; end if;
    else
      if jsonb_typeof(b->'header') is distinct from 'array' or jsonb_typeof(b->'rows') is distinct from 'array' then
        raise exception 'invalid_blocks: tabela inválida (bloco %)', n using errcode = 'KL010'; end if;
    end if;

    -- "Sua anotação" nunca carrega atribuição à fonte; conteúdo extraído exige evidência.
    if v_origin = 'user' and jsonb_array_length(b->'evidence') > 0 then
      raise exception 'invalid_blocks: bloco manual com evidência (bloco %)', n using errcode = 'KL010'; end if;
    if v_origin = 'extracted' and jsonb_array_length(b->'evidence') = 0 then
      raise exception 'invalid_blocks: bloco extraído sem evidência (bloco %)', n using errcode = 'KL010'; end if;

    for ev in select jsonb_array_elements_text(b->'evidence') loop
      if ev !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_blocks: evidência não é uuid (bloco %)', n using errcode = 'KL010'; end if;
      -- evidência válida = segmento vivo de fonte vinculada à página, ou já citada pela versão-base
      -- (permite editar páginas cujas fontes foram removidas sem reescrever a atribuição antiga).
      if not exists (
            select 1 from public.source_segments g
            join public.source_extractions x on x.id = g.extraction_id
            join public.page_source_links l on l.source_id = x.source_id and l.page_id = p_page
            join public.sources s on s.id = x.source_id
            where g.id = ev::uuid and g.owner_id = p_owner and s.deleted_at is null)
         and not (p_base_version is not null and exists (
            select 1 from public.page_versions v, jsonb_array_elements(v.blocks) bb, jsonb_array_elements_text(bb->'evidence') e2
            where v.id = p_base_version and v.owner_id = p_owner and e2 = ev)) then
        raise exception 'invalid_blocks: evidência inexistente ou de outra fonte (bloco %)', n using errcode = 'KL010';
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- escrita de versão (interna)
create function klypo_private.reindex_page(p_page uuid) returns void
language plpgsql security definer set search_path = '' as
$$
declare v public.page_versions; pg public.knowledge_pages;
begin
  select * into pg from public.knowledge_pages where id = p_page;
  delete from public.search_chunks where page_id = p_page and kind in ('page_block', 'page_meta');
  if pg.deleted_at is not null or pg.active_version_id is null then return; end if;
  select * into v from public.page_versions where id = pg.active_version_id;
  insert into public.search_chunks (owner_id, kind, page_id, ref_id, provenance, text)
  values (pg.owner_id, 'page_meta', p_page, 'meta',
          case when v.manual_fields <> '{}' then 'user' else 'synthesis' end,
          btrim(v.title || E'\n' || v.summary));
  insert into public.search_chunks (owner_id, kind, page_id, ref_id, provenance, text)
  select pg.owner_id, 'page_block', p_page, b->>'id', b->>'origin',
         case b->>'type'
           when 'list' then (select string_agg(i, E'\n') from jsonb_array_elements_text(b->'items') i)
           when 'steps' then (select string_agg(i, E'\n') from jsonb_array_elements_text(b->'items') i)
           when 'table' then (b->'header')::text || E'\n' || (b->'rows')::text
           else b->>'text' end
  from jsonb_array_elements(v.blocks) b;
end $$;

create function klypo_private.write_version(
  p_page uuid, p_owner uuid, p_base uuid, p_title text, p_summary text, p_blocks jsonb,
  p_created_by text, p_manual_fields text[], p_language text, p_translated boolean,
  p_title_generated boolean, p_topics text[], p_pipeline text, p_model text
) returns public.page_versions
language plpgsql security definer set search_path = '' as
$$
declare v public.page_versions; n int; b jsonb; ev text; seg uuid;
begin
  perform klypo_private.validate_blocks(p_owner, p_page, p_blocks, p_base);
  select coalesce(max(version_no), 0) + 1 into n from public.page_versions where page_id = p_page;
  insert into public.page_versions (owner_id, page_id, version_no, title, summary, blocks, language, translated,
      title_is_generated, suggested_topics, created_by, base_version_id, manual_fields, pipeline_version, model)
  values (p_owner, p_page, n, p_title, p_summary, p_blocks, p_language, coalesce(p_translated, false),
      coalesce(p_title_generated, true), coalesce(p_topics, '{}'), p_created_by, p_base, coalesce(p_manual_fields, '{}'),
      p_pipeline, p_model)
  returning * into v;

  -- block_evidence: apenas ligações para segmentos vivos (referências antigas ficam só no JSON)
  for b in select * from jsonb_array_elements(p_blocks) loop
    for ev in select jsonb_array_elements_text(b->'evidence') loop
      select g.id into seg from public.source_segments g where g.id = ev::uuid and g.owner_id = p_owner;
      if seg is not null then
        insert into public.block_evidence (page_version_id, block_id, segment_id, owner_id)
        values (v.id, b->>'id', seg, p_owner) on conflict do nothing;
      end if;
    end loop;
  end loop;

  update public.knowledge_pages set active_version_id = v.id, updated_at = now() where id = p_page;
  perform klypo_private.reindex_page(p_page);
  return v;
end $$;

create function klypo_private.emit_event(p_owner uuid, p_name text, p_entity uuid, p_props jsonb) returns void
language sql security definer set search_path = '' as
$$ insert into public.usage_events (owner_id, name, entity_id, props) values (p_owner, p_name, p_entity, coalesce(p_props, '{}')) $$;

-- ---------------------------------------------------------------- aviso de IA
create function public.accept_ai_notice() returns void
language plpgsql security definer set search_path = '' as
$$ declare v uuid := klypo_private.require_uid();
begin
  insert into public.profiles (user_id, ai_notice_accepted_at) values (v, now())
  on conflict (user_id) do update set ai_notice_accepted_at = coalesce(public.profiles.ai_notice_accepted_at, now());
end $$;

-- ---------------------------------------------------------------- finalizar captura
-- Idempotente por id de fonte. Cada item é independente: falha de um não bloqueia os demais.
-- Só cria job depois de confirmar que o arquivo existe no Storage e pertence à conta.
create function public.finalize_capture(p_batch_id uuid, p_mode text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := klypo_private.require_uid();
  v_items jsonb := coalesce(p_items, '[]');
  it jsonb; v_id uuid; v_kind text; v_path text; v_text text; v_code text;
  v_mime text; v_size bigint; v_obj record; v_existing public.sources; v_results jsonb := '[]';
  v_max_bytes bigint := klypo_private.cfg_int('max_image_bytes');
  v_max_chars bigint := klypo_private.cfg_int('max_text_chars');
  v_max_images bigint := klypo_private.cfg_int('max_images_per_batch');
  v_quota bigint := klypo_private.cfg_int('daily_source_quota');
  v_pipeline text := klypo_private.cfg_text('pipeline_version');
  v_n_images int; v_today int; v_batch_owner uuid; v_notice timestamptz;
begin
  if jsonb_typeof(v_items) <> 'array' then raise exception 'invalid_request' using errcode = 'KL020'; end if;
  if p_mode not in ('separate', 'same_document') then raise exception 'invalid_request' using errcode = 'KL020'; end if;

  select count(*) into v_n_images from jsonb_array_elements(v_items) e where e->>'kind' = 'image';
  select ai_notice_accepted_at into v_notice from public.profiles where user_id = v_uid;

  -- rejeições globais (o material continua só no cliente; nada é perdido)
  v_code := case
    when v_notice is null then 'ai_notice_required'
    when p_mode = 'same_document' then 'mode_not_supported'   -- agrupar em documento: etapa 4
    when v_n_images > v_max_images then 'batch_too_large'
    else null end;
  if v_code is not null then
    return coalesce((select jsonb_agg(jsonb_build_object('id', e->>'id', 'status', 'rejected', 'error_code', v_code))
                     from jsonb_array_elements(v_items) e), '[]');
  end if;

  insert into public.capture_batches (id, owner_id, mode) values (p_batch_id, v_uid, p_mode) on conflict (id) do nothing;
  select owner_id into v_batch_owner from public.capture_batches where id = p_batch_id;
  if v_batch_owner <> v_uid then raise exception 'forbidden' using errcode = '42501'; end if;

  select count(*) into v_today from public.sources where owner_id = v_uid and created_at >= date_trunc('day', now());

  for it in select * from jsonb_array_elements(v_items) loop
    v_code := null;
    begin
      v_id := (it->>'id')::uuid;
      v_kind := it->>'kind';

      select * into v_existing from public.sources where id = v_id;
      if found then
        if v_existing.owner_id <> v_uid then v_code := 'unknown';          -- não revela existência
        elsif v_existing.deleted_at is not null then v_code := 'source_deleted'; -- nunca ressuscitar
        end if;
      end if;

      if v_code is null and not found then
        if v_today >= v_quota then
          v_code := 'quota_exceeded';
        elsif v_kind = 'image' then
          v_path := v_uid::text || '/' || v_id::text;
          select o.metadata into v_obj from storage.objects o
            where o.bucket_id = 'captures' and o.name = v_path and o.owner_id = v_uid::text;
          if not found then
            v_code := 'file_missing';
          else
            v_size := nullif(v_obj.metadata->>'size', '')::bigint;
            v_mime := v_obj.metadata->>'mimetype';
            if v_size is null or v_size > v_max_bytes then v_code := 'file_too_large';
            elsif v_mime is null or not (klypo_private.cfg_text('allowed_mimes')::jsonb ? v_mime) then v_code := 'unsupported_mime';
            else
              insert into public.sources (id, owner_id, batch_id, kind, object_path, mime, size_bytes, position, note)
              values (v_id, v_uid, p_batch_id, 'image', v_path, v_mime, v_size, coalesce((it->>'position')::int, 0), nullif(it->>'note', ''));
            end if;
          end if;
        elsif v_kind = 'text' then
          v_text := it->>'text';
          if v_text is null or length(btrim(v_text)) = 0 then v_code := 'empty_text';
          elsif length(v_text) > v_max_chars then v_code := 'text_too_long';
          else
            insert into public.sources (id, owner_id, batch_id, kind, text_original, size_bytes, position, note)
            values (v_id, v_uid, p_batch_id, 'text', v_text, octet_length(v_text), coalesce((it->>'position')::int, 0), nullif(it->>'note', ''));
          end if;
        else
          v_code := 'unknown';
        end if;
        if v_code is null then v_today := v_today + 1; end if;
      end if;

      if v_code is null then
        -- retry/duplicata cai no mesmo dedupe_key: mesmo job, nenhum efeito extra
        insert into public.jobs (owner_id, kind, source_id, dedupe_key, pipeline_version, max_attempts)
        values (v_uid, 'process_source', v_id, 'process:' || v_id::text || ':' || v_pipeline, v_pipeline, klypo_private.cfg_int('job_max_attempts'))
        on conflict (dedupe_key) do nothing;
        if found then perform klypo_private.emit_event(v_uid, 'upload_completed', v_id, jsonb_build_object('kind', v_kind)); end if;
      end if;
    exception when others then
      v_code := 'unknown';
    end;

    v_results := v_results || jsonb_build_object(
      'id', it->>'id', 'status', case when v_code is null then 'accepted' else 'rejected' end, 'error_code', v_code);
  end loop;
  return v_results;
end $$;

-- ---------------------------------------------------------------- reprocessar / tentar novamente
create function public.request_processing(p_source_id uuid, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_uid uuid := klypo_private.require_uid(); s public.sources; v_has_page boolean; v_job uuid; v_pipeline text := klypo_private.cfg_text('pipeline_version');
begin
  select * into s from public.sources where id = p_source_id and owner_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.jobs where source_id = s.id and kind = 'process_source' and status in ('queued', 'running')) then
    return jsonb_build_object('status', 'already_running');
  end if;
  v_has_page := exists (select 1 from public.knowledge_pages p join public.page_source_links l on l.page_id = p.id
                        where l.source_id = s.id and p.deleted_at is null);
  insert into public.jobs (owner_id, kind, source_id, request_key, dedupe_key, pipeline_version, max_attempts)
  values (v_uid, 'process_source', s.id, p_request_key::text, 'req:' || s.id::text || ':' || p_request_key::text, v_pipeline, klypo_private.cfg_int('job_max_attempts'))
  on conflict (dedupe_key) do nothing returning id into v_job;
  if v_job is not null and not v_has_page then
    update public.sources set state = 'queued', review_reason = null, error_code = null, updated_at = now() where id = s.id;
  end if;
  return jsonb_build_object('status', 'requested', 'mode', case when v_has_page then 'proposal' else 'create' end);
end $$;

-- ---------------------------------------------------------------- editar (versões com controle de concorrência)
create function public.save_page_version(p_page_id uuid, p_base_version_id uuid, p_title text, p_summary text, p_blocks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := klypo_private.require_uid(); pg public.knowledge_pages; cur public.page_versions; nv public.page_versions;
  v_manual text[];
begin
  if p_title is null or length(btrim(p_title)) = 0 or length(p_title) > 200 then raise exception 'invalid_title' using errcode = 'KL010'; end if;
  if length(coalesce(p_summary, '')) > 1500 then raise exception 'invalid_summary' using errcode = 'KL010'; end if;
  select * into pg from public.knowledge_pages where id = p_page_id and owner_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into cur from public.page_versions where id = pg.active_version_id;

  -- retry do mesmo salvamento já aplicado: devolve a versão ativa sem criar outra
  if cur.title = btrim(p_title) and cur.summary = btrim(coalesce(p_summary, '')) and cur.blocks = p_blocks then
    return jsonb_build_object('status', 'saved', 'version_id', cur.id, 'version_no', cur.version_no);
  end if;
  if pg.active_version_id <> p_base_version_id then
    return jsonb_build_object('status', 'conflict', 'active_version_id', pg.active_version_id);
  end if;

  -- campos alterados à mão ficam marcados no servidor (o cliente não pode forjar nem apagar a marca)
  v_manual := cur.manual_fields;
  if cur.title <> btrim(p_title) and not ('title' = any(v_manual)) then v_manual := array_append(v_manual, 'title'::text); end if;
  if cur.summary <> btrim(coalesce(p_summary, '')) and not ('summary' = any(v_manual)) then v_manual := array_append(v_manual, 'summary'::text); end if;

  nv := klypo_private.write_version(pg.id, v_uid, cur.id, btrim(p_title), btrim(coalesce(p_summary, '')), p_blocks, 'user',
          v_manual, cur.language, cur.translated, cur.title_is_generated and not ('title' = any(v_manual)), cur.suggested_topics, null, null);
  perform klypo_private.emit_event(v_uid, 'page_edited', pg.id, jsonb_build_object('version_no', nv.version_no));
  return jsonb_build_object('status', 'saved', 'version_id', nv.id, 'version_no', nv.version_no);
end $$;

-- ---------------------------------------------------------------- propostas de reprocessamento
create function public.accept_proposal(p_proposal_id uuid, p_base_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := klypo_private.require_uid(); pr public.page_proposals; pg public.knowledge_pages; cur public.page_versions;
  nv public.page_versions; v_title text; v_summary text; v_blocks jsonb; v_kept jsonb; v_manual text[];
begin
  select * into pr from public.page_proposals where id = p_proposal_id and owner_id = v_uid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into pg from public.knowledge_pages where id = pr.page_id and owner_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if pr.status <> 'pending' then raise exception 'proposal_not_pending' using errcode = 'KL030'; end if;
  if pg.active_version_id <> p_base_version_id then
    return jsonb_build_object('status', 'conflict', 'active_version_id', pg.active_version_id);
  end if;
  select * into cur from public.page_versions where id = pg.active_version_id;

  -- Nunca sobrescrever texto manual: título/resumo editados e todos os blocos "user" (e síntese) são preservados.
  v_manual := cur.manual_fields;
  v_title := case when 'title' = any(v_manual) then cur.title else pr.title end;
  v_summary := case when 'summary' = any(v_manual) then cur.summary else pr.summary end;
  select coalesce(jsonb_agg(b order by o), '[]') into v_kept
    from jsonb_array_elements(cur.blocks) with ordinality t(b, o) where b->>'origin' in ('user', 'synthesis');
  -- ids de blocos mantidos não podem colidir com os da proposta (ids novos são uuid; ids manuais, também do cliente)
  v_blocks := pr.blocks || v_kept;

  nv := klypo_private.write_version(pg.id, v_uid, cur.id, v_title, v_summary, v_blocks, 'proposal', v_manual,
          pr.language, pr.translated, cur.title_is_generated and not ('title' = any(v_manual)), pr.suggested_topics, pr.pipeline_version, pr.model);
  update public.page_proposals set status = 'accepted', resolved_at = now() where id = pr.id;
  update public.page_proposals set status = 'rejected', resolved_at = now() where page_id = pg.id and status = 'pending' and id <> pr.id;
  return jsonb_build_object('status', 'accepted', 'version_id', nv.id);
end $$;

create function public.reject_proposal(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_uid uuid := klypo_private.require_uid();
begin
  update public.page_proposals set status = 'rejected', resolved_at = now()
   where id = p_proposal_id and owner_id = v_uid and status = 'pending';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------- exclusão lógica
create function klypo_private.delete_source_internal(p_owner uuid, p_source uuid) returns void
language plpgsql security definer set search_path = '' as
$$
declare s public.sources;
begin
  select * into s from public.sources where id = p_source and owner_id = p_owner for update;
  if not found or s.deleted_at is not null then return; end if;
  update public.sources set state = 'deleted', deleted_at = now(), updated_at = now() where id = s.id;
  -- tarefas em andamento deixam de ter efeito (o worker revalida a cada operação)
  update public.jobs set status = 'cancelled', finished_at = now(), lease_token = null
   where source_id = s.id and kind = 'process_source' and status in ('queued', 'running');
  update public.page_proposals set status = 'rejected', resolved_at = now()
   where status = 'pending' and page_id in (select page_id from public.page_source_links where source_id = s.id);
  -- sai da busca/perguntas imediatamente
  delete from public.search_chunks where source_id = s.id;
  delete from public.search_chunks
   where page_id in (select page_id from public.page_source_links where source_id = s.id) and provenance <> 'user';
  -- limpeza física (arquivo, extrações, vetores) por tarefa rastreada
  insert into public.jobs (owner_id, kind, source_id, dedupe_key, max_attempts)
  values (p_owner, 'purge_source', s.id, 'purge:' || s.id::text, klypo_private.cfg_int('job_max_attempts'))
  on conflict (dedupe_key) do nothing;
  perform klypo_private.emit_event(p_owner, 'capture_deleted', s.id, '{}');
end $$;

create function public.delete_source(p_source_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_uid uuid := klypo_private.require_uid();
begin
  if not exists (select 1 from public.sources where id = p_source_id and owner_id = v_uid) then
    raise exception 'not_found' using errcode = 'P0002'; end if;
  perform klypo_private.delete_source_internal(v_uid, p_source_id);
end $$;

-- Excluir página: as fontes permanecem, salvo seleção explícita.
create function public.delete_page(p_page_id uuid, p_delete_sources boolean default false) returns void
language plpgsql security definer set search_path = '' as
$$
declare v_uid uuid := klypo_private.require_uid(); v_src uuid;
begin
  update public.knowledge_pages set deleted_at = now(), updated_at = now()
   where id = p_page_id and owner_id = v_uid and deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.page_proposals set status = 'rejected', resolved_at = now() where page_id = p_page_id and status = 'pending';
  delete from public.search_chunks where page_id = p_page_id and kind in ('page_block', 'page_meta');
  -- tarefas em andamento sobre as fontes desta página não podem recriá-la
  update public.jobs set status = 'cancelled', finished_at = now(), lease_token = null
   where kind = 'process_source' and status in ('queued', 'running')
     and source_id in (select source_id from public.page_source_links where page_id = p_page_id);
  if p_delete_sources then
    for v_src in select source_id from public.page_source_links where page_id = p_page_id loop
      perform klypo_private.delete_source_internal(v_uid, v_src);
    end loop;
  end if;
  perform klypo_private.emit_event(v_uid, 'capture_deleted', p_page_id, jsonb_build_object('entity', 'page'));
end $$;

-- ---------------------------------------------------------------- eventos do cliente (lista permitida, sem conteúdo)
create function public.record_event(p_name text, p_entity uuid default null, p_props jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as
$$ declare v_uid uuid := klypo_private.require_uid();
begin
  if p_name not in ('capture_saved_local', 'page_opened', 'source_opened') then raise exception 'event_not_allowed' using errcode = 'KL040'; end if;
  if octet_length(coalesce(p_props, '{}')::text) > 500 then raise exception 'props_too_large' using errcode = 'KL040'; end if;
  perform klypo_private.emit_event(v_uid, p_name, p_entity, p_props);
end $$;

-- ---------------------------------------------------------------- permissões
do $$
declare f text;
begin
  foreach f in array array[
    'public.accept_ai_notice()', 'public.finalize_capture(uuid,text,jsonb)', 'public.request_processing(uuid,uuid)',
    'public.save_page_version(uuid,uuid,text,text,jsonb)', 'public.accept_proposal(uuid,uuid)', 'public.reject_proposal(uuid)',
    'public.delete_source(uuid)', 'public.delete_page(uuid,boolean)', 'public.record_event(text,uuid,jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
