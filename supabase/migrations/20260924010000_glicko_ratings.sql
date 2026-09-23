-- Glicko-1 cutover. Pause admission and let every active match settle before
-- applying this migration: old Durable Objects hold pre-shift Elo snapshots.
begin;

alter table public.arena_ratings alter column rating set default 800;
update public.arena_ratings set
  rating = rating - 400
where true;
alter table public.arena_ratings
  add column rd numeric(8,3) not null default 350.000
    check (rd between 30 and 350),
  add column last_rated_at timestamptz;
update public.arena_ratings
set last_rated_at = updated_at
where matches > 0;

alter table public.participants
  add column pre_rd numeric(8,3)
    check (pre_rd is null or pre_rd between 30 and 350);
alter table public.rating_ledger
  drop constraint if exists rating_ledger_delta_check,
  drop constraint if exists rating_ledger_check1;
alter table public.rating_ledger
  add constraint rating_ledger_void_zero_check
  check (outcome <> 'void' or delta = 0);
alter table public.rating_ledger
  add column before_rd numeric(8,3),
  add column after_rd numeric(8,3),
  add constraint rating_ledger_rd_pair_check
    check ((before_rd is null and after_rd is null) or
           (before_rd between 30 and 350 and after_rd between 30 and 350));

-- An RD of 50 returns to 350 after one year away from rated play. The
-- original Glicko paper permits choosing this inactivity period per service.
create function public.glicko_rd_at(
  p_rd numeric, p_last_rated_at timestamptz, p_at timestamptz
) returns numeric
language sql stable set search_path = '' as $$
  select case when p_last_rated_at is null then p_rd
    else least(350::numeric, round(sqrt(
      (p_rd::double precision * p_rd::double precision) +
      (120000.0 / 365.0) * greatest(0.0,
        extract(epoch from (p_at - p_last_rated_at)) / 86400.0)
    )::numeric, 3)) end
