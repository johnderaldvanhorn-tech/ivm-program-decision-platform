-- Agency deletion workflow
-- Run once in Supabase SQL Editor before using Delete Agency on the Locations page.

begin;

create or replace function public.delete_agency_cascade(
  p_agency text,
  p_confirmation text
)
returns table (
  deleted_agency text,
  deleted_locations bigint,
  deleted_machines bigint,
  deleted_machine_events bigint,
  deleted_restock_events bigint,
  deleted_planogram_items bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency text := btrim(coalesce(p_agency, ''));
  v_location_count bigint := 0;
  v_machine_count bigint := 0;
  v_event_count bigint := 0;
  v_restock_count bigint := 0;
  v_planogram_count bigint := 0;
begin
  if v_agency = '' then
    raise exception 'Agency name is required.';
  end if;
  if btrim(coalesce(p_confirmation, '')) <> v_agency then
    raise exception 'Confirmation must exactly match the agency name.';
  end if;

  create temporary table if not exists pg_temp.agency_delete_machines (
    machine_uuid uuid primary key,
    machine_wtn_id text
  ) on commit drop;
  truncate pg_temp.agency_delete_machines;

  insert into pg_temp.agency_delete_machines(machine_uuid, machine_wtn_id)
  select m.id, m.machine_id
  from public.machines m
  join public.locations l on l.id = m.location_id
  where l.agency = v_agency;

  select count(*) into v_location_count from public.locations where agency = v_agency;
  select count(*) into v_machine_count from pg_temp.agency_delete_machines;
  if v_location_count = 0 then
    raise exception 'Agency "%" was not found.', v_agency;
  end if;

  if to_regclass('public.machine_events') is not null then
    execute 'select count(*) from public.machine_events e where coalesce(e.machine_uuid, e.machine_id) in (select machine_uuid from pg_temp.agency_delete_machines) or e.machine_wtn_id in (select machine_wtn_id from pg_temp.agency_delete_machines)' into v_event_count;
  end if;
  if to_regclass('public.restock_events') is not null then
    execute 'select count(*) from public.restock_events r where coalesce(r.machine_uuid, r.machine_id) in (select machine_uuid from pg_temp.agency_delete_machines) or r.machine_wtn_id in (select machine_wtn_id from pg_temp.agency_delete_machines)' into v_restock_count;
  end if;
  if to_regclass('public.machine_planogram_items') is not null then
    execute 'select count(*) from public.machine_planogram_items p where coalesce(p.machine_uuid, p.machine_id) in (select machine_uuid from pg_temp.agency_delete_machines) or p.machine_wtn_id in (select machine_wtn_id from pg_temp.agency_delete_machines)' into v_planogram_count;
  end if;

  -- Remove remembered mappings before machine deletion so no source remains mapped to a deleted agency.
  if to_regclass('public.machine_name_aliases') is not null then
    execute 'delete from public.machine_name_aliases a where coalesce(a.machine_uuid, a.machine_id) in (select machine_uuid from pg_temp.agency_delete_machines) or a.machine_wtn_id in (select machine_wtn_id from pg_temp.agency_delete_machines)';
  end if;
  if to_regclass('public.restock_machine_aliases') is not null then
    execute 'delete from public.restock_machine_aliases a where a.machine_uuid in (select machine_uuid from pg_temp.agency_delete_machines)';
  end if;

  -- All machine-linked tables with ON DELETE CASCADE are removed here through locations -> machines.
  delete from public.locations where agency = v_agency;

  -- Keep technicians used elsewhere; remove only technicians that no longer have restock or service history.
  if to_regclass('public.technicians') is not null then
    delete from public.technicians t
    where not exists (select 1 from public.restock_events r where r.technician_id = t.id)
      and not exists (select 1 from public.service_assignments s where s.technician_id = t.id)
      and not exists (select 1 from public.technician_name_aliases a where a.technician_id = t.id);
  end if;

  return query select v_agency, v_location_count, v_machine_count, v_event_count, v_restock_count, v_planogram_count;
end;
$$;

grant execute on function public.delete_agency_cascade(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
