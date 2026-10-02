-- Klypo — fundação: tabelas, constraints e RLS.
-- Regra geral: o cliente (anon/authenticated) só LÊ tabelas (RLS). Toda escrita passa por funções
-- SECURITY DEFINER (migration 0002/0003) que derivam o dono de auth.uid(), nunca de dados do cliente.

create extension if not exists pgcrypto;

create schema if not exists klypo_private;
revoke all on schema klypo_private from public;

-- ---------------------------------------------------------------- configuração do servidor
create table public.server_config (
  key text primary key,
  value jsonb not null
);
alter table public.server_config enable row level security; -- sem policies: só funções/serviço leem
revoke all on public.server_config from public, anon, authenticated;

insert into public.server_config (key, value) values
  ('max_images_per_batch', '10'),
  ('max_image_bytes', '15728640'),
  ('max_text_chars', '20000'),
  ('allowed_mimes', '["image/jpeg","image/png"]'),
  ('daily_source_quota', '200'),
  ('ai_daily_job_limit', '100'),
  ('job_max_attempts', '4'),
  ('job_backoff_seconds', '30'),
  ('pipeline_version', '"p1"');

create function klypo_private.cfg_int(p_key text) returns bigint
language sql stable security definer set search_path = '' as
$$ select (value #>> '{}')::bigint from public.server_config where key = p_key $$;

create function klypo_private.cfg_text(p_key text) returns text
language sql stable security definer set search_path = '' as
$$ select value #>> '{}' from public.server_config where key = p_key $$;

-- ---------------------------------------------------------------- perfis
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'pt-BR',
  ai_notice_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create function klypo_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function klypo_private.handle_new_user();
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- ---------------------------------------------------------------- capturas
create table public.capture_batches (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('separate', 'same_document')),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.sources (
  id uuid primary key,                      -- gerado no cliente: chave de idempotência
  owner_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null,
  kind text not null check (kind in ('image', 'text')),
  object_path text,
  text_original text,
  mime text,
  size_bytes bigint,
  content_hash text,
  position int not null default 0,
  note text,
  state text not null default 'queued'
    check (state in ('queued','extracting','structuring','indexing','ready','needs_review','failed','deleted')),
  review_reason text check (review_reason in ('illegible', 'insufficient_content')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, owner_id),
  foreign key (batch_id, owner_id) references public.capture_batches (id, owner_id),
  check ((state = 'deleted') = (deleted_at is not null)),
  -- o caminho é derivado por construção: nenhum arquivo é compartilhado entre fontes/contas
  check (deleted_at is not null
         or (kind = 'image' and object_path = owner_id::text || '/' || id::text and text_original is null)
         or (kind = 'text' and text_original is not null and object_path is null))
);
create index sources_owner_created_idx on public.sources (owner_id, created_at desc) where deleted_at is null;
create index sources_owner_hash_idx on public.sources (owner_id, content_hash) where content_hash is not null;

create table public.source_extractions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null,
  job_id uuid unique,                       -- idempotência: uma extração por job
  version int not null,
  language text,
  text text not null default '',
  legibility text not null check (legibility in ('legible', 'partial', 'illegible')),
  issues jsonb not null default '[]',
  explicit_metadata jsonb,
  pipeline_version text not null,
  model text not null,
  created_by text not null default 'ai' check (created_by in ('ai', 'user', 'system')),
  created_at timestamptz not null default now(),
  unique (source_id, version),
  unique (id, owner_id),
  foreign key (source_id, owner_id) references public.sources (id, owner_id) on delete cascade
);

create table public.source_segments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  extraction_id uuid not null,
  key text not null,
  position int not null,
  text text not null,
  bbox jsonb,                                -- só quando confiável; nunca fabricado
  unique (extraction_id, key),
  unique (extraction_id, position),
  unique (id, owner_id),
  foreign key (extraction_id, owner_id) references public.source_extractions (id, owner_id) on delete cascade
);

-- ---------------------------------------------------------------- páginas
create table public.knowledge_pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('reference', 'guide', 'recommendation', 'note')),
  origin text not null check (origin in ('single', 'document', 'synthesis')),
  generation_key text not null,
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, generation_key),         -- impede página duplicada por retry
  unique (id, owner_id)
);

create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null,
  version_no int not null,
  title text not null,
  summary text not null default '',
  blocks jsonb not null,
  language text,
  translated boolean not null default false,
  title_is_generated boolean not null default true,
  suggested_topics text[] not null default '{}',
  created_by text not null check (created_by in ('ai', 'user', 'proposal')),
  base_version_id uuid,
  manual_fields text[] not null default '{}' check (manual_fields <@ array['title', 'summary']),
  pipeline_version text,
  model text,
  created_at timestamptz not null default now(),
  unique (page_id, version_no),
  unique (id, page_id),
  unique (id, owner_id),
  foreign key (page_id, owner_id) references public.knowledge_pages (id, owner_id) on delete cascade
);

