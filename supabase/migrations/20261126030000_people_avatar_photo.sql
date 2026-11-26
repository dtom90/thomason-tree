-- Profile / avatar photo for tree cards (Drive file + optional face region)
alter table public.people
  add column avatar_drive_file_id text,
  add column avatar_region_id uuid references public.photo_regions (id) on delete set null;

create index people_avatar_drive_file_id_idx on public.people (avatar_drive_file_id)
  where avatar_drive_file_id is not null;
