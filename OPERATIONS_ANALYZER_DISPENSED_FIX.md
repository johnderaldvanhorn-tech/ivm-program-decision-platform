# Operations Analyzer Dispensed Integration

- Uses `get_machine_log_machine_summary.units_dispensed` for all-product totals.
- Uses `stockout_count` from the same summary RPC.
- Retains raw-event calculations for product-filtered analysis.
- Supports both legacy and current RPC field names.
- Corrects machine UUID/WTN matching.
