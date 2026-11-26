import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts'

type InviteBody = {
  to?: string
  inviteUrl?: string
  personLabel?: string
  personUrl?: string
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

async function sendResendEmail(opts: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  html: string
  text: string
}): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  })
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await res.text() }
  }
  return { ok: true }
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
    const personUrl = body.personUrl?.trim() || ''
    const grantCanEdit = body.grantCanEdit === true

    const { data: displayName } = await supabase.rpc('my_person_display_name')
    const inviterName = (
      (typeof displayName === 'string' && displayName.trim()) ||
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
    if (personUrl && !/^https?:\/\//i.test(personUrl)) {
      return errorResponse('Valid person URL is required', 400)
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
    const safeInvitee = escapeHtml(to)
    const safeInviteUrl = escapeHtml(inviteUrl)
    const safePersonUrl = personUrl ? escapeHtml(personUrl) : ''

    const inviteSubject = `You're invited to the Thomason Family Tree as ${personLabel}`
    const inviteHtml = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #1a1a1a;">
        <p>Hi,</p>
        <p><strong>${safeInviter}</strong> invited you to join the Thomason Family Tree as <strong>${safePerson}</strong> (${role}).</p>
        <p>
          <a href="${safeInviteUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">
            Accept invitation
          </a>
        </p>
        <p style="font-size:14px;color:#555;">Or open this link:<br/><a href="${safeInviteUrl}">${safeInviteUrl}</a></p>
        <p style="font-size:13px;color:#777;">You'll sign in with Google. This link expires in 14 days.</p>
      </div>
    `
    const inviteText = [
      `${inviterName} invited you to join the Thomason Family Tree as ${personLabel} (${role}).`,
      '',
      `Accept invitation: ${inviteUrl}`,
      '',
      "You'll sign in with Google. This link expires in 14 days.",
    ].join('\n')

    const inviteSend = await sendResendEmail({
      apiKey: resendKey,
      from,
      to: [to],
      subject: inviteSubject,
      html: inviteHtml,
      text: inviteText,
    })
    if (!inviteSend.ok) {
      console.error('Resend invite error', inviteSend.status, inviteSend.detail)
      let detail = inviteSend.detail.slice(0, 500)
      try {
        const parsed = JSON.parse(inviteSend.detail) as { message?: string }
        if (parsed.message) detail = parsed.message
      } catch {
        /* keep raw detail */
      }
      return errorResponse(
        `Failed to send invitation email (${inviteSend.status}): ${detail}`,
        502,
      )
    }

    const { data: editorRows, error: editorError } = await supabase.rpc(
      'list_editor_notification_emails',
    )
    if (editorError) {
      console.error('list_editor_notification_emails failed', editorError)
    } else {
      const editorEmails = (editorRows ?? [])
        .map((row: { email?: string } | string) =>
          typeof row === 'string' ? row : row.email,
        )
        .map((email) => email?.trim().toLowerCase() ?? '')
        .filter((email) => email && email !== to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))

      if (editorEmails.length > 0) {
        const personLinkHtml = safePersonUrl
          ? `<a href="${safePersonUrl}">${safePerson}</a>`
          : `<strong>${safePerson}</strong>`
        const personLinkText = personUrl ? `${personLabel} (${personUrl})` : personLabel
        const notifySubject = `${inviterName} invited ${to} to join as ${personLabel}`
        const notifyHtml = `
          <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #1a1a1a;">
            <p><strong>${safeInviter}</strong> invited <strong>${safeInvitee}</strong> to join as ${personLinkHtml}.</p>
            <p style="font-size:13px;color:#777;">Role offered: ${role}.</p>
          </div>
        `
        const notifyText = `${inviterName} invited ${to} to join as ${personLinkText}.`

        // Resend accepts multiple recipients on one send; keep one email per batch.
        const notifySend = await sendResendEmail({
          apiKey: resendKey,
          from,
          to: editorEmails,
          subject: notifySubject,
          html: notifyHtml,
          text: notifyText,
        })
        if (!notifySend.ok) {
          console.error('Resend editor notify error', notifySend.status, notifySend.detail)
        }
      }
    }

    return jsonResponse({ ok: true, emailed: true })
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return errorResponse(message, 500)
  }
})
