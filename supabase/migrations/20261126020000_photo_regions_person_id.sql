-- Link face boxes to tree people
alter table public.photo_regions
  add column person_id text references public.people (id) on delete set null;

create index photo_regions_person_id_idx on public.photo_regions (person_id);
