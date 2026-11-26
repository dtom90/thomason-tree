export function getPersonIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('person')?.trim() || null
}

export function setPersonIdInUrl(personId: string): void {
  const url = new URL(window.location.href)
  if (url.searchParams.get('person') === personId) return
  url.searchParams.set('person', personId)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}
