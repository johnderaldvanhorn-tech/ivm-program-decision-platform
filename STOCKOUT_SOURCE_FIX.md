# Operations Analyzer Stockout Source Fix

Operations Analyzer now uses the same Machine Logs machine-summary stockout counts used by the Machine Logs and Safety Stock reporting flow when the product filter is set to All Products.

- Machine identity matches by UUID, internal machine ID, WTN ID, or source identifier.
- Product-filtered views continue to use product-matched raw stockout events because the machine-level summary is not product-specific.
- Availability is calculated as fulfilled demand / (fulfilled demand + observed stockout attempts), rather than stockouts divided by every event type.
