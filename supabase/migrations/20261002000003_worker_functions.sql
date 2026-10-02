-- Funções do worker (service_role). Cada operação revalida lease, dono e exclusão lógica.
-- Retornam jsonb {status: ...}; 'lease_lost' e 'cancelled' significam: abortar sem efeitos.

-- Revalida o job; devolve a linha do job se ainda é válido para este worker, senão registra o motivo.
create function klypo_private.job_guard(p_job uuid, p_token uuid, out j public.jobs, out verdict text)
language plpgsql security definer set search_path = '' as
$$
declare s public.sources;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.status <> 'running' or j.lease_token is distinct from p_token or j.lease_until < now() then
    verdict := 'lease_lost'; return;
  end if;
  select * into s from public.sources where id = j.source_id for update;
  if j.kind = 'process_source' and (not found or s.deleted_at is not null) then
    update public.jobs set status = 'cancelled', finished_at = now(), lease_token = null where id = j.id;
    verdict := 'cancelled'; return;
  end if;
  verdict := 'ok';
end $$;

create function public.claim_job(p_worker text, p_lease_seconds int default 120) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  j public.jobs; s public.sources; v_started int; v_limit bigint := klypo_private.cfg_int('ai_daily_job_limit');
begin
  loop
    select * into j from public.jobs
     where (status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now())
     order by available_at limit 1 for update skip locked;
    if not found then return null; end if;

    if j.attempts >= j.max_attempts then
      update public.jobs set status = 'failed', finished_at = now(), lease_token = null,
             last_error_code = coalesce(last_error_code, 'unknown') where id = j.id;
      if j.kind = 'process_source' then
        update public.sources set state = 'failed', error_code = coalesce(j.last_error_code, 'unknown'), updated_at = now()
         where id = j.source_id and deleted_at is null
           and not exists (select 1 from public.page_source_links l join public.knowledge_pages p on p.id = l.page_id
                           where l.source_id = j.source_id and p.deleted_at is null);
      end if;
      continue;
    end if;

    select * into s from public.sources where id = j.source_id;
    if j.kind = 'process_source' and s.deleted_at is not null then
      update public.jobs set status = 'cancelled', finished_at = now(), lease_token = null where id = j.id;
      continue;
    end if;

    -- orçamento de IA por conta: sem limite disponível, a captura é preservada e o job adiado
    if j.kind = 'process_source' and j.started_at is null then
      select count(*) into v_started from public.jobs
       where owner_id = j.owner_id and kind = 'process_source' and started_at >= date_trunc('day', now());
      if v_started >= v_limit then
        update public.jobs set available_at = date_trunc('day', now()) + interval '1 day', last_error_code = 'quota_exceeded' where id = j.id;
        continue;
      end if;
    end if;

    update public.jobs
       set status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(), started_at = coalesce(started_at, now()), stage = 'extracting'
     where id = j.id returning * into j;
    return to_jsonb(j);
  end loop;
end $$;

create function public.worker_heartbeat(p_job uuid, p_token uuid, p_lease_seconds int default 120) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict = 'ok' then
    update public.jobs set lease_until = now() + make_interval(secs => p_lease_seconds) where id = p_job;
  end if;
  return jsonb_build_object('status', g.verdict);
end $$;

