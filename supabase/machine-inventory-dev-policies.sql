-- Temporary development access for Machine Data and Inventory.
-- Replace with authenticated role-based policies before production.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.machines to anon, authenticated;
grant select, insert, update, delete on table public.inventory_periods to anon, authenticated;

alter table public.machines enable row level security;
alter table public.inventory_periods enable row level security;

drop policy if exists "machines_dev_all" on public.machines;
create policy "machines_dev_all" on public.machines for all to anon, authenticated using (true) with check (true);

drop policy if exists "inventory_periods_dev_all" on public.inventory_periods;
create policy "inventory_periods_dev_all" on public.inventory_periods for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
