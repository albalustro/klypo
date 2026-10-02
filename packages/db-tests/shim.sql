-- SHIM DE TESTE — NÃO é uma migration e NUNCA roda em Supabase.
-- Imita o mínimo do Supabase (roles, auth.users/auth.uid(), storage.buckets/objects/foldername) em um
-- Postgres puro, para exercitar migrations e RLS de verdade. Não substitui o serviço Storage real.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                   (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub')::uuid $$;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
-- Storage real preenche owner_id a partir do JWT; o cliente não escolhe.
create function storage.set_owner() returns trigger language plpgsql as
$$ begin new.owner_id := auth.uid()::text; new.owner := auth.uid(); return new; end $$;
create trigger objects_owner before insert on storage.objects for each row
  when (current_setting('request.jwt.claim.sub', true) is not null and current_setting('request.jwt.claim.sub', true) <> '')
  execute function storage.set_owner();
grant all on storage.buckets, storage.objects to authenticated, service_role;
grant select on storage.buckets to anon;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- defaults do Supabase: novas tabelas/funções em public são acessíveis a anon/authenticated/service_role
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
