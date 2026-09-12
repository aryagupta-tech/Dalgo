-- The Supabase bootstrap event trigger only needs owner execution privileges.
-- Keep its automatic RLS behavior while removing unnecessary browser grants.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$migration$;
