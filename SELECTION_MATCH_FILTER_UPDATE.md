# Selection-Matched Product Dispense Update

The Machines & Inventory product filter now calculates dispense metrics through the direct operational relationship:

1. Selected products identify matching planogram rows.
2. Matching planogram rows provide selection numbers.
3. Machine Log rows are matched to those normalized selection numbers.
4. Successful dispense quantities are summed.
5. Average dispensed per day is calculated from the first through last matched dispense date.

Machine Log product text is not required for matching.

Selection values such as `100`, `100.0`, `Selection 100`, and `Selection: 100` normalize to the same key.

Machine Events are loaded in 1,000-row pages so Supabase's response limit does not omit older log records.
