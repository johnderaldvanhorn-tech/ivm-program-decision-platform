begin;

create extension if not exists pgcrypto;

create table if not exists public.restock_events (
  id uuid primary key default gen_random_uuid(),
  machine_uuid uuid not null references public.machines(id) on delete cascade,
  machine_wtn_id text not null,
  technician_id uuid not null references public.technicians(id) on delete restrict,
  source_machine_name text not null,
  source_location_name text,
  source_restock_person text not null,
  selection_number text,
  product_name text,
  package_quantity numeric not null default 1,
  restock_quantity numeric not null default 0,
  restock_datetime timestamptz not null,
  picked_from text,
  restock_action text,
  source_file text,
  import_key text not null unique,
  created_at timestamptz not null default now(),
  check (package_quantity >= 0),
  check (restock_quantity >= 0)
);

create index if not exists restock_events_machine_date_idx on public.restock_events(machine_uuid, restock_datetime);
create index if not exists restock_events_technician_date_idx on public.restock_events(technician_id, restock_datetime);
create index if not exists restock_events_wtn_idx on public.restock_events(machine_wtn_id);

create table if not exists public.restock_machine_aliases (
  id uuid primary key default gen_random_uuid(),
  source_machine_name text not null unique,
  machine_uuid uuid references public.machines(id) on delete cascade,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ignored and machine_uuid is null) or (not ignored and machine_uuid is not null))
);

create table if not exists public.technician_name_aliases (
  id uuid primary key default gen_random_uuid(),
  source_person_name text not null unique,
  technician_id uuid references public.technicians(id) on delete cascade,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ignored and technician_id is null) or (not ignored and technician_id is not null))
);

insert into public.program_parameters(parameter_name, parameter_value, parameter_group, description)
values
  ('staffing_base_visit_hours', 0.25, 'staffing', 'Base service time per distinct machine visit'),
  ('staffing_hours_per_unit', 0.003, 'staffing', 'Incremental service time per unit replenished'),
  ('staffing_hours_per_selection', 0.02, 'staffing', 'Incremental service time per selection serviced')
on conflict (parameter_name) do nothing;

create or replace function public.set_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_restock_machine_alias_updated_at on public.restock_machine_aliases;
create trigger trg_restock_machine_alias_updated_at before update on public.restock_machine_aliases
for each row execute function public.set_updated_at_generic();

drop trigger if exists trg_technician_name_alias_updated_at on public.technician_name_aliases;
create trigger trg_technician_name_alias_updated_at before update on public.technician_name_aliases
for each row execute function public.set_updated_at_generic();

-- Keep WTN identity synchronized with the canonical machine directory.
create or replace function public.sync_restock_machine_identity()
returns trigger language plpgsql as $$
begin
  select m.machine_id into new.machine_wtn_id from public.machines m where m.id = new.machine_uuid;
  if new.machine_wtn_id is null then raise exception 'No machine found for UUID %', new.machine_uuid; end if;
  return new;
end; $$;

drop trigger if exists trg_sync_restock_machine_identity on public.restock_events;
create trigger trg_sync_restock_machine_identity before insert or update of machine_uuid on public.restock_events
for each row execute function public.sync_restock_machine_identity();

-- Distinct visit = one technician at one machine at one timestamp. The report has one row per selection.
drop function if exists public.get_staffing_technician_summary();
create function public.get_staffing_technician_summary()
returns table (
  technician_id uuid,
  technician_name text,
  visit_count bigint,
  units_restocked numeric,
  machines_serviced bigint,
  selections_serviced bigint,
  first_activity timestamptz,
  last_activity timestamptz,
  estimated_hours numeric,
  max_hours numeric,
  utilization_pct numeric
)
language sql stable security definer set search_path=public as $$
with params as (
  select
    coalesce(max(parameter_value) filter (where parameter_name='staffing_base_visit_hours'),0.25) base_h,
    coalesce(max(parameter_value) filter (where parameter_name='staffing_hours_per_unit'),0.003) unit_h,
    coalesce(max(parameter_value) filter (where parameter_name='staffing_hours_per_selection'),0.02) selection_h
  from public.program_parameters
), visits as (
  select technician_id, machine_uuid, restock_datetime,
         sum(restock_quantity)::numeric units,
         count(distinct selection_number)::bigint selections
  from public.restock_events
  group by technician_id, machine_uuid, restock_datetime
), agg as (
  select t.id technician_id, t.technician_name,
         count(v.*)::bigint visit_count,
         coalesce(sum(v.units),0)::numeric units_restocked,
         count(distinct v.machine_uuid)::bigint machines_serviced,
         coalesce(sum(v.selections),0)::bigint selections_serviced,
         min(v.restock_datetime) first_activity,
         max(v.restock_datetime) last_activity,
         (count(v.*)*p.base_h + coalesce(sum(v.units),0)*p.unit_h + coalesce(sum(v.selections),0)*p.selection_h)::numeric estimated_hours,
         t.max_hours::numeric max_hours
  from public.technicians t cross join params p
  left join visits v on v.technician_id=t.id
  where t.active=true
  group by t.id,t.technician_name,t.max_hours,p.base_h,p.unit_h,p.selection_h
)
select *, case when max_hours>0 then estimated_hours/max_hours*100 else 0 end::numeric utilization_pct from agg
order by estimated_hours desc, technician_name;
$$;

drop function if exists public.get_staffing_machine_summary();
create function public.get_staffing_machine_summary()
returns table (
  machine_uuid uuid,
  machine_wtn_id text,
  agency text,
  location_name text,
  visit_count bigint,
  units_restocked numeric,
  technicians bigint,
  avg_units_per_visit numeric,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql stable security definer set search_path=public as $$
with visits as (
  select machine_uuid, restock_datetime, technician_id, sum(restock_quantity)::numeric units
  from public.restock_events
  group by machine_uuid, restock_datetime, technician_id
)
select m.id, m.machine_id,
       coalesce(l.agency,'Unassigned Agency'), coalesce(l.location_name,'Unnamed Location'),
       count(v.*)::bigint, coalesce(sum(v.units),0)::numeric,
       count(distinct v.technician_id)::bigint,
       case when count(v.*)>0 then coalesce(sum(v.units),0)/count(v.*) else 0 end::numeric,
       min(v.restock_datetime), max(v.restock_datetime)
from public.machines m
left join public.locations l on l.id=m.location_id
left join visits v on v.machine_uuid=m.id
group by m.id,m.machine_id,l.agency,l.location_name
having count(v.*)>0
order by coalesce(l.agency,''),coalesce(l.location_name,'');
$$;

grant usage on schema public to anon, authenticated;
grant select,insert,update,delete on public.restock_events, public.restock_machine_aliases, public.technician_name_aliases to anon, authenticated;
grant select,insert,update on public.technicians to anon, authenticated;
grant execute on function public.get_staffing_technician_summary() to anon, authenticated;
grant execute on function public.get_staffing_machine_summary() to anon, authenticated;

alter table public.restock_events enable row level security;
alter table public.restock_machine_aliases enable row level security;
alter table public.technician_name_aliases enable row level security;

-- Development policies. Replace with role-specific policies before production deployment.
do $$
declare t text;
begin
  foreach t in array array['restock_events','restock_machine_aliases','technician_name_aliases'] loop
    execute format('drop policy if exists %I on public.%I', t||'_dev_all', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t||'_dev_all', t);
  end loop;
end $$;

-- Existing technicians table may already have role policies; add a focused dev policy only if missing.
drop policy if exists technicians_restock_dev_all on public.technicians;
create policy technicians_restock_dev_all on public.technicians for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
commit;
