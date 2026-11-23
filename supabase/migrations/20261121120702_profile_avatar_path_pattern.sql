alter table public.profiles drop constraint profiles_avatar_valid;
alter table public.profiles add constraint profiles_avatar_valid check (
  coalesce(jsonb_typeof(profile_avatar) = 'object'
  and profile_avatar->>'color' in ('indigo','mint','peach','rose','lilac')
  and (
    (profile_avatar->>'kind' = 'initials' and profile_avatar->>'path' is null and profile_avatar->>'sticker' is null)
    or (profile_avatar->>'kind' = 'sticker' and profile_avatar->>'sticker' in ('sparkles','sun','leaf','mountain','rocket','coffee','cat','wave') and profile_avatar->>'path' is null)
    or (profile_avatar->>'kind' = 'photo' and profile_avatar->>'path' ~ ('^' || id::text || '/[0-9a-f-]{36}[.]jpg$') and profile_avatar->>'sticker' is null)
  ) and octet_length(profile_avatar::text) < 512, false)
);
drop policy profile_avatars_insert_own on storage.objects;
create policy profile_avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}[.]jpg$'));
