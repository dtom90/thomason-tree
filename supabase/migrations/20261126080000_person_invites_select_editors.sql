-- All editors can see invite status (not only the creator).
drop policy if exists "Editors can select invites they created" on public.person_invites;

create policy "Editors can select person invites"
  on public.person_invites
  for select
  to authenticated
  using (public.can_edit_tree());
