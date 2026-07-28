create table if not exists public.communication_settings (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    sender_name text not null default 'IVM Program',
    sender_email text not null default 'support@contact.splatterin.com',
    reply_to text not null default 'support@contact.splatterin.com',
    last_tested_at timestamptz,
    last_test_status text,
    updated_at timestamptz not null default now()
);

create unique index if not exists communication_settings_provider_key
on public.communication_settings(provider);

create table if not exists public.integration_secrets (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    api_key text not null,
    key_suffix text,
    updated_at timestamptz not null default now()
);

create unique index if not exists integration_secrets_provider_key
on public.integration_secrets(provider);

create table if not exists public.integration_audit_log (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    action text not null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

insert into public.communication_settings (
    provider,
    sender_name,
    sender_email,
    reply_to,
    updated_at
)
values (
    'resend',
    'IVM Program',
    'support@contact.splatterin.com',
    'support@contact.splatterin.com',
    now()
)
on conflict (provider)
do update set
    sender_name = excluded.sender_name,
    sender_email = excluded.sender_email,
    reply_to = excluded.reply_to,
    updated_at = excluded.updated_at;

alter table public.communication_settings
enable row level security;

alter table public.integration_secrets
enable row level security;

alter table public.integration_audit_log
enable row level security;

revoke all
on public.communication_settings
from anon, authenticated;

revoke all
on public.integration_secrets
from anon, authenticated;

revoke all
on public.integration_audit_log
from anon, authenticated;
