-- Face boxes on Drive images
create table public.photo_regions (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  w double precision not null check (w > 0 and w <= 1),
  h double precision not null check (h > 0 and h <= 1),
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_regions_bounds check (x + w <= 1.0001 and y + h <= 1.0001)
);

create index photo_regions_drive_file_id_idx on public.photo_regions (drive_file_id);

-- Comments on a photo or a specific region
create table public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  region_id uuid references public.photo_regions (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index photo_comments_drive_file_id_idx on public.photo_comments (drive_file_id);
create index photo_comments_region_id_idx on public.photo_comments (region_id);

alter table public.photo_regions enable row level security;
alter table public.photo_comments enable row level security;

create policy "photo_regions_select_authenticated"
  on public.photo_regions for select
  to authenticated
  using (true);

create policy "photo_regions_insert_own"
  on public.photo_regions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "photo_regions_update_own"
  on public.photo_regions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "photo_regions_delete_own"
  on public.photo_regions for delete
  to authenticated
  using (user_id = auth.uid());

create policy "photo_comments_select_authenticated"
  on public.photo_comments for select
  to authenticated
  using (true);

create policy "photo_comments_insert_own"
  on public.photo_comments for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "photo_comments_update_own"
  on public.photo_comments for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "photo_comments_delete_own"
  on public.photo_comments for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.photo_regions to authenticated;
grant select, insert, update, delete on public.photo_comments to authenticated;
