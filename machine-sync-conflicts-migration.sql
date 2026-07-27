create table if not exists public.machine_name_aliases (
  source_machine_name text primary key,
  machine_id uuid null references public.machines(id) on delete set null,
  machine_uuid uuid null references public.machines(id) on delete set null,
  machine_wtn_id text null,
  ignored boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.machine_name_aliases enable row level security;
drop policy if exists "Authenticated users manage machine aliases" on public.machine_name_aliases;
create policy "Authenticated users manage machine aliases" on public.machine_name_aliases for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.machine_name_aliases to authenticated;
create index if not exists machine_name_aliases_wtn_idx on public.machine_name_aliases(machine_wtn_id);
create index if not exists machine_name_aliases_uuid_idx on public.machine_name_aliases(machine_uuid);
