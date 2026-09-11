-- Dalgo: initial Supabase migration. Run once using the migration owner.
-- Browser access is read-only and deliberately excludes problem tests and payloads.
-- RPC contract is documented immediately above settle_match below.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now()
);

create table public.arena_ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  arena text not null check (arena in ('easy', 'medium', 'hard')),
  mode text not null check (mode in ('human', 'bot')),
  rating integer not null default 1200,
  matches integer not null default 0 check (matches >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, arena, mode),
  check (matches = wins + losses + draws)
);
create index arena_ratings_leaderboard_idx on public.arena_ratings(arena, mode, rating desc, user_id);

create table public.problems (
  id text not null check (char_length(id) between 1 and 100),
  version integer not null check (version >= 1),
  arena text not null check (arena in ('easy', 'medium', 'hard')),
  public jsonb not null check (jsonb_typeof(public) = 'object'),
  private jsonb not null check (jsonb_typeof(private) = 'object'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table public.matches (
  id uuid primary key,
  arena text not null check (arena in ('easy', 'medium', 'hard')),
  mode text not null check (mode in ('human', 'bot')),
  problem_id text not null,
  problem_version integer not null,
  status text not null check (status in ('settled', 'void')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  settlement_key text not null unique check (char_length(settlement_key) between 1 and 200),
  -- Backend-only canonical input lets retries reject conflicting results.
  settlement_payload jsonb not null,
  settled_at timestamptz not null default now(),
  foreign key (problem_id, problem_version) references public.problems(id, version),
  check (isfinite(started_at) and isfinite(ended_at) and ended_at >= started_at)
);
create index matches_history_idx on public.matches(ended_at desc, id);

create table public.participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  user_id uuid references public.profiles(id) on delete restrict,
  bot_rating integer,
  pre_rating integer not null,
  primary key (match_id, seat),
  unique (match_id, user_id),
  check ((user_id is not null and bot_rating is null) or
         (user_id is null and bot_rating is not null and bot_rating in (800, 1200, 1600) and pre_rating = bot_rating))
);
create index participants_user_history_idx on public.participants(user_id, match_id);

create table public.submissions (
  id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind in ('run', 'submit')),
  source text check (source is null or octet_length(source) <= 65536),
  language text not null check (language in ('python', 'cpp', 'java', 'javascript')),
  verdict text not null,
  received_at timestamptz not null,
  sequence bigint not null check (sequence >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  -- Internal judge metadata. Never granted to browser roles.
  payload jsonb not null default '{}'::jsonb,
  unique (match_id, sequence),
  unique (match_id, user_id, idempotency_key),
  foreign key (match_id, user_id) references public.participants(match_id, user_id)
);
create index submissions_retention_idx on public.submissions(received_at) where source is not null;
create index submissions_user_history_idx on public.submissions(user_id, received_at desc);

create table public.rating_ledger (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  arena text not null check (arena in ('easy', 'medium', 'hard')),
  mode text not null check (mode in ('human', 'bot')),
  before_rating integer not null,
  delta integer not null check (delta between -32 and 32),
  after_rating integer not null,
  outcome text not null check (outcome in ('win', 'loss', 'draw', 'void')),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id),
  foreign key (match_id, user_id) references public.participants(match_id, user_id),
  check (after_rating = before_rating + delta),
  check (outcome not in ('draw', 'void') or delta = 0)
);
create index rating_ledger_user_idx on public.rating_ledger(user_id, created_at desc);

-- OAuth metadata never becomes an email address or an unrestricted handle.
-- The UUID suffix makes accidental metadata collisions extremely unlikely;
-- unique_violation retry also handles deliberate or concurrent collisions.
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text;
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
    begin
      insert into public.profiles(id, username, display_name, avatar_url)
      values(new.id, candidate, display, avatar);
      exit;
    exception when unique_violation then
      -- Do not spin if another initialization path already inserted this user.
      if exists(select 1 from public.profiles where id = new.id) then exit; end if;
      attempt := attempt + 1;
      if attempt >= 8 then raise exception 'Unable to allocate a unique username'; end if;
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
create trigger on_dalgo_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Initialize accounts already present when this fresh schema is installed.
-- Full UUID-derived handles are unique, safe, and cannot collide with the
-- underscore-containing handles created by the OAuth trigger.
insert into public.profiles(id, username, display_name, avatar_url)
select u.id, replace(u.id::text, '-', ''),
  left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), 'Coder'), 80),
  case when u.raw_user_meta_data ->> 'avatar_url' ~ '^https://'
         and char_length(u.raw_user_meta_data ->> 'avatar_url') <= 2048
       then u.raw_user_meta_data ->> 'avatar_url' else null end
