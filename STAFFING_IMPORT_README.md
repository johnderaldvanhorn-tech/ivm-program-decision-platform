# Staffing & Restock Operations

1. Run `supabase/staffing-restock-migration.sql` in Supabase SQL Editor.
2. Start the application and open **Staffing**.
3. Upload `sample-imports/RestockSummaryReport-sample.csv` or another Restock Summary Report.
4. Map every source machine to a WTN machine or mark it ignored.
5. Map each restock person to a technician, create the technician, or mark it ignored.
6. Import the restock rows. Duplicate rows are prevented by `import_key`.

Workload estimate:

`base visit hours + (units restocked × hours per unit) + (selections serviced × hours per selection)`

Defaults are stored in `program_parameters` and can be adjusted later through the Calculations page.
