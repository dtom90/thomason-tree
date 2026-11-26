-- Editors can see the Google account email linked to each claimed person
-- (for Invite status in the sidebar).
create or replace function public.list_linked_person_emails()
returns table (person_id text, email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.can_edit_tree() then
    raise exception 'Not an editor';
  end if;

  return query
  select p.id::text, u.email::text
  from public.people p
  join auth.users u on u.id = p.user_id
  where p.user_id is not null
    and u.email is not null
    and length(trim(u.email)) > 0;
end;
$$;

revoke all on function public.list_linked_person_emails() from public;
grant execute on function public.list_linked_person_emails() to authenticated;
