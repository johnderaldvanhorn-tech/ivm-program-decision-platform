import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing Supabase admin configuration')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function requireAdmin(request: Request) {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) throw new Response('Unauthorized', { status: 401 })
  const client = adminClient()
  const { data, error } = await client.auth.getUser(header.slice(7))
  if (error || !data.user) throw new Response('Unauthorized', { status: 401 })
  const { data: profile } = await client.from('user_profiles').select('role,status').eq('id', data.user.id).single()
  if (!profile || profile.status !== 'active' || !['Super Administrator','Administrator'].includes(profile.role)) {
    throw new Response('Forbidden', { status: 403 })
  }
  return { client, actor: data.user }
}
