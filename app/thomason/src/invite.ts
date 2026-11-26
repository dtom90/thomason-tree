const STORAGE_KEY = 'thomason_pending_invite'

/** Persist invite from the URL (keeps it for OAuth redirect). Does not consume. */
export function captureInviteFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('invite')?.trim()
  if (!token) return peekPendingInvite()

  sessionStorage.setItem(STORAGE_KEY, token)
  params.delete('invite')
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', next)
  return token
}

export function peekPendingInvite(): string | null {
  return sessionStorage.getItem(STORAGE_KEY)
}

/** Take invite once (URL + storage) so parallel bootstraps cannot double-redeem. */
export function takePendingInvite(): string | null {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('invite')?.trim() || null
  if (fromUrl) {
    params.delete('invite')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', next)
  }
  const fromStorage = sessionStorage.getItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  return fromUrl || fromStorage
}

export function restorePendingInvite(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token)
}

export function clearPendingInvite(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function inviteUrl(token: string): string {
  const url = new URL(window.location.origin)
  url.searchParams.set('invite', token)
  return url.toString()
}
