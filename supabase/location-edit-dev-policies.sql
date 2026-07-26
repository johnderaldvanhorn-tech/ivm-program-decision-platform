-- Temporary development access for the local MVP.
-- Replace these anon policies with authenticated role policies before production.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.locations to anon, authenticated;
grant select, insert, update, delete on table public.location_access_scores to anon, authenticated;
grant select, insert, update, delete on table public.location_demographics to anon, authenticated;

alter table public.locations enable row level security;
alter table public.location_access_scores enable row level security;
alter table public.location_demographics enable row level security;

drop policy if exists "locations_dev_select" on public.locations;
drop policy if exists "locations_dev_insert" on public.locations;
drop policy if exists "locations_dev_update" on public.locations;
drop policy if exists "locations_dev_delete" on public.locations;
create policy "locations_dev_select" on public.locations for select to anon, authenticated using (true);
create policy "locations_dev_insert" on public.locations for insert to anon, authenticated with check (true);
create policy "locations_dev_update" on public.locations for update to anon, authenticated using (true) with check (true);
create policy "locations_dev_delete" on public.locations for delete to anon, authenticated using (true);

drop policy if exists "location_access_dev_select" on public.location_access_scores;
drop policy if exists "location_access_dev_insert" on public.location_access_scores;
drop policy if exists "location_access_dev_update" on public.location_access_scores;
drop policy if exists "location_access_dev_delete" on public.location_access_scores;
create policy "location_access_dev_select" on public.location_access_scores for select to anon, authenticated using (true);
create policy "location_access_dev_insert" on public.location_access_scores for insert to anon, authenticated with check (true);
create policy "location_access_dev_update" on public.location_access_scores for update to anon, authenticated using (true) with check (true);
create policy "location_access_dev_delete" on public.location_access_scores for delete to anon, authenticated using (true);

drop policy if exists "location_demographics_dev_select" on public.location_demographics;
drop policy if exists "location_demographics_dev_insert" on public.location_demographics;
drop policy if exists "location_demographics_dev_update" on public.location_demographics;
drop policy if exists "location_demographics_dev_delete" on public.location_demographics;
create policy "location_demographics_dev_select" on public.location_demographics for select to anon, authenticated using (true);
create policy "location_demographics_dev_insert" on public.location_demographics for insert to anon, authenticated with check (true);
create policy "location_demographics_dev_update" on public.location_demographics for update to anon, authenticated using (true) with check (true);
create policy "location_demographics_dev_delete" on public.location_demographics for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
