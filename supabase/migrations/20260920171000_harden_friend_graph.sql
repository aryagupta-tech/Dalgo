-- Make the backend-only friend graph explicit to the database linter and
-- index every cascading profile reference.
begin;

create index friendships_requested_by_idx
on public.friendships (requested_by);

create policy friend_requests_backend_only
on public.friend_requests
for all
to public
using (false)
with check (false);

create policy friendships_backend_only
on public.friendships
for all
to public
using (false)
with check (false);

commit;
