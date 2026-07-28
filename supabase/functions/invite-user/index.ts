import { corsHeaders, requireAdmin } from '../_shared/admin.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { client, actor } = await requireAdmin(request)
    const body = await request.json()
    const email = String(body.email || '').trim().toLowerCase()
    if (!email) return Response.json({ error: 'Email is required' }, { status: 400, headers: corsHeaders })

    const appUrl = Deno.env.get('IVM_APP_URL') || 'https://ivm.theburrowfarm.com'
    const role = body.role || 'Viewer'
    const { data, error } = await client.auth.admin.generateLink({
      type: 'invite', email,
      options: { redirectTo: `${appUrl}/auth/callback`, data: {
        first_name: body.firstName || null,
        last_name: body.lastName || null,
        role,
        department: body.department || null,
      }}
    })
    if (error) throw error

    const user = data.user
    await client.from('user_profiles').upsert({
      id: user.id, email,
      first_name: body.firstName || null,
      last_name: body.lastName || null,
      role,
      department: body.department || null,
      status: 'pending_invitation'
    }, { onConflict: 'id' })

    const { data: invitation } = await client.from('user_invitations').insert({
      user_id: user.id, email, role,
      department: body.department || null,
      invited_by: actor.id,
      last_sent_at: new Date().toISOString()
    }).select().single()

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('Missing RESEND_API_KEY')
    const actionLink = data.properties?.action_link || `${appUrl}/login`
    const fromEmail = Deno.env.get('IVM_FROM_EMAIL') || 'support@contact.splatterin.com'
    const replyTo = Deno.env.get('IVM_REPLY_TO') || 'support@contact.splatterin.com'
    const fullName = [body.firstName, body.lastName].filter(Boolean).join(' ') || email

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `IVM Program <${fromEmail}>`, to: [email], reply_to: replyTo,
        subject: 'You have been invited to the IVM Program Decision Platform',
        html: `<div style="font-family:Arial;max-width:620px;margin:auto"><h1>IVM Program</h1><p>Hello ${fullName},</p><p>You have been invited as <strong>${role}</strong>.</p><p><a href="${actionLink}" style="background:#2563eb;color:white;padding:12px 18px;text-decoration:none;border-radius:8px">Accept Invitation</a></p><p>This link expires in 72 hours.</p></div>`
      })
    })
    const payload = await sent.json()
    if (!sent.ok) throw new Error(JSON.stringify(payload))

    await client.from('user_invitations').update({ resend_message_id: payload.id }).eq('id', invitation.id)
    await client.from('user_audit_log').insert({ actor_user_id: actor.id, target_user_id: user.id, action: 'invitation_sent', details: { email, role } })
    return Response.json({ success: true, userId: user.id, messageId: payload.id }, { headers: corsHeaders })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: error instanceof Error ? error.message : 'Invitation failed' }, { status: 500, headers: corsHeaders })
  }
})
