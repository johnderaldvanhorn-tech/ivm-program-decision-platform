-- Planogram + machine inventory migration
-- Run this once in Supabase SQL Editor.

create table if not exists public.machine_planogram_items (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  selection_number text not null,
  product_name text not null default '',
  item_number text not null default '',
  validation_mode text not null default '',
  critical_level integer not null default 0 check (critical_level >= 0),
  low_level integer not null default 0 check (low_level >= 0),
  par_level integer not null default 0 check (par_level >= 0),
  max_level integer not null default 0 check (max_level >= 0),
  current_quantity integer not null default 0 check (current_quantity >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  source_location_name text,
  source_machine_name text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_id, selection_number),
  check (current_quantity <= max_level or max_level = 0)
);

create index if not exists machine_planogram_items_machine_idx
  on public.machine_planogram_items(machine_id, selection_number);

alter table public.machine_planogram_items enable row level security;
grant select, insert, update, delete on public.machine_planogram_items to anon, authenticated;

drop policy if exists "machine_planogram_items_dev_select" on public.machine_planogram_items;
drop policy if exists "machine_planogram_items_dev_insert" on public.machine_planogram_items;
drop policy if exists "machine_planogram_items_dev_update" on public.machine_planogram_items;
drop policy if exists "machine_planogram_items_dev_delete" on public.machine_planogram_items;

create policy "machine_planogram_items_dev_select" on public.machine_planogram_items
  for select to anon, authenticated using (true);
create policy "machine_planogram_items_dev_insert" on public.machine_planogram_items
  for insert to anon, authenticated with check (true);
create policy "machine_planogram_items_dev_update" on public.machine_planogram_items
  for update to anon, authenticated using (true) with check (true);
create policy "machine_planogram_items_dev_delete" on public.machine_planogram_items
  for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
