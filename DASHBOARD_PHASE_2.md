# Dashboard Phase 2 – Operational Intelligence

This build extends the Command Center with:

- Agency health rankings with drill-down links to Operations Analyzer
- Accessibility-colored fleet location map
- Product-level inventory risk ranking
- Top-performing and highest-risk machine panels
- Machine spotlight for the strongest current risk signal
- 7/30/90-day operational trend center
- Consolidated alert center
- Expanded operational timeline
- Shared reporting and safety-stock data sources

No new database migration is required. The dashboard uses the existing reporting tables and `get_safety_stock_analysis` RPC.