alter table public.knowledge_pages
  add constraint knowledge_pages_active_version_fk
  foreign key (active_version_id, id) references public.page_versions (id, page_id);

create table public.page_source_links (
  page_id uuid not null,
  source_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  position int not null default 0,
  primary key (page_id, source_id),
  foreign key (page_id, owner_id) references public.knowledge_pages (id, owner_id) on delete cascade,
  foreign key (source_id, owner_id) references public.sources (id, owner_id) on delete cascade
);

create table public.block_evidence (
  page_version_id uuid not null,
  block_id text not null,
  segment_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  primary key (page_version_id, block_id, segment_id),
  foreign key (page_version_id, owner_id) references public.page_versions (id, owner_id) on delete cascade,
  foreign key (segment_id, owner_id) references public.source_segments (id, owner_id) on delete cascade
);

create table public.page_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null,
  job_id uuid unique,                        -- idempotência: uma proposta por job
  base_version_id uuid not null,
  extraction_id uuid,
  title text not null,
  summary text not null default '',
  blocks jsonb not null,
  language text,
  translated boolean not null default false,
  suggested_topics text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  pipeline_version text,
  model text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (page_id, owner_id) references public.knowledge_pages (id, owner_id) on delete cascade
);
create index page_proposals_page_idx on public.page_proposals (page_id) where status = 'pending';

-- Trechos indexáveis. Nesta execução: apenas lexical (sem embedding). A coluna de embedding/dimensão
-- será fixada por migration própria na etapa 3 (pgvector), com reindexação rastreável.
create table public.search_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('source_segment', 'page_block', 'page_meta')),
  source_id uuid,
  page_id uuid,
  ref_id text not null,
  provenance text not null check (provenance in ('extracted', 'synthesis', 'user')),
  text text not null,
  created_at timestamptz not null default now(),
  foreign key (source_id, owner_id) references public.sources (id, owner_id) on delete cascade,
  foreign key (page_id, owner_id) references public.knowledge_pages (id, owner_id) on delete cascade
);
create index search_chunks_page_idx on public.search_chunks (owner_id, page_id);
create index search_chunks_source_idx on public.search_chunks (owner_id, source_id);

-- ---------------------------------------------------------------- fila no servidor
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('process_source', 'purge_source')),
  source_id uuid not null,
  request_key text,
  dedupe_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text,
  attempts int not null default 0,
  max_attempts int not null default 4,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text,
  pipeline_version text,
  usage jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (source_id, owner_id) references public.sources (id, owner_id) on delete cascade
);
create index jobs_claim_idx on public.jobs (available_at) where status in ('queued', 'running');
create index jobs_source_idx on public.jobs (source_id);

create table public.usage_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  entity_id uuid,
  props jsonb not null default '{}',          -- apenas contadores/códigos; nunca conteúdo bruto
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS (somente leitura para o cliente)
do $$
declare t text;
begin
  foreach t in array array['profiles','capture_batches','sources','source_extractions','source_segments',
    'knowledge_pages','page_versions','page_source_links','block_evidence','page_proposals',
    'search_chunks','jobs','usage_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant select on public.profiles, public.capture_batches, public.sources, public.source_extractions,
  public.source_segments, public.knowledge_pages, public.page_versions, public.page_source_links,
  public.block_evidence, public.page_proposals, public.jobs to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy batches_select on public.capture_batches for select to authenticated
  using (owner_id = (select auth.uid()));
-- exclusão lógica: some imediatamente para o cliente
create policy sources_select on public.sources for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);
create policy extractions_select on public.source_extractions for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.sources s where s.id = source_id and s.deleted_at is null));
create policy segments_select on public.source_segments for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.source_extractions x where x.id = extraction_id));
create policy pages_select on public.knowledge_pages for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);
create policy versions_select on public.page_versions for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.knowledge_pages p where p.id = page_id));
create policy links_select on public.page_source_links for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.knowledge_pages p where p.id = page_id));
create policy evidence_select on public.block_evidence for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.source_segments g where g.id = segment_id));
create policy proposals_select on public.page_proposals for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.knowledge_pages p where p.id = page_id));
create policy jobs_select on public.jobs for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.sources s where s.id = source_id));
-- search_chunks, usage_events, server_config: sem acesso direto do cliente (etapa 3 expõe busca via RPC).
