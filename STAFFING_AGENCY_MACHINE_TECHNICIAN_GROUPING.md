# Staffing hierarchy update

The Staffing page now uses the hierarchy:

Agency
- Machine service demand
  - Anonymous technicians assigned through observed restock history

Agency cards roll up machine count, visits, units restocked, and distinct anonymous technicians. Machine rows show visits, units, technician count, average units per visit, and activity dates. Expanding a machine displays technician-specific visits, units, selections serviced, estimated hours, global utilization, and activity dates.

Run `staffing-machine-technician-detail-migration.sql` in Supabase before opening the updated page.
