begin;

create table if not exists public.data_import_history (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  module_name text not null,
  source_file text,
  records_received integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  records_skipped integer not null default 0,
  records_rejected integer not null default 0,
  status text not null default 'completed',
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.data_import_history enable row level security;
grant select, insert, update, delete on public.data_import_history to anon, authenticated;

drop policy if exists data_import_history_dev_all on public.data_import_history;
create policy data_import_history_dev_all
on public.data_import_history
for all
to anon, authenticated
using (true)
with check (true);

create or replace function public.get_data_management_summary()
returns table (
  locations bigint,
  machines bigint,
  planogram_machines bigint,
  planogram_selections bigint,
  machine_events bigint,
  restock_events bigint,
  technicians bigint,
  products bigint,
  locations_missing_coordinates bigint,
  machines_without_planograms bigint,
  planograms_without_machine bigint,
  events_without_machine bigint,
  restocks_without_machine bigint,
  restocks_without_technician bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.locations)::bigint,
    (select count(*) from public.machines)::bigint,
    (select count(distinct coalesce(p.machine_uuid, p.machine_id)) from public.machine_planogram_items p)::bigint,
    (select count(*) from public.machine_planogram_items)::bigint,
    (select count(*) from public.machine_events)::bigint,
    (select count(*) from public.restock_events)::bigint,
    (select count(*) from public.technicians)::bigint,
    (select count(distinct nullif(lower(btrim(p.product_name)), '')) from public.machine_planogram_items p)::bigint,
    (select count(*) from public.locations l where l.latitude is null or l.longitude is null)::bigint,
    (select count(*) from public.machines m where not exists (
      select 1 from public.machine_planogram_items p
      where coalesce(p.machine_uuid, p.machine_id) = m.id
         or p.machine_wtn_id = m.machine_id
    ))::bigint,
    (select count(*) from public.machine_planogram_items p where coalesce(p.machine_uuid, p.machine_id) is null)::bigint,
    (select count(*) from public.machine_events e where coalesce(e.machine_uuid, e.machine_id) is null)::bigint,
    (select count(*) from public.restock_events r where coalesce(r.machine_uuid, r.machine_id) is null)::bigint,
    (select count(*) from public.restock_events r where r.technician_id is null)::bigint;
$$;

grant execute on function public.get_data_management_summary() to anon, authenticated;
notify pgrst, 'reload schema';
commit;
