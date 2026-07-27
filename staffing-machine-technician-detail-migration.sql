drop function if exists public.get_staffing_machine_technician_summary();
create function public.get_staffing_machine_technician_summary()
returns table (
  machine_uuid uuid,
  technician_id uuid,
  technician_code text,
  visit_count bigint,
  units_restocked numeric,
  selections_serviced bigint,
  estimated_hours numeric,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql stable security definer set search_path=public as $$
with params as (
  select
    coalesce(max(parameter_value) filter (where parameter_name='staffing_base_visit_hours'),0.25) base_h,
    coalesce(max(parameter_value) filter (where parameter_name='staffing_hours_per_unit'),0.003) unit_h,
    coalesce(max(parameter_value) filter (where parameter_name='staffing_hours_per_selection'),0.02) selection_h
  from public.program_parameters
), visits as (
  select machine_uuid, technician_id, restock_datetime,
         sum(restock_quantity)::numeric units,
         count(distinct selection_number)::bigint selections
  from public.restock_events
  group by machine_uuid, technician_id, restock_datetime
)
select v.machine_uuid, v.technician_id,
       coalesce(t.technician_code,t.technician_name,'Anonymous')::text technician_code,
       count(*)::bigint visit_count,
       coalesce(sum(v.units),0)::numeric units_restocked,
       coalesce(sum(v.selections),0)::bigint selections_serviced,
       (count(*)*p.base_h + coalesce(sum(v.units),0)*p.unit_h + coalesce(sum(v.selections),0)*p.selection_h)::numeric estimated_hours,
       min(v.restock_datetime), max(v.restock_datetime)
from visits v
join public.technicians t on t.id=v.technician_id
cross join params p
group by v.machine_uuid,v.technician_id,t.technician_code,t.technician_name,p.base_h,p.unit_h,p.selection_h
order by v.machine_uuid, estimated_hours desc, technician_code;
$$;
grant execute on function public.get_staffing_machine_technician_summary() to anon, authenticated;
