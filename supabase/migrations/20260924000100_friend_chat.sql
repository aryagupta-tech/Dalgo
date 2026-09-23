-- Messages belong to an accepted friendship. Removing the friendship
-- cascades to its conversation; browser roles cannot read or write messages.
begin;

create table public.friend_messages (
  id uuid primary key,
  friendship_id uuid not null references public.friendships(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (length(body) between 1 and 500),
  check (octet_length(body) <= 2000)
);
create index friend_messages_conversation_idx
  on public.friend_messages(friendship_id, created_at desc);
alter table public.friend_messages enable row level security;
create policy friend_messages_backend_only on public.friend_messages
  for all to public using (false) with check (false);
revoke all on public.friend_messages from public, anon, authenticated;
grant select, insert, delete on public.friend_messages to service_role;

create function public.send_friend_message(
  p_friendship_id uuid,
  p_user_id uuid,
  p_message_id uuid,
  p_body text
)
returns setof public.friend_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  friendship public.friendships%rowtype;
  existing public.friend_messages%rowtype;
  sent public.friend_messages%rowtype;
begin
  select * into friendship from public.friendships
   where id = p_friendship_id and p_user_id in (user_low, user_high)
   for update;
  if not found then
    raise exception 'Friendship not found.' using errcode = '42501';
  end if;
  if p_body is null or length(p_body) < 1 or length(p_body) > 500 or
     octet_length(p_body) > 2000 or p_body <> btrim(p_body) or
     p_body ~ '[[:cntrl:]]' then
    raise exception 'Write a single-line message under 500 characters.'
      using errcode = '22023';
  end if;
  select * into existing from public.friend_messages where id = p_message_id;
  if found then
    if existing.friendship_id <> p_friendship_id or
       existing.sender_id <> p_user_id or existing.body <> p_body then
      raise exception 'That message identifier is already in use.'
        using errcode = '23505';
    end if;
    return next existing;
    return;
  end if;
  if exists (
    select 1 from public.friend_messages
    where friendship_id = p_friendship_id and sender_id = p_user_id
      and created_at > clock_timestamp() - interval '2 seconds'
  ) then
    raise exception 'Wait a moment before sending another message.'
      using errcode = 'P0001';
  end if;
  insert into public.friend_messages(id, friendship_id, sender_id, body)
    values(p_message_id, p_friendship_id, p_user_id, p_body)
    returning * into sent;
  return next sent;
end;
$$;
revoke all on function public.send_friend_message(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_friend_message(uuid, uuid, uuid, text)
  to service_role;
commit;
