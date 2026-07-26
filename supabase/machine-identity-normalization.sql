-- Robust machine identity normalization
-- Internal relationships continue to use UUIDs. User-facing and analytical workflows use the WTN identifier.
-- Safe to run more than once.

begin;

create extension if not exists pgcrypto;

-- 1. Keep agency and facility/location as separate fields.
alter table if exists public.locations
  add column if not exists location_name text;

update public.locations
set
  location_name = coalesce(
    nullif(btrim(location_name), ''),
    nullif(btrim(substring(agency from '\(([^()]*)\)\s*$')), ''),
    'Unspecified Location'
  ),
  agency = coalesce(
    nullif(btrim(regexp_replace(agency, '\s*\([^()]*\)\s*$', '')), ''),
    'Unassigned Agency'
  ),
  machine_id = upper(btrim(machine_id))
where machine_id is not null;

create unique index if not exists locations_machine_id_uidx
  on public.locations (machine_id)
  where machine_id is not null and btrim(machine_id) <> '';

-- 2. Ensure the internal machine directory has one UUID per location and one WTN per machine.
create unique index if not exists machines_location_id_uidx
  on public.machines (location_id);

create unique index if not exists machines_machine_id_uidx
  on public.machines (machine_id);

update public.machines
set machine_id = upper(btrim(machine_id))
where machine_id is not null;

