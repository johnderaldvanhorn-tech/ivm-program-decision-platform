begin;

create extension if not exists pgcrypto;

-- Allow one saved policy per machine/product rather than one row per machine.
alter table if exists public.safety_stock
  add column if not exists machine_uuid uuid,
  add column if not exists machine_wtn_id text,
  add column if not exists product_filter text not null default 'All Products',
  add column if not exists service_level numeric not null default 0.95,
  add column if not exists z_score numeric not null default 1.645,
  add column if not exists demand_stddev numeric not null default 0,
  add column if not exists observed_lead_time_days numeric not null default 0,
  add column if not exists lead_time_stddev_days numeric not null default 0,
  add column if not exists review_period_days numeric not null default 0,
  add column if not exists capacity integer not null default 0,
  add column if not exists current_inventory integer not null default 0,
  add column if not exists evaluation_start_date date,
  add column if not exists evaluation_end_date date,
  add column if not exists calculation_method text not null default 'Demand and lead-time variability',
  add column if not exists stockout_events integer not null default 0,
  add column if not exists notes text;

update public.safety_stock s
set machine_uuid = coalesce(s.machine_uuid, s.machine_id)
where s.machine_uuid is null;

update public.safety_stock s
set machine_wtn_id = m.machine_id
from public.machines m
where m.id = s.machine_uuid
  and (s.machine_wtn_id is null or btrim(s.machine_wtn_id) = '');

-- The original table used a one-machine-only uniqueness constraint. Remove it
-- so All Products and Narcan policies may coexist.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.safety_stock'::regclass
      and c.contype = 'u'
      and a.attname in ('machine_id','machine_uuid')
  loop
    execute format('alter table public.safety_stock drop constraint if exists %I', r.conname);
  end loop;
end $$;

drop index if exists public.safety_stock_machine_uuid_uidx;
create unique index if not exists safety_stock_machine_product_uidx
  on public.safety_stock(machine_uuid, product_filter);
create index if not exists safety_stock_wtn_idx
  on public.safety_stock(machine_wtn_id);

-- Keep explicit machine identity synchronized for saved policies.
create or replace function public.sync_safety_stock_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.machine_uuid := coalesce(new.machine_uuid, new.machine_id);
  new.machine_id := coalesce(new.machine_id, new.machine_uuid);

  if new.machine_uuid is not null then
    select m.machine_id into new.machine_wtn_id
    from public.machines m
    where m.id = new.machine_uuid;
  elsif nullif(btrim(new.machine_wtn_id), '') is not null then
    select m.id into new.machine_uuid
    from public.machines m
    where upper(btrim(m.machine_id)) = upper(btrim(new.machine_wtn_id))
    limit 1;
    new.machine_id := new.machine_uuid;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_safety_stock_identity on public.safety_stock;
create trigger trg_sync_safety_stock_identity
before insert or update on public.safety_stock
for each row execute function public.sync_safety_stock_identity();

