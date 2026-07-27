# Milford Log Linkage Update

This batch keeps tied planogram selections as one product location and improves the Machine Logs linkage used by product-filtered calculations.

- Planogram records are indexed by both internal machine UUID and WTN machine ID.
- Machine Log rows are loaded by UUID, WTN ID, exact source name, and a contained-name fallback.
- Decorated export names such as `Milford BCCS` now match a location stored as `Milford`.
- Planogram ranges such as `104-105` remain one selection/PAR row, while log events at 104 or 105 both match that product.
