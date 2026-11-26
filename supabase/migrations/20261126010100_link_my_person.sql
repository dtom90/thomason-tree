-- Allow a signed-in user to claim an unlinked person as themselves.
create or replace function public.link_my_person(target_person_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1 from public.people
    where user_id = auth.uid()
  ) then
    raise exception 'Already linked to a person';
  end if;

  update public.people
  set user_id = auth.uid()
  where id = target_person_id
    and user_id is null;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'Person not available to link';
  end if;
end;
$$;

revoke all on function public.link_my_person(text) from public;
grant execute on function public.link_my_person(text) to authenticated;
