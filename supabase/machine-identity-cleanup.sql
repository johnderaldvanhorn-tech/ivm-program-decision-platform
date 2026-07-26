-- IVM robust machine identity cleanup
-- Safe to run repeatedly. UUIDs are internal keys; WTN IDs are business identifiers.
-- Legacy machine_id UUID columns remain synchronized for backward compatibility.

begin;

create extension if not exists pgcrypto;

-- Normalize the authoritative machine directory.
update public.locations
set machine_id = upper(btrim(machine_id))
where machine_id is not null;

update public.machines
set machine_id = upper(btrim(machine_id))
where machine_id is not null;

create unique index if not exists locations_machine_id_uidx
  on public.locations(machine_id)
  where nullif(btrim(machine_id), '') is not null;

create unique index if not exists machines_machine_id_uidx
  on public.machines(machine_id);

create unique index if not exists machines_location_id_uidx
  on public.machines(location_id);

-- Keep machines synchronized from the location system of record.
create or replace function public.sync_machines_from_locations()
returns table(inserted_count bigint, updated_count bigint, total_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
  v_after bigint;
begin
  select count(*) into v_before from public.machines;

  insert into public.machines(
    location_id, machine_id, capacity, current_inventory,
    supplier_reliability, max_orderable_quantity, active
  )
  select
    l.id,
    upper(btrim(l.machine_id)),
    0,
    0,
    1,
    0,
    lower(l.machine_status::text) = 'active'
  from public.locations l
  where nullif(btrim(l.machine_id), '') is not null
  on conflict (location_id) do update
  set machine_id = excluded.machine_id,
      active = excluded.active,
      updated_at = now();

  select count(*) into v_after from public.machines;

  return query
  select greatest(v_after - v_before, 0),
         greatest(v_before - (select count(*) from public.machines m join public.locations l on l.id=m.location_id where m.machine_id=upper(btrim(l.machine_id))), 0),
         v_after;
end;
$$;

select * from public.sync_machines_from_locations();

-- Canonical machine directory used by all UI pages and reports.
create or replace view public.machine_directory as
select
  m.id as machine_uuid,
  m.machine_id as machine_wtn_id,
  m.location_id,
  l.agency,
  l.location_name,
  l.address,
  l.city,
  l.state,
  l.zip,
  l.latitude,
  l.longitude,
  l.machine_status,
  m.active,
  m.capacity,
  m.current_inventory,
  m.supplier_reliability,
  m.max_orderable_quantity
from public.machines m
join public.locations l on l.id = m.location_id;

-- Add explicit identity columns to all machine-related tables.
alter table if exists public.machine_events
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.machine_planogram_items
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.inventory_periods
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.safety_stock
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.service_tasks
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.service_assignments
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.demand_evaluation_parameters
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

alter table if exists public.machine_name_aliases
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text;

-- Backfill explicit identities from legacy UUID columns.
update public.machine_events t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id)
  and (t.machine_uuid is null or t.machine_wtn_id is null or t.machine_wtn_id <> m.machine_id);

update public.machine_planogram_items t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id)
  and (t.machine_uuid is null or t.machine_wtn_id is null or t.machine_wtn_id <> m.machine_id);

update public.inventory_periods t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

update public.safety_stock t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

update public.service_tasks t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

update public.service_assignments t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

update public.demand_evaluation_parameters t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

update public.machine_name_aliases t
set machine_uuid = coalesce(t.machine_uuid, t.machine_id),
    machine_wtn_id = coalesce(nullif(t.machine_wtn_id, ''), m.machine_id)
from public.machines m
where m.id = coalesce(t.machine_uuid, t.machine_id);

