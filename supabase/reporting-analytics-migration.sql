-- Reporting support indexes. The reporting UI gracefully falls back when optional
-- source tables or RPCs are not yet present.
create index if not exists idx_machine_events_machine_datetime
  on public.machine_events(machine_uuid, event_datetime);
create index if not exists idx_machine_events_wtn_datetime
  on public.machine_events(machine_wtn_id, event_datetime);
create index if not exists idx_machine_planogram_machine
  on public.machine_planogram_items(machine_uuid);
create index if not exists idx_restock_events_machine_datetime
  on public.restock_events(machine_uuid, restock_datetime);
create index if not exists idx_locations_agency_location
  on public.locations(agency, location_name);
notify pgrst, 'reload schema';
