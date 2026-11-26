import type { Data } from 'family-chart'
import type { PhotoRegionRow } from './lib/database.types'
import { fetchDriveImageUrl } from './drive-api'
import { supabase } from './lib/supabase'

export type PersonAvatarRef = {
  driveFileId: string
  regionId: string | null
  region: Pick<PhotoRegionRow, 'x' | 'y' | 'w' | 'h'> | null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = url
  })
}

/** Crop a blob URL to a normalized face region (with padding) for card avatars. */
export async function cropAvatarUrl(
  imageUrl: string,
  region: Pick<PhotoRegionRow, 'x' | 'y' | 'w' | 'h'>,
): Promise<string> {
  const img = await loadImage(imageUrl)
  const pad = 0.18
  const x = Math.max(0, region.x - region.w * pad)
  const y = Math.max(0, region.y - region.h * pad)
  const w = Math.min(1 - x, region.w * (1 + pad * 2))
  const h = Math.min(1 - y, region.h * (1 + pad * 2))

  const side = Math.max(w * img.naturalWidth, h * img.naturalHeight)
  const cx = (x + w / 2) * img.naturalWidth
  const cy = (y + h / 2) * img.naturalHeight
  const sx = Math.max(0, Math.min(img.naturalWidth - side, cx - side / 2))
  const sy = Math.max(0, Math.min(img.naturalHeight - side, cy - side / 2))
  const sw = Math.min(side, img.naturalWidth - sx)
  const sh = Math.min(side, img.naturalHeight - sy)

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Avatar encode failed'))),
      'image/jpeg',
      0.85,
    )
  })
  return URL.createObjectURL(blob)
}

export async function resolveAvatarUrl(ref: PersonAvatarRef): Promise<string> {
  const thumbUrl = await fetchDriveImageUrl(ref.driveFileId, 'thumb')
  if (!ref.region) return thumbUrl
  try {
    const cropped = await cropAvatarUrl(thumbUrl, ref.region)
    URL.revokeObjectURL(thumbUrl)
    return cropped
  } catch {
    return thumbUrl
  }
}

export async function loadAvatarRefs(
  people: Array<{
    id: string
    avatar_drive_file_id: string | null
    avatar_region_id: string | null
  }>,
): Promise<Map<string, PersonAvatarRef>> {
  const refs = new Map<string, PersonAvatarRef>()
  const withAvatar = people.filter((p) => p.avatar_drive_file_id)
  if (withAvatar.length === 0) return refs

  const regionIds = [
    ...new Set(
      withAvatar
        .map((p) => p.avatar_region_id)
        .filter((id): id is string => !!id),
    ),
  ]
  const regionById = new Map<string, Pick<PhotoRegionRow, 'x' | 'y' | 'w' | 'h'>>()
  if (regionIds.length > 0) {
    const { data, error } = await supabase
      .from('photo_regions')
      .select('id, x, y, w, h')
      .in('id', regionIds)
    if (error) throw error
    for (const row of data ?? []) {
      regionById.set(row.id, { x: row.x, y: row.y, w: row.w, h: row.h })
    }
  }

  for (const person of withAvatar) {
    if (!person.avatar_drive_file_id) continue
    refs.set(person.id, {
      driveFileId: person.avatar_drive_file_id,
      regionId: person.avatar_region_id,
      region: person.avatar_region_id
        ? (regionById.get(person.avatar_region_id) ?? null)
        : null,
    })
  }
  return refs
}

/** Fetch avatar blob URLs and assign them to chart `data.avatar`. Returns URLs to revoke later. */
export async function hydrateChartAvatars(
  data: Data,
  refs: Map<string, PersonAvatarRef>,
): Promise<string[]> {
  const uniqueFiles = new Map<string, PersonAvatarRef>()
  for (const ref of refs.values()) {
    const key = `${ref.driveFileId}|${ref.regionId ?? ''}`
    if (!uniqueFiles.has(key)) uniqueFiles.set(key, ref)
  }

  const urlByKey = new Map<string, string>()
  await Promise.all(
    [...uniqueFiles.entries()].map(async ([key, ref]) => {
      try {
        urlByKey.set(key, await resolveAvatarUrl(ref))
      } catch (err) {
        console.warn('Avatar load failed', ref.driveFileId, err)
      }
    }),
  )

  const blobUrls: string[] = []
  for (const datum of data) {
    const ref = refs.get(datum.id)
    if (!ref) continue
    const key = `${ref.driveFileId}|${ref.regionId ?? ''}`
    const url = urlByKey.get(key)
    if (!url) continue
    datum.data.avatar = url
    if (!blobUrls.includes(url)) blobUrls.push(url)
  }
  return blobUrls
}
