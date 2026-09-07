-- Add IEC source/origin to an existing BFAR IEC Inventory database.
alter table public.iec_materials
  add column if not exists source text;

create index if not exists iec_materials_source_idx
  on public.iec_materials using btree (source);
