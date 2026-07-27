# Agency Deletion Update

The Locations page now includes a red trash action on every agency header. Deletion requires typing the exact agency name and calls the transactional `delete_agency_cascade` RPC.

The database removes the agency's locations and machines, with cascading deletion of machine logs, planograms, inventory periods, safety-stock records, demand parameters, restock events, service tasks/assignments, optimization recommendations, and related machine aliases. Anonymous technicians are only removed when they have no remaining restock history, service assignments, or aliases.

Run `supabase/delete-agency-cascade-migration.sql` once before using the action.
