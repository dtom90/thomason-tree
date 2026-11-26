-- Allow a linked user to update their own people row (profile fields).
create policy "Users can update their own person"
  on public.people
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Prevent privilege escalation on can_edit / user_id via client updates.
create or replace function public.people_lock_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.can_edit is distinct from old.can_edit
     and not public.can_edit_tree() then
    raise exception 'Cannot change can_edit';
  end if;

  if new.user_id is distinct from old.user_id then
    if public.can_edit_tree() then
      null;
    elsif old.user_id = (select auth.uid()) and new.user_id is null then
      null; -- unlink_my_person
    elsif old.user_id is null and new.user_id = (select auth.uid()) then
      null; -- link_my_person
    else
      raise exception 'Cannot change user_id';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists people_lock_privileged_columns on public.people;
create trigger people_lock_privileged_columns
  before update on public.people
  for each row
  execute function public.people_lock_privileged_columns();
