begin;
create extension if not exists pgcrypto;
create table if not exists public.optimization_recommendations (
 id uuid primary key default gen_random_uuid(), machine_uuid uuid null references public.machines(id) on delete cascade,
 machine_wtn_id text null, domain text not null check(domain in ('location','inventory','safety_stock','staffing','joint')),
 priority text not null check(priority in ('Critical','High','Medium','Low')), title text not null, rationale text not null,
 current_value numeric null, recommended_value numeric null, expected_availability_gain numeric null, expected_cost_change numeric null,
 confidence numeric null check(confidence is null or confidence between 0 and 100), status text not null default 'Proposed' check(status in ('Proposed','Approved','Rejected','Deferred','Implemented')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(machine_uuid,domain,title)
);
create table if not exists public.optimization_scenarios (
 id uuid primary key default gen_random_uuid(), scenario_name text not null, description text null, assumptions jsonb not null default '{}'::jsonb,
 results jsonb not null default '{}'::jsonb, is_baseline boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.research_snapshots (
 id uuid primary key default gen_random_uuid(), snapshot_name text not null, analysis_stage text not null default 'Baseline', proposition text null,
 parameters jsonb not null default '{}'::jsonb, source_counts jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.optimization_recommendations enable row level security;
alter table public.optimization_scenarios enable row level security;
alter table public.research_snapshots enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='optimization_recommendations' and policyname='optimization_recommendations_dev') then create policy optimization_recommendations_dev on public.optimization_recommendations for all to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='optimization_scenarios' and policyname='optimization_scenarios_dev') then create policy optimization_scenarios_dev on public.optimization_scenarios for all to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='research_snapshots' and policyname='research_snapshots_dev') then create policy research_snapshots_dev on public.research_snapshots for all to anon,authenticated using(true) with check(true); end if;
end $$;
grant select,insert,update,delete on public.optimization_recommendations,public.optimization_scenarios,public.research_snapshots to anon,authenticated;
create index if not exists idx_optimization_recommendations_status on public.optimization_recommendations(status,priority);
create index if not exists idx_optimization_recommendations_machine on public.optimization_recommendations(machine_uuid);
notify pgrst,'reload schema';
commit;
