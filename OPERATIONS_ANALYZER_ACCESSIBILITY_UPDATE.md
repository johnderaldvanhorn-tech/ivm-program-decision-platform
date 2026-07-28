# Operations Analyzer Accessibility Integration

This update makes Operations Analyzer use the same embedded location-score records as the Locations page.

## Changes

- Supports Supabase one-to-one relations returned as either an object or a single-item array.
- Reads `location_access_scores.machine_accessibility_score` for accessibility.
- Reads `location_demographics.risk_score` for risk.
- Reads `location_demographics.maximum_location_score` for maximum location score.
- Excludes genuinely unscored records from the score averages rather than converting missing values into scored zeros.
- Applies the same robust relation handling to the shared reporting layer.
- Includes the existing TypeScript nullability and relation-normalization fixes required by Machines and Sync Conflicts.

No database migration is required.
