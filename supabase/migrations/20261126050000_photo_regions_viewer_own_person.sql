-- Viewers may only attach photo regions to their linked person (or leave person_id null).
-- Editors (can_edit_tree) may attach regions to anyone.

drop policy if exists "photo_regions_insert_own" on public.photo_regions;
create policy "photo_regions_insert_own"
  on public.photo_regions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      public.can_edit_tree()
      or person_id is null
      or exists (
        select 1
        from public.people p
        where p.id = person_id
          and p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "photo_regions_update_own" on public.photo_regions;
create policy "photo_regions_update_own"
  on public.photo_regions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      public.can_edit_tree()
      or person_id is null
      or exists (
        select 1
        from public.people p
        where p.id = person_id
          and p.user_id = (select auth.uid())
      )
    )
  );
