-- Optional recipient email on invites (for sending invitation emails).

alter table public.person_invites
  add column if not exists email text;

drop function if exists public.create_person_invite(text, boolean);

create or replace function public.create_person_invite(
  target_person_id text,
  grant_can_edit boolean default false,
  invite_email text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_token text;
  person_user_id uuid;
  normalized_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.can_edit_tree() then
    raise exception 'Not an editor';
  end if;

  select user_id into person_user_id
  from public.people
  where id = target_person_id;

  if not found then
    raise exception 'Person not found';
  end if;

  if person_user_id is not null then
    raise exception 'Person already linked';
  end if;

  normalized_email := nullif(lower(trim(invite_email)), '');
  if normalized_email is not null and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');

  insert into public.person_invites (person_id, token_hash, grant_can_edit, created_by, email)
  values (
    target_person_id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    coalesce(grant_can_edit, false),
    auth.uid(),
    normalized_email
  );

  return raw_token;
end;
$$;

revoke all on function public.create_person_invite(text, boolean, text) from public;
grant execute on function public.create_person_invite(text, boolean, text) to authenticated;
