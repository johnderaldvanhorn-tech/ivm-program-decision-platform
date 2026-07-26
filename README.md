# IVM Program Decision Platform

Initial full-stack MVP scaffold for location assessment, intelligent vending fleet tracking, inventory planning, safety-stock decisions, staffing feasibility, dashboards, and reports.

## Included

- React + TypeScript + Vite
- Tailwind CSS through the official Vite plugin
- Recharts dashboard visualization
- Supabase client configuration
- Supabase PostgreSQL schema with seed parameters, lookup score mappings, roles, and row-level security
- Executive dashboard
- Location intake and live decision scoring
- Searchable machine table
- Calculation utilities for accessibility, urban/rural classification, normalized risk, maximum location score, inventory, safety stock, and staffing feasibility
- Navigation shells for inventory, safety stock, staffing, reports, and settings

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set these values in `.env.local`:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Create the database

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. Create a user through Supabase Auth.
5. Insert or update that user's `profiles` row with an application role.

Example administrator assignment:

```sql
insert into public.profiles (id, full_name, role)
values ('AUTH_USER_UUID', 'Administrator', 'admin')
on conflict (id) do update set role = excluded.role;
```

## Current MVP boundaries

Dashboard and machine rows use demonstration data so the visual application works before credentials are supplied. The location form performs all specified calculations but currently displays an MVP save confirmation. The next implementation step is a transactional Supabase save service that inserts `locations`, `location_access_scores`, `location_demographics`, and `machines` together.

## Recommended next build sequence

1. Authentication screen and session provider
2. Supabase repository/service layer
3. Settings-backed dynamic weights and mappings
4. Full location ranking table
5. Inventory and safety-stock forms
6. Technician planner and assignment validation
7. Printable report views and CSV export
8. CSV import validation and staging
9. Map/GIS and telemetry integrations

## Calculation Factors page

The `/calculations` page provides editable, live calculation models for accessibility, risk normalization and weighting, maximum location score, inventory, safety stock, and staffing feasibility. Adjustments can be saved in browser local storage and reset to the current default model at any time.

## Robust machine identity

Run `supabase/machine-identity-normalization.sql` after the base schema. The migration keeps UUIDs for foreign-key relationships and stores the WTN identifier separately on machine events. It also creates server-side synchronization and aggregate functions so the browser does not need to create machine records or infer join keys.

## Robust machine identity cleanup

Run `supabase/machine-identity-cleanup.sql` after the base schema and feature migrations.

The cleanup establishes one identity convention across the application:

- `machine_uuid`: internal UUID foreign key used for joins.
- `machine_wtn_id`: user-facing WTN identifier used for display, filtering, exports, and diagnostics.
- Legacy `machine_id` UUID columns remain synchronized temporarily for backward compatibility.

After running the migration, verify:

```sql
select *
from public.machine_identity_health
order by identity_status, agency, location_name;
```

Every populated machine should report `HEALTHY`.

## Reporting & Analytics

The Reports module includes Executive Summary, Location Evaluation, Machine Performance, Inventory Optimization, Staffing Analysis, Demand Analysis, Accessibility Analysis, Risk Assessment, Cost Analysis, Optimization Recommendations, Scenario Simulation, and Dissertation Export.

Each report supports shared agency/location/machine/product/date filters and exports to PDF, Excel, CSV, and print-friendly HTML. PDF and Excel are generated locally in the browser.

Optional performance indexes are in `supabase/reporting-analytics-migration.sql`.
