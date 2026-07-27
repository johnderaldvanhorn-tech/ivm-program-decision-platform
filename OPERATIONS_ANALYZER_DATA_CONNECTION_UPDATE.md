# Operations Analyzer Data Connection Update

This batch updates the Operations Analyzer so it uses the shared reporting loader and connects operational records more reliably.

## Included changes

- Replaced the fixed 50,000-row Machine Events query with paginated table loading.
- Added Machine Events, machine aliases, inventory periods, and safety-stock records to the shared reporting dataset.
- Matches operational records by machine UUID, WTN ID, or saved machine-name alias.
- Normalizes product families, including Narcan and naloxone.
- Resolves product-filtered events through planogram selection ranges such as `100-101`.
- Applies the same product matching to restock records that do not contain a reliable product name.
- Added a Data Connection Check panel showing loaded rows, aliases, unresolved Machine Logs, and unresolved restocks.
- Corrected existing TypeScript issues in Machines and Sync Conflicts that prevented a clean type-check.

## Validation

`tsc -b` completed successfully. The Vite bundle step could not run in the packaging environment because the uploaded node_modules folder lacked Rollup's Linux optional binary. Run `npm install` on the target computer before starting the application.