-- Foreign keys for the explicit UUID columns.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='machine_events_machine_uuid_fkey') then
    alter table public.machine_events add constraint machine_events_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='machine_planogram_items_machine_uuid_fkey') then
    alter table public.machine_planogram_items add constraint machine_planogram_items_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='inventory_periods_machine_uuid_fkey') then
    alter table public.inventory_periods add constraint inventory_periods_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='safety_stock_machine_uuid_fkey') then
    alter table public.safety_stock add constraint safety_stock_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='service_tasks_machine_uuid_fkey') then
    alter table public.service_tasks add constraint service_tasks_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='service_assignments_machine_uuid_fkey') then
    alter table public.service_assignments add constraint service_assignments_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if to_regclass('public.demand_evaluation_parameters') is not null and not exists (select 1 from pg_constraint where conname='demand_evaluation_parameters_machine_uuid_fkey') then
    alter table public.demand_evaluation_parameters add constraint demand_evaluation_parameters_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
  if to_regclass('public.machine_name_aliases') is not null and not exists (select 1 from pg_constraint where conname='machine_name_aliases_machine_uuid_fkey') then
    alter table public.machine_name_aliases add constraint machine_name_aliases_machine_uuid_fkey foreign key(machine_uuid) references public.machines(id) on delete cascade;
  end if;
end $$;

-- Generic trigger helper: UUID is authoritative; WTN is derived; legacy UUID stays synchronized.
create or replace function public.sync_machine_identity_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uuid uuid;
  v_wtn text;
begin
  v_uuid := coalesce(new.machine_uuid, new.machine_id);

  if v_uuid is null and nullif(btrim(new.machine_wtn_id), '') is not null then
    select id, machine_id into v_uuid, v_wtn
    from public.machines
    where machine_id = upper(btrim(new.machine_wtn_id));
  else
    select id, machine_id into v_uuid, v_wtn
    from public.machines
    where id = v_uuid;
  end if;

  if v_uuid is null or v_wtn is null then
    raise exception 'Unable to resolve machine identity. machine_uuid=%, machine_wtn_id=%', new.machine_uuid, new.machine_wtn_id;
  end if;

  new.machine_uuid := v_uuid;
  new.machine_wtn_id := v_wtn;
  new.machine_id := v_uuid; -- legacy UUID column
  return new;
end;
$$;

-- Install synchronization triggers where legacy machine_id exists.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'machine_events','machine_planogram_items','inventory_periods','safety_stock',
    'service_tasks','service_assignments','demand_evaluation_parameters','machine_name_aliases'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists trg_%I_machine_identity on public.%I', tbl, tbl);
      execute format('create trigger trg_%I_machine_identity before insert or update of machine_id, machine_uuid, machine_wtn_id on public.%I for each row execute function public.sync_machine_identity_columns()', tbl, tbl);
    end if;
  end loop;
end $$;

-- Propagate a changed WTN identifier to all denormalized business-ID fields.
create or replace function public.propagate_machine_wtn_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.machine_id is distinct from old.machine_id then
    update public.locations set machine_id = new.machine_id where id = new.location_id;
    if to_regclass('public.machine_events') is not null then update public.machine_events set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.machine_planogram_items') is not null then update public.machine_planogram_items set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.inventory_periods') is not null then update public.inventory_periods set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.safety_stock') is not null then update public.safety_stock set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.service_tasks') is not null then update public.service_tasks set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.service_assignments') is not null then update public.service_assignments set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.demand_evaluation_parameters') is not null then update public.demand_evaluation_parameters set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
    if to_regclass('public.machine_name_aliases') is not null then update public.machine_name_aliases set machine_wtn_id=new.machine_id where machine_uuid=new.id; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_machines_propagate_wtn_id on public.machines;
create trigger trg_machines_propagate_wtn_id
after update of machine_id on public.machines
for each row execute function public.propagate_machine_wtn_id();

-- Explicit indexes and conflict keys.
create index if not exists machine_events_machine_uuid_datetime_idx on public.machine_events(machine_uuid, event_datetime desc);
create index if not exists machine_events_machine_wtn_datetime_idx on public.machine_events(machine_wtn_id, event_datetime desc);
create index if not exists machine_planogram_items_machine_uuid_idx on public.machine_planogram_items(machine_uuid, selection_number);
create index if not exists machine_planogram_items_machine_wtn_idx on public.machine_planogram_items(machine_wtn_id, selection_number);

create unique index if not exists machine_planogram_items_machine_uuid_selection_uidx
  on public.machine_planogram_items(machine_uuid, selection_number);

create unique index if not exists inventory_periods_machine_uuid_period_uidx
  on public.inventory_periods(machine_uuid, period_date);

create unique index if not exists safety_stock_machine_uuid_uidx
  on public.safety_stock(machine_uuid);

create unique index if not exists demand_evaluation_parameters_machine_uuid_product_uidx
  on public.demand_evaluation_parameters(machine_uuid, product_filter);

