import { corsHeaders, requireAdmin } from '../_shared/admin.ts'

type InviteRequest = {
  email?: string
  firstName?: string
  lastName?: string
  role?: string
  department?: string
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed', stage: 'request_validation' },
      405,
    )
  }

  let stage = 'authorization'

  try {
    const { client, actor } = await requireAdmin(request)

    stage = 'request_parsing'

    const body = await request.json() as InviteRequest
    const email = String(body.email || '').trim().toLowerCase()
    const firstName = String(body.firstName || '').trim() || null
    const lastName = String(body.lastName || '').trim() || null
    const department = String(body.department || '').trim() || null
    const role = String(body.role || 'Viewer').trim() || 'Viewer'

    if (!email) {
      return jsonResponse(
        { error: 'Email is required', stage },
        400,
      )
    }

    const appUrl = (
      Deno.env.get('IVM_APP_URL') ||
      'https://ivm.theburrowfarm.com'
    ).replace(/\/+$/, '')

    stage = 'auth_invitation_link'

    const { data: linkData, error: linkError } =
      await client.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${appUrl}/auth/callback`,
          data: {
            first_name: firstName,
            last_name: lastName,
            role,
            department,
          },
        },
      })

    if (linkError) {
      console.error('generateLink failed:', linkError)

      return jsonResponse(
        {
          error: linkError.message,
          stage,
          details: linkError,
        },
        400,
      )
    }

    const user = linkData?.user
    const actionLink = linkData?.properties?.action_link

    if (!user?.id) {
      throw new Error('Supabase did not return an invited user ID.')
    }

    if (!actionLink) {
      throw new Error('Supabase did not return an invitation action link.')
    }

    stage = 'profile_upsert'

    const { error: profileError } = await client
      .from('user_profiles')
      .upsert(
        {
          id: user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          department,
          status: 'pending_invitation',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )

    if (profileError) {
      console.error('user_profiles upsert failed:', profileError)

      return jsonResponse(
        {
          error: profileError.message,
          stage,
          details: profileError,
          userId: user.id,
        },
        500,
      )
    }

    /*
     * Invitation tracking should not prevent the actual Supabase Auth
     * account and invitation email from being created. A schema or RLS
     * issue here will be reported as a warning rather than crashing.
     */
    stage = 'invitation_tracking'

    let invitationId: string | null = null
    const warnings: string[] = []

    const {
      data: invitation,
      error: invitationError,
    } = await client
      .from('user_invitations')
      .insert({
        user_id: user.id,
        email,
        role,
        department,
        invited_by: actor.id,
        last_sent_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()

    if (invitationError) {
      console.error(
        'user_invitations insert warning:',
        invitationError,
      )
      warnings.push(
        `Invitation tracking was not recorded: ${invitationError.message}`,
      )
    } else {
      invitationId = invitation?.id || null
    }

    stage = 'email_configuration'

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('IVM_FROM_EMAIL')
    const fromName = Deno.env.get('IVM_FROM_NAME') || 'IVM Program'
    const replyTo = Deno.env.get('IVM_REPLY_TO') || fromEmail

    if (!resendKey) {
      throw new Error('Missing RESEND_API_KEY')
    }

    if (!fromEmail) {
      throw new Error('Missing IVM_FROM_EMAIL')
    }

    const fullName =
      [firstName, lastName].filter(Boolean).join(' ') || email

    stage = 'resend_email'

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [email],
        reply_to: replyTo,
        subject:
          'You have been invited to the IVM Program Decision Platform',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px">
            <h1 style="margin-bottom:20px">IVM Program</h1>
            <p>Hello ${escapeHtml(fullName)},</p>
            <p>
              You have been invited to the IVM Program Decision Platform
              as <strong>${escapeHtml(role)}</strong>.
            </p>
            <p style="margin:28px 0">
              <a
                href="${actionLink}"
                style="background:#2563eb;color:#ffffff;padding:12px 18px;text-decoration:none;border-radius:8px;display:inline-block"
              >
                Accept Invitation
              </a>
            </p>
            <p>
              If the button does not work, copy and paste this address
              into your browser:
            </p>
            <p style="word-break:break-all">${actionLink}</p>
          </div>
        `,
      }),
    })

    const resendText = await sent.text()

    let resendPayload: Record<string, unknown> = {}

    try {
      resendPayload = resendText
        ? JSON.parse(resendText)
        : {}
    } catch {
      resendPayload = { raw: resendText }
    }

    if (!sent.ok) {
      console.error('Resend failed:', resendPayload)

      return jsonResponse(
        {
          error: 'Invitation account was created, but email delivery failed.',
          stage,
          details: resendPayload,
          userId: user.id,
          warnings,
        },
        502,
      )
    }

    const messageId =
      typeof resendPayload.id === 'string'
        ? resendPayload.id
        : null

    if (invitationId && messageId) {
      stage = 'invitation_tracking_update'

      const { error: trackingUpdateError } = await client
        .from('user_invitations')
        .update({ resend_message_id: messageId })
        .eq('id', invitationId)

      if (trackingUpdateError) {
        console.error(
          'Invitation tracking update warning:',
          trackingUpdateError,
        )
        warnings.push(
          `Invitation message ID was not recorded: ${trackingUpdateError.message}`,
        )
      }
    }

    stage = 'audit_log'

    const { error: auditError } = await client
      .from('user_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: user.id,
        action: 'invitation_sent',
        details: {
          email,
          role,
          department,
          message_id: messageId,
        },
      })

    if (auditError) {
      console.error('Audit log warning:', auditError)
      warnings.push(
        `Audit log was not recorded: ${auditError.message}`,
      )
    }

    return jsonResponse({
      success: true,
      userId: user.id,
      messageId,
      warnings,
    })
  } catch (error) {
    console.error(`invite-user failed during ${stage}:`, error)

    if (error instanceof Response) {
      return error
    }

    return jsonResponse(
      {
        error: errorMessage(error),
        stage,
      },
      500,
    )
  }
})
