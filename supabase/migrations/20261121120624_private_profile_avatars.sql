-- Private, owner-only profile appearance. No public photos or role changes.
alter table public.profiles add column profile_avatar jsonb not null default '{"kind":"initials","color":"indigo","sticker":null,"path":null}'::jsonb;
alter table public.profiles add constraint profiles_avatar_valid check (
  coalesce(jsonb_typeof(profile_avatar) = 'object'
  and profile_avatar->>'color' in ('indigo','mint','peach','rose','lilac')
  and (
    (profile_avatar->>'kind' = 'initials' and profile_avatar->>'path' is null and profile_avatar->>'sticker' is null)
    or (profile_avatar->>'kind' = 'sticker' and profile_avatar->>'sticker' in ('sparkles','sun','leaf','mountain','rocket','coffee','cat','wave') and profile_avatar->>'path' is null)
    or (profile_avatar->>'kind' = 'photo' and profile_avatar->>'path' ~ ('^' || id::text || '/[0-9a-f-]{36}\\.jpg$') and profile_avatar->>'sticker' is null)
  ) and octet_length(profile_avatar::text) < 512, false)
);
comment on column public.profiles.profile_avatar is 'Account appearance only: initials, curated sticker, or private photo object path. Never used for authorization.';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-avatars','profile-avatars',false,2097152,array['image/jpeg']);
create policy profile_avatars_read_own on storage.objects for select to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\\.jpg$'));
create policy profile_avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Immutable object names: a replacement uploads a new object, then updates the profile.
