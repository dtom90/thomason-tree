function writeUrl(url: URL, mode: 'push' | 'replace'): void {
  const next = `${url.pathname}${url.search}${url.hash}`
  if (mode === 'push') window.history.pushState({}, '', next)
  else window.history.replaceState({}, '', next)
}

export function getPhotosViewFromUrl(): boolean {
  return new URLSearchParams(window.location.search).get('view') === 'photos'
}

export function setPhotosViewInUrl(active: boolean): void {
  const url = new URL(window.location.href)
  const isPhotos = url.searchParams.get('view') === 'photos'
  if (active) {
    if (isPhotos) return
    url.searchParams.set('view', 'photos')
  } else {
    if (!isPhotos && !url.searchParams.has('photo')) return
    url.searchParams.delete('view')
    url.searchParams.delete('photo')
  }
  writeUrl(url, 'replace')
}

export function getPhotoIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('photo')?.trim() || null
}

export function setPhotoIdInUrl(photoId: string | null, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href)
  const current = url.searchParams.get('photo')?.trim() || null
  if (photoId) {
    if (current === photoId && url.searchParams.get('view') === 'photos') return
    url.searchParams.set('view', 'photos')
    url.searchParams.set('photo', photoId)
  } else {
    if (!current) return
    url.searchParams.delete('photo')
  }
  writeUrl(url, mode)
}
