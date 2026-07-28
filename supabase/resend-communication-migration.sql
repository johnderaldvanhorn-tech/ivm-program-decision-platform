-- IVM Program v0.9.5: private communication settings and audit history.
create table if not exists public.integration_secrets (
  provider text primary key,
  api_key text not null,
  key_suffix text,
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_settings (
  provider text primary key,
  sender_name text not null default 'IVM Program',
  sender_email text not null default 'support@contact.splatterin.com',
  reply_to text not null default 'support@contact.splatterin.com',
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('success','failed')),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_audit_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.communication_settings(provider, sender_name, sender_email, reply_to)
values ('resend', 'IVM Program', 'support@contact.splatterin.com', 'support@contact.splatterin.com')
on conflict (provider) do nothing;

alter table public.integration_secrets enable row level security;
alter table public.communication_settings enable row level security;
alter table public.integration_audit_log enable row level security;

-- Deliberately create no browser policies. Only the Edge Function service-role client may read or write these tables.
revoke all on table public.integration_secrets from anon, authenticated;
revoke all on table public.communication_settings from anon, authenticated;
revoke all on table public.integration_audit_log from anon, authenticated;
