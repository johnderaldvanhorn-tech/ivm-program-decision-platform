create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','program_manager','technician','viewer');
create type public.machine_status as enum ('Planned','Active','Inactive','Removed');
create type public.task_type as enum ('Restock','Maintenance','Inspection','Calibration','Cleaning');
create type public.location_safety as enum ('Safe','Unsafe','Blocked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clusters (
  id uuid primary key default gen_random_uuid(),
  cluster_name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null unique,
  agency text not null,
  location_name text not null,
  address text,
  city text,
  state text,
  zip text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  contact_name text,
  contact_phone text,
  contact_email text,
  machine_status public.machine_status not null default 'Planned',
  cluster_id uuid references public.clusters(id) on delete set null,
  population_served integer not null default 0 check (population_served >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.location_access_scores (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references public.locations(id) on delete cascade,
  availability_tier text not null,
  public_access_category text,
  public_access_score numeric(6,5) not null check (public_access_score between 0 and 1),
  physical_access_category text,
  physical_access_score numeric(6,5) not null check (physical_access_score between 0 and 1),
  accessible_hours_per_week numeric(6,2) not null check (accessible_hours_per_week between 0 and 168),
  temporal_access_score numeric(6,5) not null check (temporal_access_score between 0 and 1),
  visibility_category text,
  visibility_score numeric(6,5) not null check (visibility_score between 0 and 1),
  machine_accessibility_score numeric(6,5) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.location_demographics (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references public.locations(id) on delete cascade,
  housing_unit_density numeric not null default 0,
  population_density numeric not null default 0,
  contiguous_housing_units integer not null default 0,
  contiguous_population integer not null default 0,
  urban_rural_flag text not null check (urban_rural_flag in ('Urban','Rural')),
  zip_population integer not null default 0,
  zip_crime_rate numeric not null default 0,
  usda_hardiness_zone numeric not null default 0,
  normalized_population_score numeric(6,5) not null default 0,
  normalized_crime_score numeric(6,5) not null default 0,
  normalized_climate_risk_score numeric(6,5) not null default 0,
  risk_score numeric(6,5) not null default 0,
  maximum_location_score numeric(8,5) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.program_parameters (
  id uuid primary key default gen_random_uuid(),
  parameter_name text not null unique,
  parameter_value numeric not null,
  parameter_group text not null,
  description text,
  updated_at timestamptz not null default now()
);

create table public.score_mappings (
  id uuid primary key default gen_random_uuid(),
  mapping_group text not null,
  category_key text not null,
  category_label text not null,
  score numeric(6,5) not null check (score between 0 and 1),
  sort_order integer not null default 0,
  active boolean not null default true,
  unique(mapping_group, category_key)
);

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references public.locations(id) on delete cascade,
  machine_id text not null unique,
  capacity integer not null check (capacity >= 0),
  current_inventory integer not null default 0 check (current_inventory >= 0),
  supplier_reliability numeric(6,5) not null default 1 check (supplier_reliability between 0 and 1),
  max_orderable_quantity integer not null default 0 check (max_orderable_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_inventory <= capacity)
);

create table public.inventory_periods (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  period_date date not null,
  demand integer not null default 0,
  prior_inventory integer not null default 0,
  units_replenished integer not null default 0,
  units_dispensed integer not null default 0,
  ending_inventory integer not null default 0,
  unmet_demand integer not null default 0,
  cost_per_unit numeric(12,2) not null default 0,
  holding_cost_per_unit numeric(12,2) not null default 0,
  stockout_penalty numeric(12,2),
  total_period_cost numeric(14,2) not null default 0,
  stockout_flag boolean not null default false,
  inventory_status text not null default 'Healthy',
  created_at timestamptz not null default now(),
  unique(machine_id, period_date),
  check (demand >= 0 and prior_inventory >= 0 and units_replenished >= 0 and units_dispensed >= 0 and ending_inventory >= 0 and unmet_demand >= 0),
  check (units_dispensed + unmet_demand = demand),
  check (units_dispensed <= prior_inventory + units_replenished)
);

create table public.safety_stock (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null unique references public.machines(id) on delete cascade,
  demand_rate numeric not null default 0,
  lead_time_days numeric not null default 0,
  safety_stock_units integer not null default 0,
  reorder_point numeric not null default 0,
  base_stock_level numeric not null default 0,
  optimal_fill_quantity numeric not null default 0,
  order_quantity numeric not null default 0,
  restock_trigger text not null default 'No order',
  safety_stock_flag text not null default 'Ready',
  updated_at timestamptz not null default now()
);

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  technician_code text unique,
  technician_name text not null,
  cluster_id uuid references public.clusters(id) on delete set null,
  max_hours numeric not null default 0,
  vehicle_capacity integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.technician_qualifications (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.technicians(id) on delete cascade,
  task_type public.task_type not null,
  qualified boolean not null default false,
  unique(technician_id, task_type)
);

create table public.service_tasks (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  task_type public.task_type not null,
  task_time_hours numeric not null check (task_time_hours >= 0),
  required_frequency numeric not null check (required_frequency >= 0),
  location_safety_flag public.location_safety not null default 'Safe',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.service_assignments (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.technicians(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  service_task_id uuid references public.service_tasks(id) on delete set null,
  task_type public.task_type not null,
  assignment_date date not null,
  assigned boolean not null default true,
  feasible boolean not null default false,
  workload_hours numeric not null default 0,
  capacity_status text not null default 'Pass',
  coverage_status text not null default 'Gap',
  completion_status text not null default 'Assigned',
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

insert into public.program_parameters(parameter_name,parameter_value,parameter_group,description) values
('accessibility_public_weight',0.35,'accessibility','Public access weighting'),
('accessibility_physical_weight',0.25,'accessibility','Physical access weighting'),
('accessibility_temporal_weight',0.20,'accessibility','Temporal access weighting'),
('accessibility_visibility_weight',0.20,'accessibility','Visibility weighting'),
('risk_population_weight',0.30,'risk','Population risk weighting'),
('risk_crime_weight',0.50,'risk','Crime risk weighting'),
('risk_climate_weight',0.20,'risk','Climate risk weighting'),
('maximum_location_risk_coefficient',1.0,'risk','Risk coefficient subtracted from accessibility'),
('stockout_penalty_multiplier',10.0,'inventory','Default stockout penalty multiplier applied to replenishment cost');

insert into public.score_mappings(mapping_group,category_key,category_label,score,sort_order) values
('availability','high','High',1.0,1),('availability','low','Low',0.6,2),
('public_access','fully_public','Fully public, ungated, no badge, no fee',1.0,1),
('public_access','time_limited','Public but time-limited',0.8,2),
('public_access','semi_public','Semi-public, controlled entry',0.5,3),
('public_access','private','Private/gated, residents/employees only',0.2,4),
('public_access','restricted','Highly restricted',0.0,5),
('physical_access','indoor_step_free','Indoor, step-free, near main circulation path',1.0,1),
('physical_access','outdoor_step_free','Outdoor, weather-exposed but step-free and near path',0.8,2),
('physical_access','minor_barriers','Indoor/outdoor with minor barriers',0.5,3),
('physical_access','significant_barriers','Significant barriers',0.2,4),
('physical_access','inaccessible','Practically inaccessible',0.0,5),
('visibility','high','High visibility',1.0,1),('visibility','moderate','Moderate visibility',0.6,2),
('visibility','low','Low visibility',0.3,3),('visibility','hidden','Hidden',0.0,4);

create or replace function public.current_user_role() returns public.app_role language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.profiles where id=auth.uid()),'viewer'::public.app_role)
$$;

alter table public.profiles enable row level security;
alter table public.clusters enable row level security;
alter table public.locations enable row level security;
alter table public.location_access_scores enable row level security;
alter table public.location_demographics enable row level security;
alter table public.program_parameters enable row level security;
alter table public.score_mappings enable row level security;
alter table public.machines enable row level security;
alter table public.inventory_periods enable row level security;
alter table public.safety_stock enable row level security;
alter table public.technicians enable row level security;
alter table public.technician_qualifications enable row level security;
alter table public.service_tasks enable row level security;
alter table public.service_assignments enable row level security;

create policy "authenticated read profiles" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

-- All authenticated roles may read program decision data.
do $$ declare t text; begin
  foreach t in array array['clusters','locations','location_access_scores','location_demographics','program_parameters','score_mappings','machines','inventory_periods','safety_stock','technicians','technician_qualifications','service_tasks','service_assignments'] loop
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (true)',t);
  end loop;
end $$;

-- Admin and program managers may maintain operational records.
do $$ declare t text; begin
  foreach t in array array['clusters','locations','location_access_scores','location_demographics','machines','inventory_periods','safety_stock','technicians','technician_qualifications','service_tasks','service_assignments'] loop
    execute format('create policy "manager insert %1$s" on public.%1$I for insert to authenticated with check (public.current_user_role() in (''admin'',''program_manager''))',t);
    execute format('create policy "manager update %1$s" on public.%1$I for update to authenticated using (public.current_user_role() in (''admin'',''program_manager'')) with check (public.current_user_role() in (''admin'',''program_manager''))',t);
    execute format('create policy "manager delete %1$s" on public.%1$I for delete to authenticated using (public.current_user_role() in (''admin'',''program_manager''))',t);
  end loop;
end $$;

create policy "admin manage parameters" on public.program_parameters for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
create policy "admin manage mappings" on public.score_mappings for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

-- Technicians may update only their own assigned service records.
create policy "technician update own assignments" on public.service_assignments for update to authenticated
using (exists(select 1 from public.technicians t where t.id=technician_id and t.user_id=auth.uid()))
with check (exists(select 1 from public.technicians t where t.id=technician_id and t.user_id=auth.uid()));

create index locations_cluster_idx on public.locations(cluster_id);
create index locations_status_idx on public.locations(machine_status);
create index inventory_machine_date_idx on public.inventory_periods(machine_id,period_date desc);
create index assignments_technician_date_idx on public.service_assignments(technician_id,assignment_date);
create index assignments_machine_date_idx on public.service_assignments(machine_id,assignment_date);
