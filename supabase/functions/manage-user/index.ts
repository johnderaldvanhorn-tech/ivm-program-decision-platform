import { corsHeaders, requireAdmin } from '../_shared/admin.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { client, actor } = await requireAdmin(request)
    const body = await request.json()
    const { action, userId } = body
    if (!action || !userId) return Response.json({ error: 'action and userId are required' }, { status: 400, headers: corsHeaders })
    if (userId === actor.id && ['lock','disable','delete'].includes(action)) return Response.json({ error: 'You cannot disable your own account' }, { status: 400, headers: corsHeaders })

    if (action === 'lock') {
      await client.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
      await client.from('user_profiles').update({ status: 'locked', locked_at: new Date().toISOString() }).eq('id', userId)
    } else if (action === 'unlock') {
      await client.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      await client.from('user_profiles').update({ status: 'active', locked_at: null }).eq('id', userId)
    } else if (action === 'disable') {
      await client.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
      await client.from('user_profiles').update({ status: 'disabled', disabled_at: new Date().toISOString() }).eq('id', userId)
    } else if (action === 'enable') {
      await client.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      await client.from('user_profiles').update({ status: 'active', disabled_at: null }).eq('id', userId)
    } else if (action === 'delete') {
      const result = await client.auth.admin.deleteUser(userId)
      if (result.error) throw result.error
    } else if (action === 'reset_password') {
      await client.from('user_profiles').update({ status: 'password_reset_required' }).eq('id', userId)
    } else if (action === 'update_profile') {
      await client.from('user_profiles').update({ role: body.role, department: body.department || null, first_name: body.firstName || null, last_name: body.lastName || null }).eq('id', userId)
    }

    await client.from('user_audit_log').insert({ actor_user_id: actor.id, target_user_id: userId, action, details: body })
    return Response.json({ success: true }, { headers: corsHeaders })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 500, headers: corsHeaders })
  }
})
