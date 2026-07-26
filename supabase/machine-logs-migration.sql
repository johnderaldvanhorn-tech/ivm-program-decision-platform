-- Run once in Supabase SQL Editor before using the Machine Logs page.
create table if not exists public.machine_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  event_datetime timestamptz not null,
  source_location_name text,
  source_machine_name text not null,
  action text not null,
  selection text,
  product text,
  employee text,
  passcode text,
  quantity numeric,
  message text,
  status text,
  event_type text,
  scale_serial text,
  scale_variance numeric,
  employee_number text,
  error_type text,
  question_name text,
  question_number text,
  question text,
  dispense_type text,
  answer text,
  source_file text,
  import_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists machine_events_machine_datetime_idx on public.machine_events(machine_id, event_datetime desc);
create index if not exists machine_events_action_idx on public.machine_events(action);
create index if not exists machine_events_status_idx on public.machine_events(status);

alter table public.machine_events enable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.machine_events to anon, authenticated;

drop policy if exists "machine_events_dev_select" on public.machine_events;
drop policy if exists "machine_events_dev_insert" on public.machine_events;
drop policy if exists "machine_events_dev_update" on public.machine_events;
drop policy if exists "machine_events_dev_delete" on public.machine_events;

-- Temporary development policies while the local app does not require login.
create policy "machine_events_dev_select" on public.machine_events for select to anon, authenticated using (true);
create policy "machine_events_dev_insert" on public.machine_events for insert to anon, authenticated with check (true);
create policy "machine_events_dev_update" on public.machine_events for update to anon, authenticated using (true) with check (true);
create policy "machine_events_dev_delete" on public.machine_events for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