-- Returns the demand, restock, planogram, and lead-time statistics required by
-- the safety-stock policy. Zero-demand calendar days are included when
-- calculating daily demand variability.
drop function if exists public.get_safety_stock_analysis(date,date,text);
create function public.get_safety_stock_analysis(
  p_start_date date default null,
  p_end_date date default null,
  p_product_filter text default 'All Products'
)
returns table (
  machine_uuid uuid,
  machine_wtn_id text,
  agency text,
  location_name text,
  city text,
  state text,
  capacity bigint,
  current_inventory bigint,
  selection_count bigint,
  evaluation_days integer,
  dispensed_units bigint,
  average_daily_demand numeric,
  demand_stddev numeric,
  demand_peak_daily numeric,
  restock_visits bigint,
  restocked_units numeric,
  average_lead_time_days numeric,
  lead_time_stddev_days numeric,
  stockout_events bigint,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with bounds as (
  select
    coalesce(p_start_date, current_date - 365) as start_date,
    coalesce(p_end_date, current_date) as end_date,
    coalesce(nullif(btrim(p_product_filter), ''), 'All Products') as product_filter
), directory as (
  select
    m.id as machine_uuid,
    m.machine_id as machine_wtn_id,
    coalesce(l.agency, 'Unassigned Agency') as agency,
    coalesce(l.location_name, 'Unspecified Location') as location_name,
    coalesce(l.city, '') as city,
    coalesce(l.state, '') as state
  from public.machines m
  left join public.locations l on l.id = m.location_id
), planogram as (
  select
    p.machine_uuid,
    count(*)::bigint as selection_count,
    coalesce(sum(p.max_level),0)::bigint as capacity,
    coalesce(sum(p.current_quantity),0)::bigint as current_inventory
  from public.machine_planogram_items p
  cross join bounds b
  where b.product_filter = 'All Products'
     or (lower(b.product_filter) = 'narcan' and lower(coalesce(p.product_name,'')) like '%narcan%')
     or lower(coalesce(p.product_name,'')) = lower(b.product_filter)
  group by p.machine_uuid
), dates as (
  select generate_series(b.start_date, b.end_date, interval '1 day')::date as activity_date
  from bounds b
), successful_dispense as (
  select
    e.machine_uuid,
    e.event_datetime::date as activity_date,
    sum(greatest(coalesce(e.quantity,1),1))::numeric as units
  from public.machine_events e
  cross join bounds b
  where e.event_datetime::date between b.start_date and b.end_date
    and (
      lower(coalesce(e.action,'')) like '%dispens%'
      or lower(coalesce(e.event_type,'')) like '%dispens%'
      or lower(coalesce(e.dispense_type,'')) like '%dispens%'
    )
    and lower(coalesce(e.status,'')) not like '%fail%'
    and (
      b.product_filter = 'All Products'
      or (lower(b.product_filter) = 'narcan' and lower(coalesce(e.product,'')) like '%narcan%')
      or lower(coalesce(e.product,'')) = lower(b.product_filter)
    )
  group by e.machine_uuid, e.event_datetime::date
), daily_demand as (
  select
    d.machine_uuid,
    x.activity_date,
    coalesce(s.units,0)::numeric as units
  from directory d
  cross join dates x
  left join successful_dispense s
    on s.machine_uuid = d.machine_uuid
   and s.activity_date = x.activity_date
), demand_stats as (
  select
    dd.machine_uuid,
    count(*)::integer as evaluation_days,
    sum(dd.units)::bigint as dispensed_units,
    avg(dd.units)::numeric as average_daily_demand,
    coalesce(stddev_samp(dd.units),0)::numeric as demand_stddev,
    max(dd.units)::numeric as demand_peak_daily
  from daily_demand dd
  group by dd.machine_uuid
), activity as (
  select
    e.machine_uuid,
    min(e.event_datetime) as first_activity,
    max(e.event_datetime) as last_activity,
    count(*) filter (
      where lower(coalesce(e.message,'')) like '%out of stock%'
         or lower(coalesce(e.error_type,'')) like '%stock%'
         or lower(coalesce(e.status,'')) like '%stockout%'
    )::bigint as stockout_events
  from public.machine_events e
  cross join bounds b
  where e.event_datetime::date between b.start_date and b.end_date
    and (
      b.product_filter = 'All Products'
      or (lower(b.product_filter) = 'narcan' and lower(coalesce(e.product,'')) like '%narcan%')
      or lower(coalesce(e.product,'')) = lower(b.product_filter)
    )
  group by e.machine_uuid
), restock_dates as (
  select distinct
    r.machine_uuid,
    r.restock_datetime::date as restock_date
  from public.restock_events r
  cross join bounds b
  where r.restock_datetime::date between b.start_date and b.end_date
    and (
      b.product_filter = 'All Products'
      or (lower(b.product_filter) = 'narcan' and lower(coalesce(r.product_name,'')) like '%narcan%')
      or lower(coalesce(r.product_name,'')) = lower(b.product_filter)
    )
), restock_intervals as (
  select
    machine_uuid,
    (restock_date - lag(restock_date) over(partition by machine_uuid order by restock_date))::numeric as interval_days
  from restock_dates
), restock_stats as (
  select
    r.machine_uuid,
    count(distinct r.restock_datetime::date)::bigint as restock_visits,
    coalesce(sum(r.restock_quantity),0)::numeric as restocked_units
  from public.restock_events r
  cross join bounds b
  where r.restock_datetime::date between b.start_date and b.end_date
    and (
      b.product_filter = 'All Products'
      or (lower(b.product_filter) = 'narcan' and lower(coalesce(r.product_name,'')) like '%narcan%')
      or lower(coalesce(r.product_name,'')) = lower(b.product_filter)
    )
  group by r.machine_uuid
), lead_stats as (
  select
    machine_uuid,
    coalesce(avg(interval_days) filter(where interval_days > 0),0)::numeric as average_lead_time_days,
    coalesce(stddev_samp(interval_days) filter(where interval_days > 0),0)::numeric as lead_time_stddev_days
  from restock_intervals
  group by machine_uuid
)
select
  d.machine_uuid,
  d.machine_wtn_id,
  d.agency,
  d.location_name,
  d.city,
  d.state,
  coalesce(p.capacity,0),
  coalesce(p.current_inventory,0),
  coalesce(p.selection_count,0),
  coalesce(ds.evaluation_days,0),
  coalesce(ds.dispensed_units,0),
  coalesce(ds.average_daily_demand,0),
  coalesce(ds.demand_stddev,0),
  coalesce(ds.demand_peak_daily,0),
  coalesce(rs.restock_visits,0),
  coalesce(rs.restocked_units,0),
  coalesce(ls.average_lead_time_days,0),
  coalesce(ls.lead_time_stddev_days,0),
  coalesce(a.stockout_events,0),
  a.first_activity,
  a.last_activity
from directory d
left join planogram p on p.machine_uuid = d.machine_uuid
left join demand_stats ds on ds.machine_uuid = d.machine_uuid
left join restock_stats rs on rs.machine_uuid = d.machine_uuid
left join lead_stats ls on ls.machine_uuid = d.machine_uuid
left join activity a on a.machine_uuid = d.machine_uuid
order by d.agency, d.location_name, d.machine_wtn_id;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.safety_stock to anon, authenticated;
grant execute on function public.get_safety_stock_analysis(date,date,text) to anon, authenticated;

alter table public.safety_stock enable row level security;
drop policy if exists "safety_stock_dev_select" on public.safety_stock;
drop policy if exists "safety_stock_dev_insert" on public.safety_stock;
drop policy if exists "safety_stock_dev_update" on public.safety_stock;
drop policy if exists "safety_stock_dev_delete" on public.safety_stock;
create policy "safety_stock_dev_select" on public.safety_stock for select to anon, authenticated using (true);
create policy "safety_stock_dev_insert" on public.safety_stock for insert to anon, authenticated with check (true);
create policy "safety_stock_dev_update" on public.safety_stock for update to anon, authenticated using (true) with check (true);
create policy "safety_stock_dev_delete" on public.safety_stock for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
commit;