from auth.users u
where true
on conflict (id) do nothing;
insert into public.arena_ratings(user_id, arena, mode)
select p.id, a.arena, m.mode from public.profiles p
cross join (values ('easy'), ('medium'), ('hard')) a(arena)
cross join (values ('human'), ('bot')) m(mode)
where true
on conflict do nothing;

-- All tables use RLS even where no browser grants are provided.
alter table public.profiles enable row level security;
alter table public.arena_ratings enable row level security;
alter table public.problems enable row level security;
alter table public.matches enable row level security;
alter table public.participants enable row level security;
alter table public.submissions enable row level security;
alter table public.rating_ledger enable row level security;

revoke all on public.profiles, public.arena_ratings, public.problems,
  public.matches, public.participants, public.submissions, public.rating_ledger
  from public, anon, authenticated;
grant select(id, username, display_name, avatar_url) on public.profiles to anon, authenticated;
grant select on public.arena_ratings to anon, authenticated;
grant select(id, arena, mode, problem_id, problem_version, status, result,
  started_at, ended_at, settled_at) on public.matches to authenticated;
grant select(match_id, seat, user_id, bot_rating, pre_rating) on public.participants to authenticated;
grant select(id, match_id, user_id, kind, source, language, verdict, received_at, sequence)
  on public.submissions to authenticated;
grant select on public.rating_ledger to authenticated;
grant all on public.profiles, public.arena_ratings, public.problems,
  public.matches, public.participants, public.submissions, public.rating_ledger to service_role;

create policy profiles_public_read on public.profiles for select to anon, authenticated using (true);
create policy ratings_public_read on public.arena_ratings for select to anon, authenticated using (true);
create policy participants_own_read on public.participants for select to authenticated
  using (user_id = (select auth.uid()));
create policy matches_own_read on public.matches for select to authenticated
  using (exists(select 1 from public.participants p
                where p.match_id = matches.id and p.user_id = (select auth.uid())));
create policy submissions_own_read on public.submissions for select to authenticated
  using (user_id = (select auth.uid()));
create policy ledger_own_read on public.rating_ledger for select to authenticated
  using (user_id = (select auth.uid()));
-- No browser policy exists for problems. The Worker selects and strips private data.