-- Rebuild machine-log aggregate using explicit identity columns.
drop function if exists public.get_machine_log_machine_summary();
create function public.get_machine_log_machine_summary()
returns table(
  machine_uuid uuid,
  machine_wtn_id text,
  source_name text,
  event_count bigint,
  units_dispensed bigint,
  failed_count bigint,
  stockout_count bigint,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.machine_uuid,
    max(e.machine_wtn_id) as machine_wtn_id,
    coalesce(max(d.location_name), max(e.source_machine_name), 'Unknown Machine') as source_name,
    count(*)::bigint,
    coalesce(sum(case when lower(coalesce(e.action,'')) like '%dispens%' or lower(coalesce(e.event_type,'')) like '%dispens%' then greatest(coalesce(e.quantity,1),1) else 0 end),0)::bigint,
    count(*) filter(where lower(coalesce(e.status,'')) like '%fail%' or nullif(btrim(coalesce(e.error_type,'')),'') is not null)::bigint,
    count(*) filter(where lower(coalesce(e.message,'')) like '%out of stock%' or lower(coalesce(e.error_type,'')) like '%stock%' or lower(coalesce(e.status,'')) like '%stockout%')::bigint,
    min(e.event_datetime),
    max(e.event_datetime)
  from public.machine_events e
  left join public.machine_directory d on d.machine_uuid=e.machine_uuid
  where e.machine_uuid is not null
  group by e.machine_uuid
  order by coalesce(max(d.location_name), max(e.source_machine_name), 'Unknown Machine');
$$;

-- Rebuild demand functions using explicit UUID columns.
drop function if exists public.get_demand_evaluation_summary(uuid,text,date,date);
create function public.get_demand_evaluation_summary(
  p_machine_uuid uuid,
  p_product_filter text default 'All Products',
  p_start_date date default null,
  p_end_date date default null
)
returns table(
  capacity numeric, selection_count bigint, successful_transactions bigint,
  dispensed_units numeric, requested_from_logs numeric, restocked_from_logs numeric,
  stockout_events bigint, evaluation_days integer,
  first_activity timestamptz, last_activity timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  with filtered_items as (
    select * from public.machine_planogram_items p
    where p.machine_uuid=p_machine_uuid
      and (coalesce(p_product_filter,'All Products')='All Products' or lower(coalesce(p.product_name,'')) like '%'||lower(p_product_filter)||'%')
  ), filtered_events as (
    select * from public.machine_events e
    where e.machine_uuid=p_machine_uuid
      and (p_start_date is null or e.event_datetime>=p_start_date::timestamptz)
      and (p_end_date is null or e.event_datetime<(p_end_date+1)::timestamptz)
      and (coalesce(p_product_filter,'All Products')='All Products' or lower(coalesce(e.product,'')) like '%'||lower(p_product_filter)||'%')
  )
  select
    coalesce((select sum(max_level) from filtered_items),0)::numeric,
    (select count(*) from filtered_items)::bigint,
    count(*) filter(where lower(coalesce(status,''))='success' and (lower(coalesce(action,'')) like '%transaction%' or lower(coalesce(event_type,'')) like '%dispens%'))::bigint,
    coalesce(sum(case when lower(coalesce(status,''))='success' and (lower(coalesce(action,'')) like '%transaction%' or lower(coalesce(event_type,'')) like '%dispens%') then greatest(coalesce(quantity,1),1) else 0 end),0)::numeric,
    coalesce(sum(case when lower(coalesce(action,'')||' '||coalesce(message,'')||' '||coalesce(event_type,'')) ~ '(request|order)' then greatest(coalesce(quantity,1),1) else 0 end),0)::numeric,
    coalesce(sum(case when lower(coalesce(action,'')||' '||coalesce(message,'')||' '||coalesce(event_type,'')) ~ '(restock|replenish|refill|fill machine)' then greatest(coalesce(quantity,1),1) else 0 end),0)::numeric,
    count(*) filter(where lower(coalesce(message,'')||' '||coalesce(error_type,'')||' '||coalesce(status,'')) ~ '(out of stock|stockout)')::bigint,
    greatest(1,(coalesce(p_end_date,max(event_datetime)::date,current_date)-coalesce(p_start_date,min(event_datetime)::date,current_date)+1))::integer,
    min(event_datetime), max(event_datetime)
  from filtered_events;
$$;

drop function if exists public.get_demand_evaluation_selection_summary(uuid,text,date,date);
create function public.get_demand_evaluation_selection_summary(
  p_machine_uuid uuid,
  p_product_filter text default 'All Products',
  p_start_date date default null,
  p_end_date date default null
)
returns table(
  selection_number text, product_name text, item_number text,
  capacity numeric, critical_level numeric, low_level numeric, par_level numeric,
  dispensed_units numeric, requested_units numeric, restocked_units numeric,
  stockout_events bigint
)
language sql
stable
security definer
set search_path=public
as $$
  select p.selection_number,p.product_name,p.item_number,p.max_level::numeric,
    p.critical_level::numeric,p.low_level::numeric,p.par_level::numeric,
    coalesce(sum(case when lower(coalesce(e.status,''))='success' and (lower(coalesce(e.action,'')) like '%transaction%' or lower(coalesce(e.event_type,'')) like '%dispens%') then greatest(coalesce(e.quantity,1),1) else 0 end),0)::numeric,
    coalesce(sum(case when lower(coalesce(e.action,'')||' '||coalesce(e.message,'')||' '||coalesce(e.event_type,'')) ~ '(request|order)' then greatest(coalesce(e.quantity,1),1) else 0 end),0)::numeric,
    coalesce(sum(case when lower(coalesce(e.action,'')||' '||coalesce(e.message,'')||' '||coalesce(e.event_type,'')) ~ '(restock|replenish|refill|fill machine)' then greatest(coalesce(e.quantity,1),1) else 0 end),0)::numeric,
    count(e.id) filter(where lower(coalesce(e.message,'')||' '||coalesce(e.error_type,'')||' '||coalesce(e.status,'')) ~ '(out of stock|stockout)')::bigint
  from public.machine_planogram_items p
  left join public.machine_events e on e.machine_uuid=p.machine_uuid
    and btrim(coalesce(e.selection,''))=btrim(p.selection_number)
    and (p_start_date is null or e.event_datetime>=p_start_date::timestamptz)
    and (p_end_date is null or e.event_datetime<(p_end_date+1)::timestamptz)
  where p.machine_uuid=p_machine_uuid
    and (coalesce(p_product_filter,'All Products')='All Products' or lower(coalesce(p.product_name,'')) like '%'||lower(p_product_filter)||'%')
  group by p.selection_number,p.product_name,p.item_number,p.max_level,p.critical_level,p.low_level,p.par_level
  order by p.selection_number;
$$;

-- Health diagnostics: mismatches must be visible, never silently converted to zero.
create or replace view public.machine_identity_health as
with event_counts as (
  select machine_uuid, max(machine_wtn_id) machine_wtn_id, count(*) event_count
  from public.machine_events group by machine_uuid
), planogram_counts as (
  select machine_uuid, max(machine_wtn_id) machine_wtn_id, count(*) planogram_count
  from public.machine_planogram_items group by machine_uuid
)
select
  d.machine_uuid,
  d.machine_wtn_id,
  d.agency,
  d.location_name,
  coalesce(e.event_count,0) as event_count,
  coalesce(p.planogram_count,0) as planogram_count,
  case
    when e.machine_uuid is not null and e.machine_wtn_id is distinct from d.machine_wtn_id then 'EVENT_WTN_MISMATCH'
    when p.machine_uuid is not null and p.machine_wtn_id is distinct from d.machine_wtn_id then 'PLANOGRAM_WTN_MISMATCH'
    else 'HEALTHY'
  end as identity_status
from public.machine_directory d
left join event_counts e on e.machine_uuid=d.machine_uuid
left join planogram_counts p on p.machine_uuid=d.machine_uuid;

grant select on public.machine_directory, public.machine_identity_health to anon, authenticated;
grant execute on function public.sync_machines_from_locations() to anon, authenticated;
grant execute on function public.get_machine_log_machine_summary() to anon, authenticated;
grant execute on function public.get_demand_evaluation_summary(uuid,text,date,date) to anon, authenticated;
grant execute on function public.get_demand_evaluation_selection_summary(uuid,text,date,date) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