-- Server-side sync avoids browser RLS/upsert drift.
create or replace function public.sync_machines_from_locations()
returns table (
  inserted_count bigint,
  updated_count bigint,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted bigint := 0;
  v_updated bigint := 0;
  v_total bigint := 0;
begin
  select count(*) into v_inserted
  from public.locations l
  left join public.machines m on m.location_id = l.id
  where nullif(btrim(l.machine_id), '') is not null
    and m.id is null;

  select count(*) into v_updated
  from public.locations l
  join public.machines m on m.location_id = l.id
  where nullif(btrim(l.machine_id), '') is not null
    and (
      m.machine_id is distinct from upper(btrim(l.machine_id))
      or m.active is distinct from (lower(l.machine_status::text) = 'active')
    );

  -- If a WTN already exists, attach it to the authoritative location first.
  update public.machines m
  set
    location_id = l.id,
    machine_id = upper(btrim(l.machine_id)),
    active = (lower(l.machine_status::text) = 'active'),
    updated_at = now()
  from public.locations l
  where nullif(btrim(l.machine_id), '') is not null
    and m.machine_id = upper(btrim(l.machine_id));

  insert into public.machines (
    location_id,
    machine_id,
    capacity,
    current_inventory,
    supplier_reliability,
    max_orderable_quantity,
    active
  )
  select
    l.id,
    upper(btrim(l.machine_id)),
    0,
    0,
    1,
    0,
    (lower(l.machine_status::text) = 'active')
  from public.locations l
  where nullif(btrim(l.machine_id), '') is not null
  on conflict (location_id) do update
  set
    machine_id = excluded.machine_id,
    active = excluded.active,
    updated_at = now();

  select count(*) into v_total from public.machines;
  return query select v_inserted, v_updated, v_total;
end;
$$;

select * from public.sync_machines_from_locations();

-- 3. Preserve both identities on every event.
-- machine_id remains the UUID foreign key for backwards compatibility.
-- machine_wtn_id is the durable business identifier used for display, filtering, exports, and diagnostics.
alter table if exists public.machine_events
  add column if not exists machine_wtn_id text;

update public.machine_events e
set machine_wtn_id = m.machine_id
from public.machines m
where e.machine_id = m.id
  and e.machine_wtn_id is distinct from m.machine_id;

create index if not exists machine_events_machine_wtn_datetime_idx
  on public.machine_events (machine_wtn_id, event_datetime desc);

create index if not exists machine_events_source_name_idx
  on public.machine_events (source_machine_name);

create or replace function public.set_machine_event_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wtn text;
begin
  select machine_id into v_wtn
  from public.machines
  where id = new.machine_id;

  if v_wtn is null then
    raise exception 'Unknown machine UUID: %', new.machine_id;
  end if;

  new.machine_wtn_id := v_wtn;
  return new;
end;
$$;

drop trigger if exists trg_machine_events_identity on public.machine_events;
create trigger trg_machine_events_identity
before insert or update of machine_id, machine_wtn_id
on public.machine_events
for each row execute function public.set_machine_event_identity();

create or replace function public.propagate_machine_wtn_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.machine_id is distinct from old.machine_id then
    update public.machine_events
    set machine_wtn_id = new.machine_id
    where machine_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_machines_propagate_wtn on public.machines;
create trigger trg_machines_propagate_wtn
after update of machine_id on public.machines
for each row execute function public.propagate_machine_wtn_change();

-- 4. One canonical directory for all pages and reports.
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

-- 5. Aggregate from events first, then enrich with directory metadata.
drop function if exists public.get_machine_log_machine_summary();
create function public.get_machine_log_machine_summary()
returns table (
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
    e.machine_id as machine_uuid,
    coalesce(max(e.machine_wtn_id), max(m.machine_id)) as machine_wtn_id,
    coalesce(max(l.location_name), max(e.source_machine_name), 'Unknown Machine') as source_name,
    count(*)::bigint as event_count,
    coalesce(sum(
      case
        when lower(coalesce(e.action, '')) like '%dispens%'
          or lower(coalesce(e.event_type, '')) like '%dispens%'
        then greatest(coalesce(e.quantity, 1), 1)
        else 0
      end
    ), 0)::bigint as units_dispensed,
    count(*) filter (
      where lower(coalesce(e.status, '')) like '%fail%'
         or nullif(btrim(coalesce(e.error_type, '')), '') is not null
    )::bigint as failed_count,
    count(*) filter (
      where lower(coalesce(e.message, '')) like '%out of stock%'
         or lower(coalesce(e.error_type, '')) like '%stock%'
         or lower(coalesce(e.status, '')) like '%stockout%'
    )::bigint as stockout_count,
    min(e.event_datetime) as first_activity,
    max(e.event_datetime) as last_activity
  from public.machine_events e
  left join public.machines m on m.id = e.machine_id
  left join public.locations l on l.id = m.location_id
  group by e.machine_id
  order by coalesce(max(l.location_name), max(e.source_machine_name), 'Unknown Machine');
$$;

drop function if exists public.get_machine_log_totals();
create function public.get_machine_log_totals()
returns table (
  total_events bigint,
  units_dispensed bigint,
  unauthorized_attempts bigint,
  out_of_stock_attempts bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(
      case
        when lower(coalesce(action, '')) like '%dispens%'
          or lower(coalesce(event_type, '')) like '%dispens%'
        then greatest(coalesce(quantity, 1), 1)
        else 0
      end
    ), 0)::bigint,
    count(*) filter (
      where lower(coalesce(status, '')) like '%unauthor%'
         or lower(coalesce(message, '')) like '%unauthor%'
         or lower(coalesce(error_type, '')) like '%unauthor%'
    )::bigint,
    count(*) filter (
      where lower(coalesce(message, '')) like '%out of stock%'
         or lower(coalesce(error_type, '')) like '%stock%'
         or lower(coalesce(status, '')) like '%stockout%'
    )::bigint
  from public.machine_events;
$$;

-- 6. Diagnostic view makes identity problems visible instead of silently returning zeros.
create or replace view public.machine_identity_health as
select
  e.machine_id as event_machine_uuid,
  max(e.machine_wtn_id) as event_wtn_id,
  max(m.machine_id) as directory_wtn_id,
  max(e.source_machine_name) as source_machine_name,
  count(*) as event_count,
  case
    when m.id is null then 'ORPHANED_UUID'
    when max(e.machine_wtn_id) is distinct from max(m.machine_id) then 'WTN_MISMATCH'
    else 'HEALTHY'
  end as identity_status
from public.machine_events e
left join public.machines m on m.id = e.machine_id
group by e.machine_id, m.id;

-- 7. Browser permissions for the current local-development phase.
grant usage on schema public to anon, authenticated;
grant select on public.machine_directory, public.machine_identity_health to anon, authenticated;
grant execute on function public.sync_machines_from_locations() to anon, authenticated;
grant execute on function public.get_machine_log_machine_summary() to anon, authenticated;
grant execute on function public.get_machine_log_totals() to anon, authenticated;

grant select, insert, update, delete on public.machine_events to anon, authenticated;

alter table public.machine_events enable row level security;
drop policy if exists "machine_events_dev_select" on public.machine_events;
drop policy if exists "machine_events_dev_insert" on public.machine_events;
drop policy if exists "machine_events_dev_update" on public.machine_events;
drop policy if exists "machine_events_dev_delete" on public.machine_events;
create policy "machine_events_dev_select" on public.machine_events for select to anon, authenticated using (true);
create policy "machine_events_dev_insert" on public.machine_events for insert to anon, authenticated with check (true);
create policy "machine_events_dev_update" on public.machine_events for update to anon, authenticated using (true) with check (true);
create policy "machine_events_dev_delete" on public.machine_events for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';

commit;

-- Verification queries (run after the transaction completes):
-- select * from public.sync_machines_from_locations();
-- select * from public.machine_identity_health order by event_count desc;
-- select * from public.get_machine_log_machine_summary();
