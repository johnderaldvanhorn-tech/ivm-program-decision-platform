import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

const hasPlaceholderKey =
  !supabaseKey || supabaseKey === 'PASTE_YOUR_PUBLISHABLE_KEY_HERE'

export const supabase =
  supabaseUrl && !hasPlaceholderKey
    ? createClient(supabaseUrl, supabaseKey)
    : null

export const isSupabaseConfigured = Boolean(supabase)
