begin;

alter table public.locations
  add column if not exists location_name text;

update public.locations
set
  location_name = coalesce(
    nullif(trim(location_name), ''),
    nullif(trim(substring(agency from '\(([^()]*)\)\s*$')), ''),
    nullif(trim(agency), ''),
    'Unspecified Location'
  ),
  agency = case
    when agency ~ '\([^()]*\)\s*$'
      then coalesce(nullif(trim(regexp_replace(agency, '\s*\([^()]*\)\s*$', '')), ''), 'Unassigned Agency')
    else coalesce(nullif(trim(agency), ''), 'Unassigned Agency')
  end;

alter table public.locations
  alter column location_name set not null;

create index if not exists idx_locations_agency_location_name
  on public.locations (agency, location_name);

notify pgrst, 'reload schema';

commit;
