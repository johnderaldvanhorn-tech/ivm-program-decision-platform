begin;

create or replace function public.get_machine_log_totals()
returns table (
  total_events bigint,
  units_dispensed bigint,
  unauthorized_attempts bigint,
  out_of_stock_attempts bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint as total_events,
    coalesce(sum(
      case
        when action = 'Transactions' and lower(coalesce(status, '')) = 'success'
          then coalesce(quantity, 1)
        else 0
      end
    ), 0)::bigint as units_dispensed,
    count(*) filter (
      where lower(coalesce(action, '')) like '%unauthorized%'
    )::bigint as unauthorized_attempts,
    count(*) filter (
      where lower(coalesce(message, '')) like '%out of stock%'
    )::bigint as out_of_stock_attempts
  from public.machine_events;
$$;

create or replace function public.get_machine_log_machine_summary()
returns table (
  machine_id uuid,
  event_count bigint,
  units_dispensed bigint,
  failed_count bigint,
  stockout_count bigint,
  first_activity timestamptz,
  last_activity timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.machine_id,
    count(*)::bigint as event_count,
    coalesce(sum(
      case
        when e.action = 'Transactions' and lower(coalesce(e.status, '')) = 'success'
          then coalesce(e.quantity, 1)
        else 0
      end
    ), 0)::bigint as units_dispensed,
    count(*) filter (
      where nullif(trim(coalesce(e.status, '')), '') is not null
        and lower(e.status) <> 'success'
    )::bigint as failed_count,
    count(*) filter (
      where lower(coalesce(e.message, '')) like '%out of stock%'
    )::bigint as stockout_count,
    min(e.event_datetime) as first_activity,
    max(e.event_datetime) as last_activity
  from public.machine_events e
  where e.machine_id is not null
  group by e.machine_id;
$$;

grant execute on function public.get_machine_log_totals() to anon, authenticated;
grant execute on function public.get_machine_log_machine_summary() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
