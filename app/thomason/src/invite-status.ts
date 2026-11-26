import type { PersonInviteRow } from './lib/database.types'

export type PendingPersonInvite = {
  personId: string
  personLabel: string
  email: string | null
  grantCanEdit: boolean
}

export type PersonInviteStatus =
  | { kind: 'queued'; email: string | null; grantCanEdit: boolean }
  | { kind: 'joined' }
  | { kind: 'pending'; email: string | null; grantCanEdit: boolean; expiresAt: string }
  | { kind: 'redeemed'; email: string | null }
  | { kind: 'expired'; email: string | null }
  | { kind: 'none' }

export function resolvePersonInviteStatus(opts: {
  personId: string
  claimed: boolean
  queued: PendingPersonInvite | undefined
  latestInvite: PersonInviteRow | undefined
  now?: Date
}): PersonInviteStatus {
  if (opts.queued) {
    return {
      kind: 'queued',
      email: opts.queued.email,
      grantCanEdit: opts.queued.grantCanEdit,
    }
  }
  if (opts.claimed) return { kind: 'joined' }

  const invite = opts.latestInvite
  if (!invite) return { kind: 'none' }

  if (invite.redeemed_at) {
    return { kind: 'redeemed', email: invite.email }
  }

  const now = opts.now ?? new Date()
  if (new Date(invite.expires_at).getTime() <= now.getTime()) {
    return { kind: 'expired', email: invite.email }
  }

  return {
    kind: 'pending',
    email: invite.email,
    grantCanEdit: invite.grant_can_edit,
    expiresAt: invite.expires_at,
  }
}

export function inviteStatusCopy(status: PersonInviteStatus): string {
  switch (status.kind) {
    case 'queued':
      return status.email
        ? `Queued — click Save to email ${status.email}`
        : 'Queued — click Save to create the invite link'
    case 'joined':
      return 'Joined — this person is linked to an account'
    case 'pending':
      return status.email
        ? `Pending — invited ${status.email}${status.grantCanEdit ? ' as editor' : ''}`
        : `Pending — invite link created${status.grantCanEdit ? ' (editor)' : ''}`
    case 'redeemed':
      return status.email
        ? `Accepted by ${status.email}`
        : 'Invite accepted'
    case 'expired':
      return status.email
        ? `Expired invite to ${status.email}`
        : 'Invite expired'
    case 'none':
      return 'Invite someone to join as this person'
  }
}

export function inviteStatusActionLabel(status: PersonInviteStatus): string | null {
  switch (status.kind) {
    case 'queued':
      return 'Edit'
    case 'joined':
      return null
    case 'pending':
      return 'Invite again'
    case 'redeemed':
    case 'expired':
    case 'none':
      return 'Invite'
  }
}
