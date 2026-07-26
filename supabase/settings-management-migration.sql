begin;

insert into public.program_parameters(parameter_name, parameter_value, parameter_group, description) values
('risk_population_min',0,'risk_normalization','Dataset minimum used to normalize ZIP population'),
('risk_population_max',100000,'risk_normalization','Dataset maximum used to normalize ZIP population'),
('risk_crime_min',0,'risk_normalization','Dataset minimum used to normalize crime'),
('risk_crime_max',100,'risk_normalization','Dataset maximum used to normalize crime'),
('risk_zone_min',1,'risk_normalization','Lowest USDA zone in the program dataset'),
('risk_zone_max',13,'risk_normalization','Highest USDA zone in the program dataset'),
('risk_zone_mid',7,'risk_normalization','Reference hardiness zone midpoint'),
('score_green_threshold',0.67,'score_thresholds','Minimum favorable score shown as green'),
('score_yellow_threshold',0.34,'score_thresholds','Minimum review score shown as yellow'),
('inventory_watch_capacity_percent',0.20,'inventory','Capacity percentage at or below which inventory enters Watch status'),
('safety_stock_service_level',0.95,'safety_stock','Default target service level'),
('safety_stock_default_lead_time_days',7,'safety_stock','Fallback replenishment lead time'),
('safety_stock_review_period_days',7,'safety_stock','Default review interval'),
('safety_stock_warning_units',5,'safety_stock','Low safety-stock warning threshold'),
('staffing_default_weekly_hours',40,'staffing','Default weekly technician availability'),
('demand_default_product_cost',45,'demand_cost','Default product acquisition cost'),
('demand_default_delivery_cost',5,'demand_cost','Default delivery cost per replenished unit'),
('demand_annual_holding_rate',0.20,'demand_cost','Annual inventory holding rate'),
('demand_unmet_penalty',500,'demand_cost','Default unmet-demand penalty')
on conflict (parameter_name) do nothing;

-- Temporary development access while Supabase Auth roles are not yet enabled.
grant select, insert, update, delete on public.program_parameters to anon, authenticated;
grant select, insert, update, delete on public.score_mappings to anon, authenticated;

alter table public.program_parameters enable row level security;
alter table public.score_mappings enable row level security;

drop policy if exists "program_parameters_dev_select" on public.program_parameters;
drop policy if exists "program_parameters_dev_insert" on public.program_parameters;
drop policy if exists "program_parameters_dev_update" on public.program_parameters;
drop policy if exists "program_parameters_dev_delete" on public.program_parameters;
create policy "program_parameters_dev_select" on public.program_parameters for select to anon, authenticated using (true);
create policy "program_parameters_dev_insert" on public.program_parameters for insert to anon, authenticated with check (true);
create policy "program_parameters_dev_update" on public.program_parameters for update to anon, authenticated using (true) with check (true);
create policy "program_parameters_dev_delete" on public.program_parameters for delete to anon, authenticated using (true);

drop policy if exists "score_mappings_dev_select" on public.score_mappings;
drop policy if exists "score_mappings_dev_insert" on public.score_mappings;
drop policy if exists "score_mappings_dev_update" on public.score_mappings;
drop policy if exists "score_mappings_dev_delete" on public.score_mappings;
create policy "score_mappings_dev_select" on public.score_mappings for select to anon, authenticated using (true);
create policy "score_mappings_dev_insert" on public.score_mappings for insert to anon, authenticated with check (true);
create policy "score_mappings_dev_update" on public.score_mappings for update to anon, authenticated using (true) with check (true);
create policy "score_mappings_dev_delete" on public.score_mappings for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
commit;
