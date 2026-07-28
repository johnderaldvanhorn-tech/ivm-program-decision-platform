# IVM Authentication Foundation v1.0.0

This ZIP is an installable overlay for the existing IVM project.

## Install
```bash
chmod +x apply-auth-foundation.sh
./apply-auth-foundation.sh "$HOME/Projects/ivm-program-decision-platform"
```
Then run `supabase/auth-foundation-v1.0.0.sql` in the Supabase SQL Editor and ensure `.env.local` contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or the existing publishable key).

Production URL: `https://ivm.theburrowfarm.com`
Required redirects: `/auth/callback` and `/reset-password` for production and localhost:5174.

Create the first account in Supabase Dashboard > Authentication > Users.
