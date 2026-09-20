-- Stable public player IDs and direct friend challenges.
-- Live acceptance remains authoritative in the Coordinator Durable Object;
-- this table is the private, durable audit/history record.
begin;

alter table public.profiles add column public_id text;

update public.profiles
set public_id = 'DLG-' || upper(
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
)
where public_id is null;

alter table public.profiles
  alter column public_id set not null,
  add constraint profiles_public_id_format check (
    public_id ~ '^DLG-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$'
  ),
  add constraint profiles_public_id_key unique (public_id);

-- Keep the existing OAuth bootstrap behavior while allocating a random,
-- non-secret identifier that is safe to share instead of an auth UUID.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text;
  public_candidate text;
  random_value text;
  display text;
  avatar text;
  attempt integer := 0;
begin
  base := left(regexp_replace(lower(coalesce(new.raw_user_meta_data ->> 'user_name',
                  new.raw_user_meta_data ->> 'preferred_username', 'coder')),
                  '[^a-z0-9_]', '', 'g'), 19);
  if char_length(base) < 3 then base := 'coder'; end if;
  display := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                    new.raw_user_meta_data ->> 'name', base)), 80);
  if display = '' then display := base; end if;
  avatar := new.raw_user_meta_data ->> 'avatar_url';
  if avatar is null or char_length(avatar) > 2048 or avatar !~ '^https://' then
    avatar := null;
  end if;
  loop
    suffix := case when attempt = 0 then left(replace(new.id::text, '-', ''), 12)
                   else left(replace(gen_random_uuid()::text, '-', ''), 12) end;
    candidate := base || '_' || suffix;
    random_value := upper(replace(gen_random_uuid()::text, '-', ''));
    public_candidate := 'DLG-' || substr(random_value, 1, 4) || '-' ||
      substr(random_value, 5, 4) || '-' || substr(random_value, 9, 4) || '-' ||
      substr(random_value, 13, 4);
    begin
      insert into public.profiles(id, username, display_name, avatar_url, public_id)
      values(new.id, candidate, display, avatar, public_candidate);
      exit;
    exception when unique_violation then
      -- Do not spin if another initialization path already inserted this user.
      if exists(select 1 from public.profiles where id = new.id) then exit; end if;
      attempt := attempt + 1;
      if attempt >= 8 then raise exception 'Unable to allocate a unique profile'; end if;
    end;
  end loop;
  insert into public.arena_ratings(user_id, arena, mode)
  select new.id, a.arena, m.mode
  from (values ('easy'), ('medium'), ('hard')) a(arena)
  cross join (values ('human'), ('bot')) m(mode)
  where true
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create table public.friend_challenges (
  id uuid primary key,
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  challenged_id uuid not null references public.profiles(id) on delete cascade,
  arena text not null check (arena in ('easy', 'medium', 'hard')),
  status text not null check (status in ('open', 'accepted', 'declined', 'cancelled', 'expired')),
  -- Live matches are stored in Postgres only after settlement, so this is an
  -- intentionally unconstrained reference to the authoritative Durable Object ID.
  match_id uuid,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  check (challenger_id <> challenged_id),
  check (isfinite(created_at) and isfinite(expires_at) and expires_at > created_at),
  check ((status = 'open' and responded_at is null and match_id is null) or
         (status <> 'open' and responded_at is not null)),
  check (match_id is null or status = 'accepted')
);

create unique index friend_challenges_one_open_pair_idx
on public.friend_challenges (
  least(challenger_id, challenged_id),
  greatest(challenger_id, challenged_id)
)
where status = 'open';
create index friend_challenges_challenger_idx
on public.friend_challenges (challenger_id, created_at desc);
create index friend_challenges_challenged_idx
on public.friend_challenges (challenged_id, created_at desc);

alter table public.friend_challenges enable row level security;
revoke all on public.friend_challenges from public, anon, authenticated;
grant select(id, challenger_id, challenged_id, arena, status, match_id,
  created_at, expires_at, responded_at)
on public.friend_challenges to authenticated;
grant all on public.friend_challenges to service_role;

create policy friend_challenges_participant_read
on public.friend_challenges
for select
to authenticated
using (
  challenger_id = (select auth.uid()) or
  challenged_id = (select auth.uid())
);

commit;
