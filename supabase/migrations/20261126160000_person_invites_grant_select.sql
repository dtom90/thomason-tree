-- person_invites was created after default Data API grants were revoked.
-- RLS alone is not enough; authenticated needs table-level SELECT.
grant select on public.person_invites to authenticated;
