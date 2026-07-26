# Phase 2 Decision Support

Phase 1 operational pages remain under their existing routes and database tables.
Phase 2 pages are isolated under `/phase-2/*` and do not update Phase 1 operational records automatically.

## Included
- Optimization Center
- Recommendation Center with approve/defer/reject workflow
- Scenario & Simulation Lab
- Forecasting baseline
- Research Mode
- Model Validation
- Equity & Availability

## Database
Run `supabase/phase-2-decision-support-migration.sql` to create Phase 2-only recommendation, scenario, and research snapshot tables.
