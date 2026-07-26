begin;

create table if not exists public.machine_name_aliases (
  id uuid primary key default gen_random_uuid(),
  source_machine_name text not null unique,
  machine_id uuid references public.machines(id) on delete cascade,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_name_aliases_valid_target check (
    (ignored = true and machine_id is null)
    or
    (ignored = false and machine_id is not null)
  )
);

create index if not exists idx_machine_name_aliases_machine_id
  on public.machine_name_aliases(machine_id);

grant select, insert, update, delete
on public.machine_name_aliases
to anon, authenticated;

alter table public.machine_name_aliases enable row level security;

drop policy if exists "machine_name_aliases_dev_select" on public.machine_name_aliases;
drop policy if exists "machine_name_aliases_dev_insert" on public.machine_name_aliases;
drop policy if exists "machine_name_aliases_dev_update" on public.machine_name_aliases;
drop policy if exists "machine_name_aliases_dev_delete" on public.machine_name_aliases;

create policy "machine_name_aliases_dev_select"
on public.machine_name_aliases for select
to anon, authenticated using (true);

create policy "machine_name_aliases_dev_insert"
on public.machine_name_aliases for insert
to anon, authenticated with check (true);

create policy "machine_name_aliases_dev_update"
on public.machine_name_aliases for update
to anon, authenticated using (true) with check (true);

create policy "machine_name_aliases_dev_delete"
on public.machine_name_aliases for delete
to anon, authenticated using (true);

notify pgrst, 'reload schema';

commit;
