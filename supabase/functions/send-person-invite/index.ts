import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts'

type InviteBody = {
  to?: string
  inviteUrl?: string
  personLabel?: string
  grantCanEdit?: boolean
  inviterName?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing Authorization', 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) return errorResponse('Unauthorized', 401)

    const { data: canEdit, error: canEditError } = await supabase.rpc('can_edit_tree')
    if (canEditError) return errorResponse(canEditError.message, 400)
    if (!canEdit) return errorResponse('Not an editor', 403)

    const body = (await req.json()) as InviteBody
    const to = body.to?.trim().toLowerCase() ?? ''
    const inviteUrl = body.inviteUrl?.trim() ?? ''
    const personLabel = (body.personLabel?.trim() || 'a family member').slice(0, 120)
    const grantCanEdit = body.grantCanEdit === true
    const inviterName = (
      body.inviterName?.trim() ||
      user.email ||
      'A family member'
    ).slice(0, 120)

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return errorResponse('Valid email is required', 400)
    }
    if (!inviteUrl || !/^https?:\/\//i.test(inviteUrl)) {
      return errorResponse('Valid invite URL is required', 400)
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')?.trim()
    if (!resendKey) {
      return errorResponse(
        'Email sending is not configured (missing RESEND_API_KEY). You can still copy the invite link.',
        503,
      )
    }

    const from =
      Deno.env.get('RESEND_FROM_EMAIL')?.trim() ||
      'Thomason Family Tree <onboarding@resend.dev>'
    const role = grantCanEdit ? 'editor' : 'viewer'
    const safePerson = escapeHtml(personLabel)
    const safeInviter = escapeHtml(inviterName)
    const safeUrl = escapeHtml(inviteUrl)

    const subject = `You're invited to the Thomason Family Tree as ${personLabel}`
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #1a1a1a;">
        <p>Hi,</p>
        <p><strong>${safeInviter}</strong> invited you to join the Thomason Family Tree as <strong>${safePerson}</strong> (${role}).</p>
        <p>
          <a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">
            Accept invitation
          </a>
        </p>
        <p style="font-size:14px;color:#555;">Or open this link:<br/><a href="${safeUrl}">${safeUrl}</a></p>
        <p style="font-size:13px;color:#777;">You'll sign in with Google. This link expires in 14 days.</p>
      </div>
    `
    const text = [
      `${inviterName} invited you to join the Thomason Family Tree as ${personLabel} (${role}).`,
      '',
      `Accept invitation: ${inviteUrl}`,
      '',
      "You'll sign in with Google. This link expires in 14 days.",
    ].join('\n')

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('Resend error', resendRes.status, detail)
      return errorResponse('Failed to send invitation email', 502)
    }

    return jsonResponse({ ok: true, emailed: true })
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return errorResponse(message, 500)
  }
})
