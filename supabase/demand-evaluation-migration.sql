begin;

create table if not exists public.demand_evaluation_parameters (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  product_filter text not null default 'All Products',
  product_cost numeric not null default 45,
  delivery_cost numeric not null default 5,
  annual_holding_rate numeric not null default 0.20,
  unmet_demand_penalty numeric not null default 500,
  evaluation_start_date date,
  evaluation_end_date date,
  requested_quantity_override numeric,
  restocked_quantity_override numeric,
  average_inventory_override numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_id, product_filter)
);

alter table public.demand_evaluation_parameters enable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.demand_evaluation_parameters to anon, authenticated;

drop policy if exists "demand_evaluation_parameters_dev_select" on public.demand_evaluation_parameters;
drop policy if exists "demand_evaluation_parameters_dev_insert" on public.demand_evaluation_parameters;
drop policy if exists "demand_evaluation_parameters_dev_update" on public.demand_evaluation_parameters;
drop policy if exists "demand_evaluation_parameters_dev_delete" on public.demand_evaluation_parameters;
create policy "demand_evaluation_parameters_dev_select" on public.demand_evaluation_parameters for select to anon, authenticated using (true);
create policy "demand_evaluation_parameters_dev_insert" on public.demand_evaluation_parameters for insert to anon, authenticated with check (true);
create policy "demand_evaluation_parameters_dev_update" on public.demand_evaluation_parameters for update to anon, authenticated using (true) with check (true);
create policy "demand_evaluation_parameters_dev_delete" on public.demand_evaluation_parameters for delete to anon, authenticated using (true);

create or replace function public.get_demand_evaluation_summary(
  p_machine_id uuid,
  p_product_filter text default 'All Products',
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  capacity numeric,
  selection_count bigint,
  successful_transactions bigint,
  dispensed_units numeric,
  requested_from_logs numeric,
  restocked_from_logs numeric,
  stockout_events bigint,
  evaluation_days integer,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered_items as (
    select *
    from public.machine_planogram_items p
    where p.machine_id = p_machine_id
      and (coalesce(p_product_filter, 'All Products') = 'All Products'
        or lower(coalesce(p.product_name, '')) like '%' || lower(p_product_filter) || '%')
  ), filtered_events as (
    select e.*
    from public.machine_events e
    where e.machine_id = p_machine_id
      and (p_start_date is null or e.event_datetime >= p_start_date::timestamptz)
      and (p_end_date is null or e.event_datetime < (p_end_date + 1)::timestamptz)
      and (coalesce(p_product_filter, 'All Products') = 'All Products'
        or lower(coalesce(e.product, '')) like '%' || lower(p_product_filter) || '%')
  )
  select
    coalesce((select sum(max_level) from filtered_items), 0)::numeric,
    (select count(*) from filtered_items)::bigint,
    count(*) filter (where lower(coalesce(status, '')) = 'success' and (lower(coalesce(action, '')) like '%transaction%' or lower(coalesce(event_type, '')) like '%dispens%'))::bigint,
    coalesce(sum(case when lower(coalesce(status, '')) = 'success' and (lower(coalesce(action, '')) like '%transaction%' or lower(coalesce(event_type, '')) like '%dispens%') then greatest(coalesce(quantity, 1), 1) else 0 end), 0)::numeric,
    coalesce(sum(case when lower(coalesce(action, '') || ' ' || coalesce(message, '') || ' ' || coalesce(event_type, '')) ~ '(request|order)' then greatest(coalesce(quantity, 1), 1) else 0 end), 0)::numeric,
    coalesce(sum(case when lower(coalesce(action, '') || ' ' || coalesce(message, '') || ' ' || coalesce(event_type, '')) ~ '(restock|replenish|refill|fill machine)' then greatest(coalesce(quantity, 1), 1) else 0 end), 0)::numeric,
    count(*) filter (where lower(coalesce(message, '') || ' ' || coalesce(error_type, '') || ' ' || coalesce(status, '')) ~ '(out of stock|stockout)')::bigint,
    greatest(1, (coalesce(p_end_date, max(event_datetime)::date, current_date) - coalesce(p_start_date, min(event_datetime)::date, current_date) + 1))::integer,
    min(event_datetime),
    max(event_datetime)
  from filtered_events;
$$;

create or replace function public.get_demand_evaluation_selection_summary(
  p_machine_id uuid,
  p_product_filter text default 'All Products',
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  selection_number text,
  product_name text,
  item_number text,
  capacity numeric,
  critical_level numeric,
  low_level numeric,
  par_level numeric,
  dispensed_units numeric,
  requested_units numeric,
  restocked_units numeric,
  stockout_events bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.selection_number,
    p.product_name,
    p.item_number,
    p.max_level::numeric,
    p.critical_level::numeric,
    p.low_level::numeric,
    p.par_level::numeric,
    coalesce(sum(case when lower(coalesce(e.status, '')) = 'success' and (lower(coalesce(e.action, '')) like '%transaction%' or lower(coalesce(e.event_type, '')) like '%dispens%') then greatest(coalesce(e.quantity, 1), 1) else 0 end), 0)::numeric,
    coalesce(sum(case when lower(coalesce(e.action, '') || ' ' || coalesce(e.message, '') || ' ' || coalesce(e.event_type, '')) ~ '(request|order)' then greatest(coalesce(e.quantity, 1), 1) else 0 end), 0)::numeric,
    coalesce(sum(case when lower(coalesce(e.action, '') || ' ' || coalesce(e.message, '') || ' ' || coalesce(e.event_type, '')) ~ '(restock|replenish|refill|fill machine)' then greatest(coalesce(e.quantity, 1), 1) else 0 end), 0)::numeric,
    count(e.id) filter (where lower(coalesce(e.message, '') || ' ' || coalesce(e.error_type, '') || ' ' || coalesce(e.status, '')) ~ '(out of stock|stockout)')::bigint
  from public.machine_planogram_items p
  left join public.machine_events e
    on e.machine_id = p.machine_id
    and trim(coalesce(e.selection, '')) = trim(p.selection_number)
    and (p_start_date is null or e.event_datetime >= p_start_date::timestamptz)
    and (p_end_date is null or e.event_datetime < (p_end_date + 1)::timestamptz)
  where p.machine_id = p_machine_id
    and (coalesce(p_product_filter, 'All Products') = 'All Products'
      or lower(coalesce(p.product_name, '')) like '%' || lower(p_product_filter) || '%')
  group by p.selection_number, p.product_name, p.item_number, p.max_level, p.critical_level, p.low_level, p.par_level
  order by p.selection_number;
$$;

grant execute on function public.get_demand_evaluation_summary(uuid,text,date,date) to anon, authenticated;
grant execute on function public.get_demand_evaluation_selection_summary(uuid,text,date,date) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
