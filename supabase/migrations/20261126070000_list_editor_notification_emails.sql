-- Editor emails for invite notification (excludes the caller).
create or replace function public.list_editor_notification_emails()
returns table (email text)
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
  select distinct u.email::text
  from public.people p
  join auth.users u on u.id = p.user_id
  where p.can_edit = true
    and p.user_id is distinct from auth.uid()
    and u.email is not null
    and length(trim(u.email)) > 0;
end;
$$;

revoke all on function public.list_editor_notification_emails() from public;
grant execute on function public.list_editor_notification_emails() to authenticated;

-- Current user's display name from their linked person (fallback handled by callers).
create or replace function public.my_person_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.people p
  where p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_person_display_name() from public;
grant execute on function public.my_person_display_name() to authenticated;
