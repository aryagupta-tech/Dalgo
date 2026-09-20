-- One-time username selection after OAuth account creation.
-- Usernames are public friend handles; only the backend can claim them.
begin;

alter table public.profiles
  add column username_configured_at timestamptz;

create or replace function public.claim_username(
  p_user_id uuid,
  p_username text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(p_username));
begin
  if normalized !~ '^[a-z0-9][a-z0-9_]{2,19}$' then
    raise exception 'Use 3–20 lowercase letters, numbers, or underscores, starting with a letter or number.'
      using errcode = '22023';
  end if;

  if normalized = any(array[
    'admin', 'administrator', 'dalgo', 'moderator', 'official',
    'root', 'staff', 'support', 'system'
  ]) then
    raise exception 'That username is reserved.'
      using errcode = '22023';
  end if;

  begin
    return query
      update public.profiles as profile
      set username = normalized,
          username_configured_at = clock_timestamp()
      where profile.id = p_user_id
        and profile.username_configured_at is null
      returning profile.*;
  exception
    when unique_violation then
      raise exception 'That username is already taken.'
        using errcode = '23505';
  end;

  if not found then
    if exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.username_configured_at is not null
    ) then
      raise exception 'Your username has already been chosen.'
        using errcode = '22023';
    end if;
    raise exception 'Player profile not found.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.claim_username(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_username(uuid, text)
  to service_role;

commit;