$$;
revoke all on function public.glicko_rd_at(numeric,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.glicko_rd_at(numeric,timestamptz,timestamptz)
  to service_role;

-- Single-game Glicko-1 update, performed separately for both participants
-- from the same pre-match snapshots. Score is 1, 0.5, or 0.
create function public.glicko_after(
  p_rating integer, p_rd numeric,
  p_opponent_rating integer, p_opponent_rd numeric,
  p_score double precision
) returns table(new_rating integer, new_rd numeric)
language plpgsql immutable set search_path = '' as $$
declare
  q constant double precision := ln(10.0) / 400.0;
  g double precision;
  expected double precision;
  precision_value double precision;
begin
  if p_rd is null or p_opponent_rd is null or
     p_rd not between 30 and 350 or p_opponent_rd not between 30 and 350 or
     p_score not in (0.0, 0.5, 1.0) then
    raise exception 'Invalid Glicko input' using errcode = '22023';
  end if;
  g := 1.0 / sqrt(1.0 + 3.0 * q * q *
    p_opponent_rd::double precision * p_opponent_rd::double precision /
    (pi() * pi()));
  expected := 1.0 / (1.0 + power(10.0,
    greatest(-100.0, least(100.0,
      -g * (p_rating::double precision - p_opponent_rating::double precision) / 400.0))));
  precision_value := 1.0 / (p_rd::double precision * p_rd::double precision) +
    q * q * g * g * expected * (1.0 - expected);
  new_rating := round((p_rating::double precision +
    q * g * (p_score - expected) / precision_value)::numeric)::integer;
  new_rd := greatest(30::numeric,
    round(sqrt(1.0 / precision_value)::numeric, 3));
  return next;
end;
$$;
revoke all on function public.glicko_after(integer,numeric,integer,numeric,double precision)
  from public, anon, authenticated;
grant execute on function public.glicko_after(integer,numeric,integer,numeric,double precision)
  to service_role;

create or replace function public.settle_match(p_match jsonb)
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
  effective_players jsonb;
  stored public.matches%rowtype;
  person record;
  opponent record;
  human_count integer;
  unique_count integer;
  current_rating integer;
  current_rd numeric;
  score_value double precision;
  next_rating integer;
  next_rd numeric;
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
  if jsonb_typeof(participants_value) is distinct from 'array' or
     jsonb_array_length(participants_value) <> 2 then
    raise exception 'Exactly two participants required' using errcode = '22023';
  end if;
  select count(*) filter(where p.user_id is not null), count(distinct p.user_id)
  into human_count, unique_count
  from jsonb_to_recordset(participants_value)
    as p(user_id uuid, pre_rating integer, bot_rating integer);
  if unique_count <> human_count or (mode_value = 'human' and human_count <> 2)
     or (mode_value = 'bot' and human_count <> 1) then
    raise exception 'Invalid human/bot participants' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(participants_value)
      as p(user_id uuid, pre_rating integer, bot_rating integer)
    where p.pre_rating is null or
      (p.user_id is not null and p.bot_rating is not null) or
      (p.user_id is null and (p.bot_rating is null or
        p.bot_rating not in (800,1200,1600) or p.pre_rating <> p.bot_rating))
  ) then
    raise exception 'Invalid participant rating' using errcode = '22023';
  end if;
  if outcome_value = 'win' then
    if winner is null or not exists (
      select 1 from jsonb_to_recordset(participants_value)
        as p(user_id uuid, pre_rating integer, bot_rating integer)
      where coalesce(p.user_id::text, 'bot') = winner
    ) then
      raise exception 'Winner must be a match participant' using errcode = '22023';
    end if;
  elsif winner is not null then
    raise exception 'Draw and void outcomes have no winner' using errcode = '22023';
  end if;

  clean_result := jsonb_build_object('outcome', outcome_value,
    'winner_id', winner, 'reason', reason);
  canonical := jsonb_build_object('id', mid, 'settlement_key', skey,
    'arena', arena_value, 'mode', mode_value,
    'problem_id', p_match ->> 'problem_id',
    'problem_version', (p_match ->> 'problem_version')::integer,
    'started_at', (p_match ->> 'started_at')::timestamptz,
    'ended_at', (p_match ->> 'ended_at')::timestamptz,
    'result', clean_result, 'participants', participants_value);

  perform pg_advisory_xact_lock(hashtextextended(mid::text, 0));
  select * into stored from public.matches where id = mid;
  if found then
    if stored.settlement_key <> skey or stored.settlement_payload <> canonical then
      raise exception 'Conflicting settlement retry' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', l.user_id,
      'before', l.before_rating, 'delta', l.delta, 'after', l.after_rating,
      'before_rd', l.before_rd, 'after_rd', l.after_rd,
      'outcome', l.outcome) order by l.user_id), '[]'::jsonb)
    into changes from public.rating_ledger l where l.match_id = mid;
    return jsonb_build_object('id', mid, 'status', stored.status,
      'result', stored.result, 'rating_changes', changes,
      'already_settled', true);
  end if;
  if exists(select 1 from public.matches where settlement_key = skey) then
    raise exception 'Settlement key belongs to another match' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(participants_value)
      as p(user_id uuid, pre_rd numeric)
    where p.pre_rd is null or p.pre_rd not between 30 and 350 or
      (p.user_id is null and p.pre_rd <> 100)
  ) then
    raise exception 'Invalid participant RD' using errcode = '22023';
  end if;
  if not exists(select 1 from public.problems
                where id = p_match ->> 'problem_id'
                  and version = (p_match ->> 'problem_version')::integer
                  and arena = arena_value) then
    raise exception 'Unknown problem version or arena' using errcode = '22023';
  end if;

  insert into public.arena_ratings(user_id, arena, mode)
  select p.user_id, arena_value, mode_value
  from jsonb_to_recordset(participants_value)
    as p(user_id uuid, pre_rating integer, bot_rating integer)
  where p.user_id is not null order by p.user_id
  on conflict do nothing;

  for person in
    select p.user_id, p.pre_rating, p.pre_rd
    from jsonb_to_recordset(participants_value)
      as p(user_id uuid, pre_rating integer, pre_rd numeric)
    where p.user_id is not null order by p.user_id
  loop
    select r.rating, r.rd into current_rating, current_rd
    from public.arena_ratings r
    where r.user_id = person.user_id and r.arena = arena_value
      and r.mode = mode_value for update;
    if not found or current_rating <> person.pre_rating or
       current_rd <> person.pre_rd then
      raise exception 'Pre-match rating or RD mismatch for user %', person.user_id
        using errcode = '40001';
    end if;
  end loop;

  -- Capture both effective RDs before updating either account. The opponent's
  -- RD must come from the same pre-match snapshot, regardless of lock order.
  select jsonb_agg(jsonb_build_object(
    'user_id', p.user_id, 'pre_rating', p.pre_rating,
    'effective_rd', case when p.user_id is null then p.pre_rd
      else public.glicko_rd_at(p.pre_rd, r.last_rated_at,
        (p_match ->> 'started_at')::timestamptz) end
  ) order by element.ordinality)
  into effective_players
  from jsonb_array_elements(participants_value) with ordinality element(value, ordinality)
  cross join lateral jsonb_to_record(element.value)
    as p(user_id uuid, pre_rating integer, pre_rd numeric)
  left join public.arena_ratings r
    on r.user_id = p.user_id and r.arena = arena_value and r.mode = mode_value;

  insert into public.matches(id, arena, mode, problem_id, problem_version,
    status, result, started_at, ended_at, settlement_key, settlement_payload)
  values(mid, arena_value, mode_value, p_match ->> 'problem_id',
    (p_match ->> 'problem_version')::integer,
    case when outcome_value = 'void' then 'void' else 'settled' end,
    clean_result, (p_match ->> 'started_at')::timestamptz,
    (p_match ->> 'ended_at')::timestamptz, skey, canonical);

  insert into public.participants(match_id, seat, user_id, pre_rating,
    bot_rating, pre_rd)
  select mid, (p.ordinality - 1)::smallint,
    (p.value ->> 'user_id')::uuid, (p.value ->> 'pre_rating')::integer,
    (p.value ->> 'bot_rating')::integer,
    (p.value ->> 'pre_rd')::numeric
  from jsonb_array_elements(participants_value) with ordinality p(value, ordinality);

  for person in
    select p.user_id, p.pre_rating, p.effective_rd
    from jsonb_to_recordset(effective_players)
      as p(user_id uuid, pre_rating integer, effective_rd numeric)
    where p.user_id is not null order by p.user_id
  loop
    select p.pre_rating, p.effective_rd into opponent
    from jsonb_to_recordset(effective_players)
      as p(user_id uuid, pre_rating integer, effective_rd numeric)
    where p.user_id is distinct from person.user_id;
    if outcome_value = 'void' then
      next_rating := person.pre_rating;
      select p.pre_rd into next_rd from jsonb_to_recordset(participants_value)
        as p(user_id uuid, pre_rd numeric)
      where p.user_id = person.user_id;
      individual_outcome := 'void';
    else
      score_value := case when outcome_value = 'draw' then 0.5
        when person.user_id::text = winner then 1.0 else 0.0 end;
      select g.new_rating, g.new_rd into next_rating, next_rd
      from public.glicko_after(person.pre_rating, person.effective_rd,
        opponent.pre_rating, opponent.effective_rd, score_value) g;
      individual_outcome := case when outcome_value = 'draw' then 'draw'
        when score_value = 1.0 then 'win' else 'loss' end;
    end if;
    delta_value := next_rating - person.pre_rating;
    insert into public.rating_ledger(match_id, user_id, arena, mode,
      before_rating, delta, after_rating, before_rd, after_rd, outcome)
    values(mid, person.user_id, arena_value, mode_value, person.pre_rating,
      delta_value, next_rating,
      case when outcome_value = 'void' then next_rd else person.effective_rd end,
      next_rd, individual_outcome);
    if outcome_value <> 'void' then
      update public.arena_ratings set
        rating = next_rating,
        rd = next_rd,
        last_rated_at = (p_match ->> 'ended_at')::timestamptz,
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
    'before_rd', l.before_rd, 'after_rd', l.after_rd,
    'outcome', l.outcome) order by l.user_id), '[]'::jsonb)
  into changes from public.rating_ledger l where l.match_id = mid;
  return jsonb_build_object('id', mid,
    'status', case when outcome_value = 'void' then 'void' else 'settled' end,
    'result', clean_result, 'rating_changes', changes,
    'already_settled', false);
end;
$$;
revoke all on function public.settle_match(jsonb) from public, anon, authenticated;
grant execute on function public.settle_match(jsonb) to service_role;

commit;
