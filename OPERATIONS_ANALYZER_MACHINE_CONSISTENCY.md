# Operations Analyzer / Machines & Inventory consistency update

The Operations Analyzer now uses the same product-resolution rules as Machines & Inventory:

- Product aliases are matched by canonical family. Narcan and naloxone variants resolve to the same naloxone family.
- Product filtering follows the planogram first rather than relying on exact event product text.
- Tied selections such as `100-101` are matched by range containment.
- Machine records are matched using UUID, internal machine ID, and WTN ID.
- If a selected product family covers every planogram selection in a machine, the analyzer uses the machine-level Machine Logs summary, matching Machines & Inventory.
- Draft filter changes do not affect displayed results until Review / Update Review is selected.
- Report exports use the applied filter state rather than the unsubmitted draft state.
