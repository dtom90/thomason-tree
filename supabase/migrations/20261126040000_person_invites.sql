-- Editors can invite someone to claim an unlinked person (optional editor grant).
-- Shareable token → Google sign-in → redeem_person_invite.

create table public.person_invites (
  id uuid primary key default gen_random_uuid(),
  person_id text not null references public.people (id) on delete cascade,
  token_hash text not null unique,
  grant_can_edit boolean not null default false,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null
);

create index person_invites_person_id_idx on public.person_invites (person_id);
create index person_invites_created_by_idx on public.person_invites (created_by);

alter table public.person_invites enable row level security;

create policy "Editors can select invites they created"
  on public.person_invites
  for select
  to authenticated
  using (created_by = (select auth.uid()) and public.can_edit_tree());

-- Allow security-definer RPCs to set can_edit when linking via invite.
create or replace function public.people_lock_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_setting('app.bypass_people_lock', true) = '1' then
    return new;
  end if;

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
      null; -- link_my_person / redeem_person_invite
    else
      raise exception 'Cannot change user_id';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.create_person_invite(
  target_person_id text,
  grant_can_edit boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_token text;
  person_user_id uuid;
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

  raw_token := encode(gen_random_bytes(32), 'hex');

  insert into public.person_invites (person_id, token_hash, grant_can_edit, created_by)
  values (
    target_person_id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    coalesce(grant_can_edit, false),
    auth.uid()
  );

  return raw_token;
end;
$$;

revoke all on function public.create_person_invite(text, boolean) from public;
grant execute on function public.create_person_invite(text, boolean) to authenticated;

create or replace function public.redeem_person_invite(invite_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite public.person_invites%rowtype;
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if invite_token is null or length(trim(invite_token)) = 0 then
    raise exception 'Invite not found or expired';
  end if;

  if exists (
    select 1 from public.people
    where user_id = auth.uid()
  ) then
    raise exception 'Already linked to a person';
  end if;

  select * into invite
  from public.person_invites
  where token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
    and redeemed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invite not found or expired';
  end if;

  perform set_config('app.bypass_people_lock', '1', true);

  update public.people
  set
    user_id = auth.uid(),
    can_edit = invite.grant_can_edit
  where id = invite.person_id
    and user_id is null;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'Person not available to link';
  end if;

  update public.person_invites
  set
    redeemed_at = now(),
    redeemed_by = auth.uid()
  where id = invite.id;
end;
$$;

revoke all on function public.redeem_person_invite(text) from public;
grant execute on function public.redeem_person_invite(text) to authenticated;