-- Trusted Worker-only RPC input:
-- {id:uuid, settlement_key?:string, arena:'easy'|'medium'|'hard', mode:'human'|'bot',
--  problem_id:string, problem_version:int, started_at:ISO, ended_at:ISO,
--  result:{outcome:'win'|'draw'|'void', winner_id:uuid|'bot'|null, reason:string},
--  participants:[{user_id:uuid,pre_rating:int},
--                {user_id:uuid,pre_rating:int} OR {user_id:null,bot_rating:1200,pre_rating:1200}]}
-- Participant array order is stable on retries. The function computes all Elo.
-- Durable Object owns live state; this function records terminal matches only.
create function public.settle_match(p_match jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  mid uuid := (p_match ->> 'id')::uuid;
  skey text := coalesce(p_match ->> 'settlement_key', p_match ->> 'id');
  arena_value text := p_match ->> 'arena';
  mode_value text := p_match ->> 'mode';
  participants_value jsonb := p_match -> 'participants';
  outcome_value text := p_match #>> '{result,outcome}';
  winner text := p_match #>> '{result,winner_id}';
  reason text := left(coalesce(p_match #>> '{result,reason}', ''), 240);
  clean_result jsonb;
  canonical jsonb;
  stored public.matches%rowtype;
  person record;
  human_count integer;
  unique_count integer;
  winner_rating integer;
  loser_rating integer;
  gain integer := 0;
  current_rating integer;
  delta_value integer;
  individual_outcome text;
  changes jsonb;
begin
  if mid is null or skey is null or arena_value is null or
     arena_value not in ('easy', 'medium', 'hard') or mode_value is null or
     mode_value not in ('human', 'bot') or outcome_value is null or
     outcome_value not in ('win', 'draw', 'void') then
    raise exception 'Invalid settlement fields' using errcode = '22023';
  end if;
  if jsonb_typeof(participants_value) is distinct from 'array' then
    raise exception 'Exactly two participants required' using errcode = '22023';
  end if;
  if jsonb_array_length(participants_value) <> 2 then
    raise exception 'Exactly two participants required' using errcode = '22023';
  end if;
  select count(*) filter(where p.user_id is not null), count(distinct p.user_id)
  into human_count, unique_count
  from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer);
  if unique_count <> human_count or (mode_value = 'human' and human_count <> 2)
     or (mode_value = 'bot' and human_count <> 1) then
    raise exception 'Invalid human/bot participants' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
    where p.pre_rating is null or
      (p.user_id is not null and p.bot_rating is not null) or
      (p.user_id is null and (p.bot_rating is null or p.bot_rating not in (800,1200,1600)
                             or p.pre_rating <> p.bot_rating))
  ) then
    raise exception 'Invalid participant rating' using errcode = '22023';
  end if;
  if outcome_value = 'win' then
    if winner is null or not exists (
      select 1 from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
      where coalesce(p.user_id::text, 'bot') = winner
    ) then
      raise exception 'Winner must be a match participant' using errcode = '22023';
    end if;
  elsif winner is not null then
    raise exception 'Draw and void outcomes have no winner' using errcode = '22023';
  end if;

  clean_result := jsonb_build_object('outcome', outcome_value, 'winner_id', winner, 'reason', reason);
  canonical := jsonb_build_object('id', mid, 'settlement_key', skey, 'arena', arena_value,
    'mode', mode_value, 'problem_id', p_match ->> 'problem_id',
    'problem_version', (p_match ->> 'problem_version')::integer,
    'started_at', (p_match ->> 'started_at')::timestamptz,
    'ended_at', (p_match ->> 'ended_at')::timestamptz,
    'result', clean_result, 'participants', participants_value);

  -- A transaction-scoped lock serializes same-match retries before any rating lock.
  -- Hash collisions only serialize unrelated work; they cannot change results.
  perform pg_advisory_xact_lock(hashtextextended(mid::text, 0));
  select * into stored from public.matches where id = mid;
  if found then
    if stored.settlement_key <> skey or stored.settlement_payload <> canonical then
      raise exception 'Conflicting settlement retry' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', l.user_id,
      'before', l.before_rating, 'delta', l.delta, 'after', l.after_rating,
      'outcome', l.outcome) order by l.user_id), '[]'::jsonb)
    into changes from public.rating_ledger l where l.match_id = mid;
    return jsonb_build_object('id', mid, 'status', stored.status, 'result', stored.result,
                             'rating_changes', changes, 'already_settled', true);
  end if;
  if exists(select 1 from public.matches where settlement_key = skey) then
    raise exception 'Settlement key belongs to another match' using errcode = '22023';
  end if;
  if not exists(select 1 from public.problems
                where id = p_match ->> 'problem_id'
                  and version = (p_match ->> 'problem_version')::integer
                  and arena = arena_value) then
    raise exception 'Unknown problem version or arena' using errcode = '22023';
  end if;

  -- Ensure defaults exist for users imported before the OAuth trigger was installed.
  insert into public.arena_ratings(user_id, arena, mode)
  select p.user_id, arena_value, mode_value
  from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
  where p.user_id is not null order by p.user_id
  on conflict do nothing;

  -- Deterministic user order prevents A-vs-B / B-vs-A deadlocks.
  for person in
    select p.user_id, p.pre_rating
    from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
    where p.user_id is not null order by p.user_id
  loop
    select r.rating into current_rating from public.arena_ratings r
    where r.user_id = person.user_id and r.arena = arena_value and r.mode = mode_value
    for update;
    if not found or current_rating <> person.pre_rating then
      raise exception 'Pre-match rating mismatch for user %', person.user_id using errcode = '40001';
    end if;
  end loop;

  if outcome_value = 'win' then
    select p.pre_rating into winner_rating
    from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
    where coalesce(p.user_id::text, 'bot') = winner;
    select p.pre_rating into loser_rating
    from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
    where coalesce(p.user_id::text, 'bot') <> winner;
    -- Clamp exponent only at irrelevant tails to avoid numeric overflow.
    gain := round(32 * (1 - 1 / (1 + power(10::numeric,
                greatest(-100::numeric, least(100::numeric,
                 (loser_rating::numeric - winner_rating::numeric) / 400))))))::integer;
  end if;

  insert into public.matches(id, arena, mode, problem_id, problem_version, status, result,
    started_at, ended_at, settlement_key, settlement_payload)
  values(mid, arena_value, mode_value, p_match ->> 'problem_id',
    (p_match ->> 'problem_version')::integer,
    case when outcome_value = 'void' then 'void' else 'settled' end, clean_result,
    (p_match ->> 'started_at')::timestamptz, (p_match ->> 'ended_at')::timestamptz, skey, canonical);

  insert into public.participants(match_id, seat, user_id, pre_rating, bot_rating)
  select mid, (p.ordinality - 1)::smallint, (p.value ->> 'user_id')::uuid,
    (p.value ->> 'pre_rating')::integer, (p.value ->> 'bot_rating')::integer
  from jsonb_array_elements(participants_value) with ordinality p(value, ordinality);

  for person in
    select p.user_id, p.pre_rating
    from jsonb_to_recordset(participants_value) as p(user_id uuid, pre_rating integer, bot_rating integer)
    where p.user_id is not null order by p.user_id
  loop
    if outcome_value in ('draw', 'void') then
      delta_value := 0; individual_outcome := outcome_value;
    elsif person.user_id::text = winner then
      delta_value := gain; individual_outcome := 'win';
    else
      delta_value := -gain; individual_outcome := 'loss';
    end if;
    insert into public.rating_ledger(match_id, user_id, arena, mode, before_rating, delta, after_rating, outcome)
    values(mid, person.user_id, arena_value, mode_value, person.pre_rating,
           delta_value, person.pre_rating + delta_value, individual_outcome);
    if outcome_value <> 'void' then
      update public.arena_ratings set
        rating = rating + delta_value,
        matches = matches + 1,
        wins = wins + case when individual_outcome = 'win' then 1 else 0 end,
        losses = losses + case when individual_outcome = 'loss' then 1 else 0 end,
        draws = draws + case when individual_outcome = 'draw' then 1 else 0 end,
        updated_at = now()
      where user_id = person.user_id and arena = arena_value and mode = mode_value;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', l.user_id,
    'before', l.before_rating, 'delta', l.delta, 'after', l.after_rating,
    'outcome', l.outcome) order by l.user_id), '[]'::jsonb)
  into changes from public.rating_ledger l where l.match_id = mid;
  return jsonb_build_object('id', mid, 'status', case when outcome_value = 'void' then 'void' else 'settled' end,
    'result', clean_result, 'rating_changes', changes, 'already_settled', false);
end;
$$;
revoke all on function public.settle_match(jsonb) from public, anon, authenticated;
grant execute on function public.settle_match(jsonb) to service_role;

-- Schedule daily from the Worker with its service credential. No pg_cron required.
-- Only the source is removed; private metadata must never contain copies of source.
create function public.purge_submission_sources()
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare removed bigint;
begin
  update public.submissions set source = null
  where received_at < now() - interval '30 days' and source is not null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.purge_submission_sources() from public, anon, authenticated;
grant execute on function public.purge_submission_sources() to service_role;

commit;
