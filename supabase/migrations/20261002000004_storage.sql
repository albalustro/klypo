-- Bucket privado de capturas + políticas. Caminho do objeto: {owner_id}/{source_id}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 15728640, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload: só dentro da própria pasta, no formato exato uuid/uuid. Sem UPDATE/DELETE para o cliente.
create policy captures_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'captures'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}$');

-- Leitura: só enquanto existir uma fonte VISÍVEL (não excluída) da conta apontando para o arquivo.
-- (a subconsulta passa pela RLS de public.sources, que já filtra dono e exclusão lógica)
create policy captures_select_live_source on storage.objects for select to authenticated
  using (bucket_id = 'captures'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and exists (select 1 from public.sources s where s.object_path = storage.objects.name));
