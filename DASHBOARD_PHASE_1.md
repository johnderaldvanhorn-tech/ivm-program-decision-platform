# Dashboard Phase 1 — Program Command Center

This build replaces the passive dashboard with a decision-first command center.

## Included
- Weighted fleet health score
- Accessibility, inventory, machine, service-readiness, and data-quality meters
- Executive KPI strip with direct module navigation
- Prioritized Immediate Attention list
- Rule-based executive summary
- Quick actions
- Recent machine and restock activity
- Manual analytics refresh with timestamp
- Responsive desktop/tablet/mobile layout
- Navigation label changed from Dashboard to Command Center

## Included stability fixes
- Removes the unavailable `get_machine_service_demand_summary` RPC call
- Preserves an empty service-demand dataset until that RPC is intentionally installed
- Applies the nullable Supabase client guard in Operations Analyzer

## Install
Preserve `.env.local`, replace the project folder, then run:

```bash
npm install
npm run build
npm run dev
```
