# Resend Integration Setup — v0.9.5

The UI is available at **Settings → Integrations**. The Resend API key is submitted to a Supabase Edge Function and stored in a private table that has no browser RLS policies. The complete key is never returned to the browser.

## 1. Run the migration

In Supabase SQL Editor, run:

`supabase/resend-communication-migration.sql`

## 2. Create an administrator token

Generate a long random token:

```bash
openssl rand -hex 32
```

Add the same value to the local `.env.local` file:

```env
VITE_IVM_INTEGRATION_ADMIN_TOKEN=YOUR_RANDOM_TOKEN
```

## 3. Set the Edge Function secret

```bash
supabase secrets set IVM_INTEGRATION_ADMIN_TOKEN=YOUR_RANDOM_TOKEN
```

The standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` variables are automatically available to deployed Supabase Edge Functions.

## 4. Deploy the function

```bash
supabase functions deploy resend-communication --no-verify-jwt
```

The function performs its own administrator-token check because this build currently uses local browser authentication rather than Supabase Auth.

## 5. Restart the application

```bash
npm run build
npm run dev
```

Open **Settings → Integrations**, enter the Resend API key, and save. The default From and Reply-To address is `support@contact.splatterin.com`.

## Production requirement

Before public production deployment, replace the temporary integration administrator token with Supabase Auth role validation and move secret storage to a managed secret store or encrypted vault.
