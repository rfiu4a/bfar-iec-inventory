-- BFAR IEC Inventory - initial schema
-- Run this only in the NEW BFAR Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'inventory_staff', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.iec_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  topic text,
  opening_stock integer not null default 0 check (opening_stock >= 0),
  current_stock integer not null default 0 check (current_stock >= 0),
  minimum_stock integer not null default 10 check (minimum_stock >= 0),
  unit text not null default 'copies',
  location text,
  language text,
  version text,
  description text,
  image_path text,
  is_archived boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.iec_transactions (
  id uuid primary key default gen_random_uuid(),
  iec_material_id uuid not null references public.iec_materials(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('stock_in', 'stock_out')),
  quantity integer not null check (quantity > 0),
  transaction_date date not null default current_date,
  recipient_source text,
  reference_number text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists iec_materials_name_idx on public.iec_materials using btree (name);
create index if not exists iec_materials_type_idx on public.iec_materials using btree (type);
create index if not exists iec_transactions_material_date_idx on public.iec_transactions (iec_material_id, transaction_date, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists iec_materials_set_updated_at on public.iec_materials;
create trigger iec_materials_set_updated_at
before update on public.iec_materials
for each row execute function public.set_updated_at();

-- New Auth users automatically receive a viewer profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'User'), 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- This SECURITY DEFINER function is required because auth.users is owned by the auth system.
-- It only creates a profile for the exact new user row supplied by the auth trigger.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Keep current_stock synchronized with every immutable stock transaction.
create or replace function public.sync_iec_stock()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  stock_now integer;
begin
  new.created_by := auth.uid();

  select current_stock
    into stock_now
    from public.iec_materials
   where id = new.iec_material_id
   for update;

  if stock_now is null then
    raise exception 'IEC material not found';
  end if;

  if new.transaction_type = 'stock_out' and new.quantity > stock_now then
    raise exception 'Insufficient stock. Available quantity: %', stock_now;
  end if;

  update public.iec_materials
     set current_stock = case
       when new.transaction_type = 'stock_in' then current_stock + new.quantity
       else current_stock - new.quantity
     end
   where id = new.iec_material_id;

  return new;
end;
$$;

revoke all on function public.sync_iec_stock() from public;

drop trigger if exists iec_transactions_sync_stock on public.iec_transactions;
create trigger iec_transactions_sync_stock
before insert on public.iec_transactions
for each row execute function public.sync_iec_stock();

-- RLS
alter table public.profiles enable row level security;
alter table public.iec_materials enable row level security;
alter table public.iec_transactions enable row level security;

-- Profiles: a user can read only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

-- IEC inventory can be viewed by any signed-in user.
drop policy if exists "iec_materials_authenticated_read" on public.iec_materials;
create policy "iec_materials_authenticated_read"
on public.iec_materials for select
to authenticated
using (true);

-- Staff/admin can create IEC records.
drop policy if exists "iec_materials_staff_insert" on public.iec_materials;
create policy "iec_materials_staff_insert"
on public.iec_materials for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
  and (created_by is null or created_by = (select auth.uid()))
);

-- Staff/admin can edit IEC records. UPDATE also requires the SELECT policy above.
drop policy if exists "iec_materials_staff_update" on public.iec_materials;
create policy "iec_materials_staff_update"
on public.iec_materials for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
);

-- Only admins can permanently delete an IEC record.
drop policy if exists "iec_materials_admin_delete" on public.iec_materials;
create policy "iec_materials_admin_delete"
on public.iec_materials for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

-- Signed-in users may read the audit trail.
drop policy if exists "iec_transactions_authenticated_read" on public.iec_transactions;
create policy "iec_transactions_authenticated_read"
on public.iec_transactions for select
to authenticated
using (true);

-- Only staff/admin may add transactions. Transactions are intentionally immutable.
drop policy if exists "iec_transactions_staff_insert" on public.iec_transactions;
create policy "iec_transactions_staff_insert"
on public.iec_transactions for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
  and (created_by is null or created_by = (select auth.uid()))
);

-- Explicit Data API grants. RLS still decides which rows are accessible.
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.iec_materials to authenticated;
grant select, insert on public.iec_transactions to authenticated;

-- Public-read image bucket for IEC photos. Upload/edit/delete requires staff/admin.
insert into storage.buckets (id, name, public)
values ('iec-images', 'iec-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "iec_images_public_read" on storage.objects;
create policy "iec_images_public_read"
on storage.objects for select
to public
using (bucket_id = 'iec-images');

drop policy if exists "iec_images_staff_insert" on storage.objects;
create policy "iec_images_staff_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'iec-images'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
);

drop policy if exists "iec_images_staff_update" on storage.objects;
create policy "iec_images_staff_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'iec-images'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
)
with check (
  bucket_id = 'iec-images'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
);

drop policy if exists "iec_images_staff_delete" on storage.objects;
create policy "iec_images_staff_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'iec-images'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'inventory_staff')
  )
);
