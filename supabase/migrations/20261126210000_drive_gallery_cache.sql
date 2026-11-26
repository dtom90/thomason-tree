-- Shared gallery list cache for drive-list (avoids re-walking Drive on every open).
-- Edge functions read/write via the service role; not exposed to the Data API.
create table public.drive_gallery_cache (
  root_id text primary key,
  payload jsonb not null,
  refreshed_at timestamptz not null default now()
);

alter table public.drive_gallery_cache enable row level security;

revoke all on table public.drive_gallery_cache from public;
revoke all on table public.drive_gallery_cache from anon;
revoke all on table public.drive_gallery_cache from authenticated;
grant select, insert, update, delete on table public.drive_gallery_cache to service_role;
