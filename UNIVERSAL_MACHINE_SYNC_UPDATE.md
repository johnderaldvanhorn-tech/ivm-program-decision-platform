# Universal Machine Synchronization Update

This batch removes machine-specific matching rules and applies one matching pipeline to every agency and machine.

Matching order:
1. Saved Machine Log source resolution.
2. Internal machine UUID.
3. WTN machine ID.
4. One unique normalized facility-name match.
5. Unresolved or ambiguous sources remain in Sync Conflicts for manual review.

The Machines & Inventory page now loads remembered aliases and applies them to both raw Machine Log events and aggregate Machine Log summaries. Product filtering continues to compare Machine Log selections against tied planogram ranges, while each range remains one planogram product location for selection and PAR calculations.

A new Data Management > Sync Conflicts page displays every Machine Log source, its current resolution, matching method, activity period, and dispensed units. Users can map a source to any machine, save the resolution, or ignore the source. Saved mappings are reused by future imports and analytics.

Run `machine-sync-conflicts-migration.sql` in Supabase before using the conflict page if the `machine_name_aliases` table has not already been created.
