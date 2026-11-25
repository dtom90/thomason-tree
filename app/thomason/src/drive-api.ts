import { supabase } from './lib/supabase'
import type { PhotoCommentRow, PhotoRegionRow } from './lib/database.types'

const functionsBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export type DriveItem = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  isImage: boolean
}

export type DriveListResult = {
  folderId: string
  name: string
  parents: string[]
  items: DriveItem[]
}

export type AuthorInfo = {
  userId: string
  displayName: string
}

export type PhotoRegion = PhotoRegionRow & { author: AuthorInfo }
export type PhotoComment = PhotoCommentRow & { author: AuthorInfo }

async function authHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: anonKey,
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string }
    if (json.error) return json.error
  } catch {
    /* ignore */
  }
  return res.statusText || `Request failed (${res.status})`
}

export async function listDriveFolder(folderId?: string): Promise<DriveListResult> {
  const headers = await authHeaders()
  const url = new URL(`${functionsBase}/drive-list`)
  if (folderId) url.searchParams.set('folderId', folderId)
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as DriveListResult
}

/** Fetch image bytes with auth and return a blob: URL. Caller should revoke when done. */
export async function fetchDriveImageUrl(
  fileId: string,
  size: 'full' | 'thumb' = 'full',
): Promise<string> {
  const headers = await authHeaders()
  const url = new URL(`${functionsBase}/drive-file`)
  url.searchParams.set('id', fileId)
  if (size === 'thumb') url.searchParams.set('size', 'thumb')
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(await readError(res))
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

async function authorMapForUserIds(userIds: string[]): Promise<Map<string, AuthorInfo>> {
  const unique = [...new Set(userIds)]
  const map = new Map<string, AuthorInfo>()
  if (unique.length === 0) return map

  const { data: people, error } = await supabase
    .from('people')
    .select('user_id, first_name, last_name')
    .in('user_id', unique)

  if (error) throw error

  for (const p of people ?? []) {
    if (!p.user_id) continue
    const name = `${p.first_name} ${p.last_name}`.trim() || 'Family member'
    map.set(p.user_id, { userId: p.user_id, displayName: name })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  for (const id of unique) {
    if (map.has(id)) continue
    if (user?.id === id && user.email) {
      map.set(id, { userId: id, displayName: user.email })
    } else {
      map.set(id, { userId: id, displayName: 'Family member' })
    }
  }
  return map
}

function withAuthors<T extends { user_id: string }>(
  rows: T[],
  authors: Map<string, AuthorInfo>,
): Array<T & { author: AuthorInfo }> {
  return rows.map((row) => ({
    ...row,
    author: authors.get(row.user_id) ?? { userId: row.user_id, displayName: 'Family member' },
  }))
}

export async function listRegions(driveFileId: string): Promise<PhotoRegion[]> {
  const { data, error } = await supabase
    .from('photo_regions')
    .select('*')
    .eq('drive_file_id', driveFileId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as PhotoRegionRow[]
  const authors = await authorMapForUserIds(rows.map((r) => r.user_id))
  return withAuthors(rows, authors)
}

export async function createRegion(input: {
  drive_file_id: string
  x: number
  y: number
  w: number
  h: number
  label?: string | null
}): Promise<PhotoRegion> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('photo_regions')
    .insert({
      drive_file_id: input.drive_file_id,
      user_id: user.id,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      label: input.label ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  const row = data as PhotoRegionRow
  const authors = await authorMapForUserIds([row.user_id])
  return withAuthors([row], authors)[0]
}

export async function updateRegionLabel(id: string, label: string | null): Promise<PhotoRegion> {
  const { data, error } = await supabase
    .from('photo_regions')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  const row = data as PhotoRegionRow
  const authors = await authorMapForUserIds([row.user_id])
  return withAuthors([row], authors)[0]
}

export async function deleteRegion(id: string): Promise<void> {
  const { error } = await supabase.from('photo_regions').delete().eq('id', id)
  if (error) throw error
}

export async function listComments(driveFileId: string): Promise<PhotoComment[]> {
  const { data, error } = await supabase
    .from('photo_comments')
    .select('*')
    .eq('drive_file_id', driveFileId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as PhotoCommentRow[]
  const authors = await authorMapForUserIds(rows.map((r) => r.user_id))
  return withAuthors(rows, authors)
}

export async function createComment(input: {
  drive_file_id: string
  body: string
  region_id?: string | null
}): Promise<PhotoComment> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('photo_comments')
    .insert({
      drive_file_id: input.drive_file_id,
      user_id: user.id,
      body: input.body.trim(),
      region_id: input.region_id ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  const row = data as PhotoCommentRow
  const authors = await authorMapForUserIds([row.user_id])
  return withAuthors([row], authors)[0]
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('photo_comments').delete().eq('id', id)
  if (error) throw error
}
