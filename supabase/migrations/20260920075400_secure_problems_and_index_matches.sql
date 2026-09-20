-- Problem rows contain hidden tests and reference solutions. Keep them available
-- only to the backend secret role, which bypasses RLS, and make the denial for
-- browser roles explicit so the security posture is visible to reviewers.
create policy "problem bank is backend only"
on public.problems
for all
to anon, authenticated
using (false)
with check (false);

-- Cover the versioned problem foreign key used when joining stored matches.
create index matches_problem_version_idx
on public.matches (problem_id, problem_version);
