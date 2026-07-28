# Phase 2 — Enterprise User Invitations v1.1.0

Install:

```bash
chmod +x apply-phase-2.sh
./apply-phase-2.sh "$HOME/Projects/ivm-program-decision-platform"
```

Run `supabase/phase-2-enterprise-users-v1.1.0.sql` in Supabase SQL Editor.

Set secrets:

```bash
supabase secrets set RESEND_API_KEY="re_xxx" IVM_APP_URL="https://ivm.theburrowfarm.com" IVM_FROM_EMAIL="support@contact.splatterin.com" IVM_REPLY_TO="support@contact.splatterin.com"
```

Deploy:

```bash
supabase functions deploy invite-user
supabase functions deploy manage-user
```

Promote the first administrator if needed:

```sql
update public.user_profiles set role='Super Administrator', status='active' where email='YOUR_EMAIL';
```
