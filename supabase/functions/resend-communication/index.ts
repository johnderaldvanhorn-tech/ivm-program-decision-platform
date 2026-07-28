import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-ivm-admin-token',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function validEmail(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
}

function databaseError(stage: string, error: any, status = 500) {
  console.error(`[${stage}]`, error)

  return json(
    {
      ok: false,
      stage,
      error: error?.message || `The ${stage} operation failed.`,
      details: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
    },
    status,
  )
}

Deno.serve(async (request) => {
  const requestStartedAt = Date.now()

  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (request.method !== 'POST') {
    return json(
      {
        ok: false,
        error: 'Method not allowed.',
      },
      405,
    )
  }

  const expectedToken =
    Deno.env.get('IVM_INTEGRATION_ADMIN_TOKEN') || ''

  const suppliedToken =
    request.headers.get('x-ivm-admin-token') || ''

  if (!expectedToken || suppliedToken !== expectedToken) {
    return json(
      {
        ok: false,
        stage: 'authorization',
        error: 'Integration administrator authorization failed.',
      },
      401,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        ok: false,
        stage: 'environment',
        error:
          'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unavailable.',
      },
      500,
    )
  }

  const client = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
      },
    },
  )

  const writeAudit = async (
    action: string,
    detail: Record<string, unknown>,
  ) => {
    const { error } = await client
      .from('integration_audit_log')
      .insert({
        provider: 'resend',
        action,
        detail: {
          ...detail,
          durationMs: Date.now() - requestStartedAt,
          occurredAt: new Date().toISOString(),
        },
      })

    if (error) {
      console.error('[integration_audit_log]', error)
    }
  }

  const loadStatus = async () => {
    const [
      settingsResult,
      secretResult,
    ] = await Promise.all([
      client
        .from('communication_settings')
        .select('*')
        .eq('provider', 'resend')
        .maybeSingle(),

      client
        .from('integration_secrets')
        .select('key_suffix')
        .eq('provider', 'resend')
        .maybeSingle(),
    ])

    if (settingsResult.error) {
      throw {
        stage: 'communication_settings_status',
        ...settingsResult.error,
      }
    }

    if (secretResult.error) {
      throw {
        stage: 'integration_secrets_status',
        ...secretResult.error,
      }
    }

    const settings = settingsResult.data
    const secret = secretResult.data

    const hasSettings = Boolean(settings)
    const hasApiKey = Boolean(secret)

    let connectionStatus = 'not_configured'

    if (hasSettings && hasApiKey) {
      connectionStatus =
        settings?.last_test_status === 'success'
          ? 'connected'
          : 'ready'
    } else if (hasSettings || hasApiKey) {
      connectionStatus = 'incomplete'
    }

    return {
      configured: hasSettings && hasApiKey,
      settingsConfigured: hasSettings,
      apiKeyConfigured: hasApiKey,
      connectionStatus,
      provider: 'resend',
      senderName:
        settings?.sender_name || 'IVM Program',
      senderEmail:
        settings?.sender_email ||
        'support@contact.splatterin.com',
      replyTo:
        settings?.reply_to ||
        'support@contact.splatterin.com',
      lastTestedAt:
        settings?.last_tested_at || null,
      lastTestStatus:
        settings?.last_test_status || null,
      keySuffix:
        secret?.key_suffix || null,
    }
  }

  try {
    const body = await request.json()
    const action = String(body.action || '')

    console.log(
      JSON.stringify({
        provider: 'resend',
        action,
        startedAt: new Date().toISOString(),
      }),
    )

    if (action === 'status') {
      const status = await loadStatus()

      return json({
        ok: true,
        status,
      })
    }

    if (action === 'save') {
      const senderName =
        String(body.senderName || '').trim()

      const senderEmail =
        String(body.senderEmail || '').trim()

      const replyTo =
        String(body.replyTo || '').trim()

      const apiKey =
        typeof body.apiKey === 'string'
          ? body.apiKey.trim()
          : ''

      if (
        !senderName ||
        !validEmail(senderEmail) ||
        !validEmail(replyTo)
      ) {
        return json(
          {
            ok: false,
            stage: 'validation',
            error:
              'Enter a valid sender name, sender email, and reply-to address.',
          },
          400,
        )
      }

      if (
        apiKey &&
        !apiKey.startsWith('re_')
      ) {
        return json(
          {
            ok: false,
            stage: 'validation',
            error:
              'The Resend API key must begin with re_.',
          },
          400,
        )
      }

      const now = new Date().toISOString()

      const settingsResult = await client
        .from('communication_settings')
        .upsert(
          {
            provider: 'resend',
            sender_name: senderName,
            sender_email: senderEmail,
            reply_to: replyTo,
            updated_at: now,
          },
          {
            onConflict: 'provider',
          },
        )
        .select('id, provider')
        .single()

      if (settingsResult.error) {
        return databaseError(
          'communication_settings',
          settingsResult.error,
        )
      }

      if (apiKey) {
        const secretResult = await client
          .from('integration_secrets')
          .upsert(
            {
              provider: 'resend',
              api_key: apiKey,
              key_suffix: apiKey.slice(-4),
              updated_at: now,
            },
            {
              onConflict: 'provider',
            },
          )
          .select('provider, key_suffix')
          .single()

        if (secretResult.error) {
          return databaseError(
            'integration_secrets',
            secretResult.error,
          )
        }
      }

      await writeAudit(
        apiKey
          ? 'configuration_and_key_updated'
          : 'configuration_updated',
        {
          senderEmail,
          replyTo,
          keyUpdated: Boolean(apiKey),
          result: 'success',
        },
      )

      return json({
        ok: true,
        message:
          'Resend configuration saved.',
        status: await loadStatus(),
      })
    }

    if (action === 'test') {
      const recipient =
        String(body.recipient || '').trim()

      const subject =
        String(
          body.subject ||
            'IVM Program Test Email',
        ).trim()

      const message =
        String(body.message || '').trim()

      if (!validEmail(recipient)) {
        return json(
          {
            ok: false,
            stage: 'validation',
            error:
              'Enter a valid recipient email address.',
          },
          400,
        )
      }

      const [
        settingsResult,
        secretResult,
      ] = await Promise.all([
        client
          .from('communication_settings')
          .select('*')
          .eq('provider', 'resend')
          .maybeSingle(),

        client
          .from('integration_secrets')
          .select('api_key')
          .eq('provider', 'resend')
          .maybeSingle(),
      ])

      if (settingsResult.error) {
        return databaseError(
          'communication_settings_test',
          settingsResult.error,
        )
      }

      if (secretResult.error) {
        return databaseError(
          'integration_secrets_test',
          secretResult.error,
        )
      }

      const settings = settingsResult.data
      const secret = secretResult.data

      if (!settings) {
        return json(
          {
            ok: false,
            stage: 'configuration',
            error:
              'Resend sender configuration is missing.',
          },
          400,
        )
      }

      if (!secret?.api_key) {
        return json(
          {
            ok: false,
            stage: 'configuration',
            error:
              'The Resend API key is not configured.',
          },
          400,
        )
      }

      const resendStartedAt = Date.now()

      const response = await fetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${secret.api_key}`,
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            from:
              `${settings.sender_name} <${settings.sender_email}>`,
            to: [recipient],
            reply_to:
              settings.reply_to,
            subject,
            text: message,
            html:
              `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a">` +
              `<h2>${subject.replace(/[<>]/g, '')}</h2>` +
              `<p>${message
                .replace(
                  /[&<>]/g,
                  (character: string) =>
                    ({
                      '&': '&amp;',
                      '<': '&lt;',
                      '>': '&gt;',
                    })[character]!,
                )
                .replace(/\n/g, '<br>')}</p>` +
              `<hr>` +
              `<p style="font-size:12px;color:#64748b">Sent by the IVM Program Decision Platform.</p>` +
              `</div>`,
          }),
        },
      )

      let payload: any = {}

      try {
        payload = await response.json()
      } catch {
        payload = {
          message:
            'Resend returned a non-JSON response.',
        }
      }

      const sentAt =
        new Date().toISOString()

      const success = response.ok

      const latencyMs =
        Date.now() - resendStartedAt

      const updateResult = await client
        .from('communication_settings')
        .update({
          last_tested_at: sentAt,
          last_test_status:
            success ? 'success' : 'failed',
          updated_at: sentAt,
        })
        .eq('provider', 'resend')

      if (updateResult.error) {
        console.error(
          '[communication_settings_test_update]',
          updateResult.error,
        )
      }

      await writeAudit(
        success
          ? 'test_email_sent'
          : 'test_email_failed',
        {
          recipient,
          providerResponse: payload,
          result:
            success ? 'success' : 'failed',
          httpStatus: response.status,
          latencyMs,
        },
      )

      if (!success) {
        return json(
          {
            ok: false,
            stage: 'resend_api',
            provider: 'resend',
            error:
              payload?.message ||
              payload?.error ||
              'Resend rejected the test email.',
            details: payload,
            httpStatus: response.status,
            latencyMs,
            sentAt,
          },
          response.status >= 400 &&
          response.status <= 599
            ? response.status
            : 502,
        )
      }

      return json({
        ok: true,
        message:
          'Test email accepted by Resend.',
        provider: 'resend',
        recipient,
        messageId:
          payload?.id || null,
        sentAt,
        latencyMs,
      })
    }

    return json(
      {
        ok: false,
        stage: 'request',
        error: 'Unknown action.',
      },
      400,
    )
  } catch (error: any) {
    console.error('[unexpected]', error)

    await writeAudit(
      'communication_request_failed',
      {
        result: 'failed',
        error:
          error?.message ||
          'Unexpected communication error.',
      },
    )

    return json(
      {
        ok: false,
        stage:
          error?.stage || 'unexpected',
        error:
          error?.message ||
          'Unexpected communication error.',
        details:
          error?.details || null,
        hint:
          error?.hint || null,
        code:
          error?.code || null,
      },
      500,
    )
  }
})
