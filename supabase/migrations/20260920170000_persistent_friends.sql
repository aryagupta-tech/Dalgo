-- Durable friend requests and accepted friendships. All writes and reads flow
-- through the authenticated Worker; browser roles cannot enumerate this graph.
begin;

create table public.friend_requests (
  id uuid primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  check (sender_id <> receiver_id),
  check ((status = 'pending' and responded_at is null) or
         (status <> 'pending' and responded_at is not null))
);

create unique index friend_requests_one_pending_pair_idx
on public.friend_requests (
  least(sender_id, receiver_id),
  greatest(sender_id, receiver_id)
)
where status = 'pending';
create index friend_requests_sender_idx
on public.friend_requests (sender_id, created_at desc);
create index friend_requests_receiver_idx
on public.friend_requests (receiver_id, created_at desc);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  check (user_low::text < user_high::text),
  check (requested_by = user_low or requested_by = user_high),
  unique (user_low, user_high)
);
create index friendships_user_high_idx
on public.friendships (user_high, created_at desc);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_requests from public, anon, authenticated;
revoke all on public.friendships from public, anon, authenticated;
grant all on public.friend_requests to service_role;
grant all on public.friendships to service_role;

create or replace function public.create_friend_request(
  p_user_id uuid,
  p_target_id uuid,
  p_request_id uuid
)
returns setof public.friend_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.friend_requests%rowtype;
begin
  select * into existing
  from public.friend_requests
  where id = p_request_id;
  if found then
    if existing.sender_id <> p_user_id or existing.receiver_id <> p_target_id then
      raise exception 'That friend request identifier is already in use.'
        using errcode = '23505';
    end if;
    return next existing;
    return;
  end if;

  if p_user_id = p_target_id then
    raise exception 'You cannot send a friend request to yourself.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) or
     not exists (select 1 from public.profiles where id = p_target_id) then
    raise exception 'Player profile not found.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.friendships
    where user_low = least(p_user_id, p_target_id)
      and user_high = greatest(p_user_id, p_target_id)
  ) then
    raise exception 'You are already friends.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.friend_requests
    where status = 'pending'
      and least(sender_id, receiver_id) = least(p_user_id, p_target_id)
      and greatest(sender_id, receiver_id) = greatest(p_user_id, p_target_id)
  ) then
    raise exception 'A friend request between you is already pending.'
      using errcode = '23505';
  end if;

  return query
    insert into public.friend_requests(id, sender_id, receiver_id)
    values (p_request_id, p_user_id, p_target_id)
    returning *;
end;
$$;

create or replace function public.respond_friend_request(
  p_user_id uuid,
  p_request_id uuid,
  p_action text
)
returns setof public.friend_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.friend_requests%rowtype;
begin
  select * into request
  from public.friend_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Friend request not found.' using errcode = 'P0002';
  end if;
  if request.status <> 'pending' then
    raise exception 'This friend request is no longer pending.'
      using errcode = '23000';
  end if;

  if p_action in ('accept', 'decline') then
    if request.receiver_id <> p_user_id then
      raise exception 'Only the invited player can respond to this friend request.'
        using errcode = '42501';
    end if;
  elsif p_action = 'cancel' then
    if request.sender_id <> p_user_id then
      raise exception 'Only the sender can cancel this friend request.'
        using errcode = '42501';
    end if;
  else
    raise exception 'Choose accept, decline, or cancel.' using errcode = '22023';
  end if;

  update public.friend_requests
  set status = case p_action
    when 'accept' then 'accepted'
    when 'decline' then 'declined'
    else 'cancelled'
  end,
  responded_at = clock_timestamp()
  where id = p_request_id
  returning * into request;

  if p_action = 'accept' then
    insert into public.friendships(user_low, user_high, requested_by)
    values (
      least(request.sender_id, request.receiver_id),
      greatest(request.sender_id, request.receiver_id),
      request.sender_id
    )
    on conflict (user_low, user_high) do nothing;
  end if;

  return next request;
end;
$$;

revoke all on function public.create_friend_request(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.respond_friend_request(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_friend_request(uuid, uuid, uuid)
  to service_role;
grant execute on function public.respond_friend_request(uuid, uuid, text)
  to service_role;

commit;