create function public.worker_set_stage(p_job uuid, p_token uuid, p_stage text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record;
begin
  if p_stage not in ('extracting', 'structuring', 'indexing') then raise exception 'invalid_stage' using errcode = 'KL050'; end if;
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict = 'ok' then
    update public.jobs set stage = p_stage where id = p_job;
    -- só mexe no estado da fonte quando ela ainda não tem página (reprocessamento não rebaixa uma página pronta)
    update public.sources set state = p_stage, updated_at = now()
     where id = (g.j).source_id
       and not exists (select 1 from public.page_source_links l join public.knowledge_pages p on p.id = l.page_id
                       where l.source_id = (g.j).source_id and p.deleted_at is null);
  end if;
  return jsonb_build_object('status', g.verdict);
end $$;

create function public.worker_get_source(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record; s public.sources;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  select * into s from public.sources where id = (g.j).source_id;
  return jsonb_build_object('status', 'ok', 'source', jsonb_build_object(
    'id', s.id, 'owner_id', s.owner_id, 'kind', s.kind, 'object_path', s.object_path,
    'text', s.text_original, 'mime', s.mime, 'size_bytes', s.size_bytes, 'note', s.note,
    'request_key', (g.j).request_key));
end $$;

create function public.worker_set_file_info(p_job uuid, p_token uuid, p_hash text, p_mime text, p_size bigint) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict = 'ok' then
    update public.sources set content_hash = p_hash, mime = coalesce(p_mime, mime), size_bytes = coalesce(p_size, size_bytes), updated_at = now()
     where id = (g.j).source_id;
  end if;
  return jsonb_build_object('status', g.verdict);
end $$;

-- Extração já gravada por este job (retry não repete a chamada de IA).
create function public.worker_get_job_extraction(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record; x public.source_extractions;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  select * into x from public.source_extractions where job_id = p_job;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', 'ok', 'extraction_id', x.id, 'legibility', x.legibility,
    'language', x.language, 'issues', x.issues,
    'segments', (select coalesce(jsonb_object_agg(g2.key, jsonb_build_object('id', g2.id, 'text', g2.text)), '{}')
                   from public.source_segments g2 where g2.extraction_id = x.id));
end $$;

create function public.worker_save_extraction(p_job uuid, p_token uuid, p_extraction jsonb, p_model text, p_pipeline text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  g record; x public.source_extractions; seg jsonb; n int := 0; v_ver int; v_text text;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  select * into x from public.source_extractions where job_id = p_job;
  if not found then
    select coalesce(max(version), 0) + 1 into v_ver from public.source_extractions where source_id = (g.j).source_id;
    select string_agg(e->>'text', E'\n\n' order by ord) into v_text from jsonb_array_elements(p_extraction->'segments') with ordinality t(e, ord);
    insert into public.source_extractions (owner_id, source_id, job_id, version, language, text, legibility, issues, explicit_metadata, pipeline_version, model)
    values ((g.j).owner_id, (g.j).source_id, p_job, v_ver, p_extraction->>'language', coalesce(v_text, ''), p_extraction->>'legibility',
            coalesce(p_extraction->'issues', '[]'), p_extraction->'explicitMetadata', p_pipeline, p_model)
    returning * into x;
    for seg in select * from jsonb_array_elements(p_extraction->'segments') loop
      n := n + 1;
      insert into public.source_segments (owner_id, extraction_id, key, position, text, bbox)
      values ((g.j).owner_id, x.id, seg->>'key', n, seg->>'text', seg->'bbox');
    end loop;
    -- trechos da fonte para busca futura (só enquanto a fonte existir)
    insert into public.search_chunks (owner_id, kind, source_id, ref_id, provenance, text)
    select owner_id, 'source_segment', (g.j).source_id, id::text, 'extracted', text from public.source_segments where extraction_id = x.id;
  end if;
  return jsonb_build_object('status', 'ok', 'extraction_id', x.id, 'legibility', x.legibility,
    'segments', (select coalesce(jsonb_object_agg(g2.key, g2.id), '{}') from public.source_segments g2 where g2.extraction_id = x.id));
end $$;

-- Imagem ilegível/insuficiente: preserva o original e pede revisão (sem página).
create function public.worker_finish_needs_review(p_job uuid, p_token uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  update public.sources set state = 'needs_review', review_reason = p_reason, error_code = null, updated_at = now()
   where id = (g.j).source_id
     and not exists (select 1 from public.page_source_links l join public.knowledge_pages p on p.id = l.page_id
                     where l.source_id = (g.j).source_id and p.deleted_at is null);
  update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null where id = p_job;
  return jsonb_build_object('status', 'needs_review');
end $$;

-- Cria a página (job automático) ou uma PROPOSTA (reprocessamento de página existente). Atômico e idempotente.
create function public.worker_persist_page(p_job uuid, p_token uuid, p_extraction uuid, p_page jsonb, p_model text, p_usage jsonb) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  g record; j public.jobs; s public.sources; live public.knowledge_pages; v_page uuid; v_key text; v public.page_versions;
  v_topics text[]; v_prop uuid; v_dead boolean; v_cur public.page_versions;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  j := g.j;
  select * into s from public.sources where id = j.source_id;
  if not exists (select 1 from public.source_extractions where id = p_extraction and source_id = s.id) then
    raise exception 'extraction_mismatch' using errcode = 'KL003'; end if;
  v_topics := coalesce(array(select jsonb_array_elements_text(p_page->'suggestedTopics')), '{}');

  select p.* into live from public.knowledge_pages p join public.page_source_links l on l.page_id = p.id
   where l.source_id = s.id and p.owner_id = s.owner_id and p.deleted_at is null and p.origin = 'single'
   order by p.created_at desc limit 1;

  if found then
    if j.request_key is null then
      -- retry/duplicata do job automático: já existe página; nenhum efeito extra
      update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null, usage = p_usage where id = p_job;
      return jsonb_build_object('status', 'noop', 'page_id', live.id);
    end if;
    -- reprocessamento: proposta (a versão ativa, inclusive edições manuais, permanece intacta)
    insert into public.page_proposals (owner_id, page_id, job_id, base_version_id, extraction_id, title, summary, blocks,
        language, translated, suggested_topics, pipeline_version, model)
    values (s.owner_id, live.id, p_job, live.active_version_id, p_extraction, p_page->>'title', coalesce(p_page->>'summary', ''), p_page->'blocks',
        p_page->>'language', coalesce((p_page->>'translatedFromSource')::boolean, false), v_topics, j.pipeline_version, p_model)
    on conflict (job_id) do nothing returning id into v_prop;
    perform klypo_private.validate_blocks(s.owner_id, live.id, p_page->'blocks', null);
    update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null, usage = p_usage where id = p_job;
    return jsonb_build_object('status', 'proposal', 'page_id', live.id, 'proposal_id', v_prop);
  end if;

  v_dead := exists (select 1 from public.knowledge_pages p join public.page_source_links l on l.page_id = p.id
                    where l.source_id = s.id and p.deleted_at is not null);
  if v_dead and j.request_key is null then
    -- a página foi excluída: tarefa automática nunca a ressuscita
    update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null, usage = p_usage where id = p_job;
    update public.sources set state = 'ready', updated_at = now() where id = s.id;
    return jsonb_build_object('status', 'noop_page_deleted');
  end if;

  v_key := case when j.request_key is null then 'source:' || s.id::text else 'source:' || s.id::text || ':' || j.request_key end;
  insert into public.knowledge_pages (owner_id, type, origin, generation_key)
  values (s.owner_id, p_page->>'type', 'single', v_key)
  on conflict (owner_id, generation_key) do nothing returning id into v_page;
  if v_page is null then
    select id into v_page from public.knowledge_pages where owner_id = s.owner_id and generation_key = v_key;
    update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null, usage = p_usage where id = p_job;
    return jsonb_build_object('status', 'noop', 'page_id', v_page);
  end if;

  insert into public.page_source_links (page_id, source_id, owner_id, position) values (v_page, s.id, s.owner_id, 0);
  v := klypo_private.write_version(v_page, s.owner_id, null, p_page->>'title', coalesce(p_page->>'summary', ''), p_page->'blocks', 'ai', '{}',
          p_page->>'language', coalesce((p_page->>'translatedFromSource')::boolean, false),
          coalesce((p_page->>'titleIsGenerated')::boolean, true), v_topics, j.pipeline_version, p_model);
  update public.sources set state = 'ready', review_reason = null, error_code = null, updated_at = now() where id = s.id;
  update public.jobs set status = 'succeeded', stage = null, finished_at = now(), lease_token = null, usage = p_usage where id = p_job;
  return jsonb_build_object('status', 'created', 'page_id', v_page, 'version_id', v.id);
end $$;

create function public.worker_fail_job(p_job uuid, p_token uuid, p_code text, p_retryable boolean) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  g record; j public.jobs; v_backoff bigint := klypo_private.cfg_int('job_backoff_seconds'); v_has_page boolean;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  j := g.j;
  v_has_page := exists (select 1 from public.page_source_links l join public.knowledge_pages p on p.id = l.page_id
                        where l.source_id = j.source_id and p.deleted_at is null);
  if p_retryable and j.attempts < j.max_attempts then
    update public.jobs set status = 'queued', lease_token = null, lease_until = null, last_error_code = p_code,
           available_at = now() + make_interval(secs => least(3600, v_backoff * power(2, j.attempts - 1)::bigint))
     where id = p_job;
    if j.kind = 'process_source' and not v_has_page then
      update public.sources set state = 'queued', updated_at = now() where id = j.source_id;
    end if;
    return jsonb_build_object('status', 'retry_scheduled');
  end if;
  update public.jobs set status = 'failed', finished_at = now(), lease_token = null, last_error_code = p_code where id = p_job;
  if j.kind = 'process_source' and not v_has_page then
    update public.sources set state = 'failed', error_code = p_code, updated_at = now() where id = j.source_id and deleted_at is null;
  end if;
  return jsonb_build_object('status', 'failed');
end $$;

-- Limpeza física de fonte excluída (o worker remove o arquivo do Storage antes de chamar).
create function public.worker_get_purge_target(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record; s public.sources;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  select * into s from public.sources where id = (g.j).source_id;
  if s.deleted_at is null then raise exception 'purge_of_live_source' using errcode = 'KL060'; end if;
  return jsonb_build_object('status', 'ok', 'object_path', s.owner_id::text || '/' || s.id::text, 'kind', s.kind);
end $$;

create function public.worker_complete_purge(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare g record; s public.sources;
begin
  select * into g from klypo_private.job_guard(p_job, p_token);
  if g.verdict <> 'ok' then return jsonb_build_object('status', g.verdict); end if;
  select * into s from public.sources where id = (g.j).source_id;
  if s.deleted_at is null then raise exception 'purge_of_live_source' using errcode = 'KL060'; end if;
  delete from public.source_extractions where source_id = s.id;     -- segmentos e block_evidence caem em cascata
  delete from public.search_chunks where source_id = s.id;
  update public.sources set text_original = null, object_path = null, note = null, content_hash = null, updated_at = now() where id = s.id;
  update public.jobs set status = 'succeeded', finished_at = now(), lease_token = null where id = p_job;
  return jsonb_build_object('status', 'ok');
end $$;

create function public.worker_record_event(p_owner uuid, p_name text, p_entity uuid, p_props jsonb) returns void
language sql security definer set search_path = '' as
$$ select klypo_private.emit_event(p_owner, p_name, p_entity, p_props) $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_job(text,int)', 'public.worker_heartbeat(uuid,uuid,int)', 'public.worker_set_stage(uuid,uuid,text)',
    'public.worker_get_source(uuid,uuid)', 'public.worker_set_file_info(uuid,uuid,text,text,bigint)',
    'public.worker_get_job_extraction(uuid,uuid)', 'public.worker_save_extraction(uuid,uuid,jsonb,text,text)',
    'public.worker_finish_needs_review(uuid,uuid,text)', 'public.worker_persist_page(uuid,uuid,uuid,jsonb,text,jsonb)',
    'public.worker_fail_job(uuid,uuid,text,boolean)', 'public.worker_get_purge_target(uuid,uuid)',
    'public.worker_complete_purge(uuid,uuid)', 'public.worker_record_event(uuid,text,uuid,jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
