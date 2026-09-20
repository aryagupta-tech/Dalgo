-- Public profile avatars are readable by URL, while all writes remain
-- restricted to Dalgo's trusted Worker service role.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values(
  'profile-avatars',
  'profile-avatars',
  true,
  512000,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.profiles
  add column avatar_storage_path text;

alter table public.profiles
  add constraint profiles_avatar_storage_path_format check (
    avatar_storage_path is null or avatar_storage_path ~
      ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
  );

revoke all on public.profiles from public, anon, authenticated;
grant select(id, username, display_name, avatar_url) on public.profiles to anon, authenticated;
grant all on public.profiles to service_role;

create function public.swap_profile_avatar(
  p_user_id uuid,
  p_avatar_url text,
  p_storage_path text
)
returns table(
  previous_storage_path text,
  profile_id uuid,
  display_name text,
  username text,
  username_configured_at timestamptz,
  avatar_url text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_path text;
begin
  if p_user_id is null or p_avatar_url is null or p_storage_path is null or
     char_length(p_avatar_url) > 2048 or p_avatar_url !~ '^https://' or
     p_storage_path !~ ('^' || p_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$') then
    raise exception 'Invalid profile avatar' using errcode = '22023';
  end if;

  select profile.avatar_storage_path
  into previous_path
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  update public.profiles as profile
  set avatar_url = p_avatar_url,
      avatar_storage_path = p_storage_path
  where profile.id = p_user_id;

  return query
  select previous_path,
         profile.id,
         profile.display_name,
         profile.username,
         profile.username_configured_at,
         profile.avatar_url
  from public.profiles as profile
  where profile.id = p_user_id;
end;
$$;

revoke all on function public.swap_profile_avatar(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.swap_profile_avatar(uuid, text, text)
  to service_role;
