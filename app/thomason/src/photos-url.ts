export type PhotosBrowseMode = 'folder' | 'gallery'

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
    if (!isPhotos && !url.searchParams.has('photo') && !url.searchParams.has('layout')) return
    url.searchParams.delete('view')
    url.searchParams.delete('photo')
    url.searchParams.delete('layout')
  }
  writeUrl(url, 'replace')
}

export function getPhotosBrowseModeFromUrl(): PhotosBrowseMode {
  return new URLSearchParams(window.location.search).get('layout') === 'gallery'
    ? 'gallery'
    : 'folder'
}

export function setPhotosBrowseModeInUrl(
  mode: PhotosBrowseMode,
  historyMode: 'push' | 'replace' = 'replace',
): void {
  const url = new URL(window.location.href)
  const current = getPhotosBrowseModeFromUrl()
  if (current === mode && url.searchParams.get('view') === 'photos') {
    if (mode === 'gallery' && url.searchParams.get('layout') === 'gallery') return
    if (mode === 'folder' && !url.searchParams.has('layout')) return
  }

  url.searchParams.set('view', 'photos')
  if (mode === 'gallery') url.searchParams.set('layout', 'gallery')
  else url.searchParams.delete('layout')
  writeUrl(url, historyMode)
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
