begin;

alter table public.technicians
  add column if not exists technician_code text;

create unique index if not exists technicians_technician_code_key
  on public.technicians(technician_code)
  where technician_code is not null;

create table if not exists public.technician_name_aliases (
  id uuid primary key default gen_random_uuid(),
  source_person_name text not null unique,
  technician_id uuid references public.technicians(id) on delete cascade,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ignored and technician_id is null) or (not ignored and technician_id is not null))
);

-- Assign anonymous codes to any technicians already linked to imported restock events.
update public.technicians t
set technician_code = 'TECH-' || upper(substr(md5(t.id::text),1,6)),
    technician_name = 'TECH-' || upper(substr(md5(t.id::text),1,6))
where technician_code is null
  and exists (select 1 from public.restock_events r where r.technician_id=t.id);

-- Server-side resolver prevents sentinel values such as __CREATE__ from ever entering UUID fields.
drop function if exists public.get_or_create_anonymous_technician(text);
create function public.get_or_create_anonymous_technician(p_source_person_name text)
returns table (technician_id uuid, technician_code text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_source text := btrim(coalesce(p_source_person_name,''));
  v_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  if v_source = '' then
    raise exception 'Source restock person is required.';
  end if;

  select a.technician_id, t.technician_code
    into v_id, v_code
  from public.technician_name_aliases a
  join public.technicians t on t.id=a.technician_id
  where lower(btrim(a.source_person_name))=lower(v_source)
    and a.ignored=false
  limit 1;

  if v_id is not null then
    return query select v_id, v_code;
    return;
  end if;

  -- Deterministic anonymous code: stable for the same source identity, but reveals no name.
  v_code := 'TECH-' || upper(substr(md5(lower(v_source)),1,6));

  loop
    begin
      insert into public.technicians(technician_code,technician_name,max_hours,active)
      values (v_code,v_code,40,true)
      on conflict (technician_code) do update set active=true
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      v_code := 'TECH-' || upper(substr(md5(lower(v_source)||':'||v_attempt::text),1,6));
    end;
  end loop;

  insert into public.technician_name_aliases(source_person_name,technician_id,ignored,updated_at)
  values (v_source,v_id,false,now())
  on conflict (source_person_name) do update
    set technician_id=excluded.technician_id,
        ignored=false,
        updated_at=now();

  return query select v_id, v_code;
end;
$$;

drop function if exists public.get_staffing_technician_summary();
create function public.get_staffing_technician_summary()
returns table (
  technician_id uuid,
  technician_code text,
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
  select t.id technician_id,
         coalesce(t.technician_code,'TECH-'||upper(substr(md5(t.id::text),1,6))) technician_code,
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
    and exists (select 1 from public.restock_events r where r.technician_id=t.id)
  group by t.id,t.technician_code,t.max_hours,p.base_h,p.unit_h,p.selection_h
)
select *, case when max_hours>0 then estimated_hours/max_hours*100 else 0 end::numeric utilization_pct
from agg
order by estimated_hours desc, technician_code;
$$;

grant execute on function public.get_or_create_anonymous_technician(text) to anon, authenticated;
grant execute on function public.get_staffing_technician_summary() to anon, authenticated;
grant select,insert,update on public.technicians to anon, authenticated;
grant select,insert,update on public.technician_name_aliases to anon, authenticated;

alter table public.technician_name_aliases enable row level security;
drop policy if exists technician_name_aliases_dev_all on public.technician_name_aliases;
create policy technician_name_aliases_dev_all on public.technician_name_aliases
for all to anon, authenticated using (true) with check (true);

drop policy if exists technicians_restock_dev_all on public.technicians;
create policy technicians_restock_dev_all on public.technicians
for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
commit;
