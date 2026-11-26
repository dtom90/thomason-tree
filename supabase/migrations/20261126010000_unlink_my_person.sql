-- Allow a signed-in user to clear their own people.user_id link.
-- Plain UPDATE cannot do this for editors: WITH CHECK can_edit_tree() fails once user_id is null.
create or replace function public.unlink_my_person()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.people
  set user_id = null
  where user_id = auth.uid();
end;
$$;

revoke all on function public.unlink_my_person() from public;
grant execute on function public.unlink_my_person() to authenticated;
