import { supabase } from './lib/supabase'
import type { PhotoCommentRow, PhotoRegionRow } from './lib/database.types'
import { getGoogleProviderToken } from './google-auth'
import { canAccessDriveFolder, pickFamilyRootFolder, probeDriveFolderAccess } from './google-picker'

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
  mode?: 'folder' | 'gallery'
}

export type AuthorInfo = {
  userId: string
  displayName: string
}

export type PersonRef = {
  id: string
  displayName: string
}

export type PhotoRegion = PhotoRegionRow & {
  author: AuthorInfo
  person: PersonRef | null
}
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

/** All images under the family Drive root, as a flat list. */
export async function listDriveGallery(): Promise<DriveListResult> {
  const headers = await authHeaders()
  const url = new URL(`${functionsBase}/drive-list`)
  url.searchParams.set('mode', 'gallery')
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as DriveListResult
}

/** Fetch image bytes with auth. Caller owns the blob. */
export async function fetchDriveImageBlob(
  fileId: string,
  size: 'full' | 'thumb' = 'full',
): Promise<Blob> {
  const headers = await authHeaders()
  const url = new URL(`${functionsBase}/drive-file`)
  url.searchParams.set('id', fileId)
  if (size === 'thumb') url.searchParams.set('size', 'thumb')
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(await readError(res))
  return res.blob()
}

/** Fetch image bytes with auth and return a blob: URL. Caller should revoke when done. */
export async function fetchDriveImageUrl(
  fileId: string,
  size: 'full' | 'thumb' = 'full',
): Promise<string> {
  const blob = await fetchDriveImageBlob(fileId, size)
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

async function personMapForIds(personIds: Array<string | null | undefined>): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(personIds.filter((id): id is string => !!id))]
  const map = new Map<string, PersonRef>()
  if (unique.length === 0) return map

  const { data: people, error } = await supabase
    .from('people')
    .select('id, first_name, last_name')
    .in('id', unique)
  if (error) throw error

  for (const p of people ?? []) {
    const name = `${p.first_name} ${p.last_name}`.trim() || 'Family member'
    map.set(p.id, { id: p.id, displayName: name })
  }
  return map
}

async function withPeople(rows: PhotoRegionRow[], authors: Map<string, AuthorInfo>): Promise<PhotoRegion[]> {
  const people = await personMapForIds(rows.map((r) => r.person_id))
  return rows.map((row) => ({
    ...row,
    author: authors.get(row.user_id) ?? { userId: row.user_id, displayName: 'Family member' },
    person: row.person_id
      ? (people.get(row.person_id) ?? { id: row.person_id, displayName: 'Family member' })
      : null,
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
  return withPeople(rows, authors)
}

/**
 * Ensure drive.file can use the shared family root (one-time Google Picker confirm).
 * Returns a fresh Google access token to use for upload.
 */
export async function ensureFamilyFolderAccess(): Promise<string> {
  const token = await getGoogleProviderToken()
  const root = await listDriveFolder()
  if (await canAccessDriveFolder(token, root.folderId)) return token

  await pickFamilyRootFolder(token, {
    rootId: root.folderId,
    rootName: root.name || 'family photos',
    parentId: root.parents[0] ?? null,
  })

  // Picker grant can lag briefly; retry a few times before failing.
  let last = await probeDriveFolderAccess(token, root.folderId)
  for (let i = 0; i < 4 && !last.ok; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    last = await probeDriveFolderAccess(token, root.folderId)
  }
  if (!last.ok) {
    throw new Error(
      `Could not access the family folder after selection (${last.status}). ` +
        `Confirm VITE_GOOGLE_APP_ID is your Google Cloud project number, reconnect Google Drive, ` +
        `and select the shared folder again. ${last.detail}`,
    )
  }
  return token
}

export async function uploadPersonPhoto(file: File): Promise<{
  id: string
  name: string
  mimeType: string
}> {
  if (!file.type.startsWith('image/')) throw new Error('File must be an image')
  const googleToken = await ensureFamilyFolderAccess()
  const headers = {
    ...(await authHeaders()),
    'X-Google-Access-Token': googleToken,
  }
  const body = new FormData()
  body.append('file', file, file.name)
  const res = await fetch(`${functionsBase}/drive-upload`, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { id: string; name: string; mimeType: string }
}

export async function listRegionsForPerson(personId: string): Promise<PhotoRegion[]> {
  const { data, error } = await supabase
    .from('photo_regions')
    .select('*')
    .eq('person_id', personId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as PhotoRegionRow[]
  const authors = await authorMapForUserIds(rows.map((r) => r.user_id))
  return withPeople(rows, authors)
}

export async function createRegion(input: {
  drive_file_id: string
  x: number
  y: number
  w: number
  h: number
  label?: string | null
  person_id?: string | null
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
      person_id: input.person_id ?? null,
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
  return (await withPeople([row], authors))[0]
}

export async function createRegionsForPersonUpload(input: {
  drive_file_id: string
  person_id: string
  label?: string | null
  boxes: Array<{ x: number; y: number; w: number; h: number }>
}): Promise<PhotoRegion[]> {
  const boxes =
    input.boxes.length > 0 ? input.boxes : [{ x: 0, y: 0, w: 1, h: 1 }]
  const created: PhotoRegion[] = []
  for (const box of boxes) {
    created.push(
      await createRegion({
        drive_file_id: input.drive_file_id,
        person_id: input.person_id,
        label: input.label ?? null,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      }),
    )
  }
  return created
}

/** People the current user may attach to a photo region (RLS: editors = all, viewers = linked only). */
export async function listRegionPersonOptions(): Promise<{
  options: PersonRef[]
  canEditTree: boolean
  linkedPersonId: string | null
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const [peopleRes, linkedRes, canEditRes] = await Promise.all([
    supabase.from('people').select('id, first_name, last_name'),
    supabase.from('people').select('id').eq('user_id', user.id).maybeSingle(),
    supabase.rpc('can_edit_tree'),
  ])
  if (peopleRes.error) throw peopleRes.error
  if (linkedRes.error) throw linkedRes.error
  if (canEditRes.error) throw canEditRes.error

  const canEditTree = canEditRes.data === true
  const linkedPersonId = linkedRes.data?.id ?? null

  let options: PersonRef[] = (peopleRes.data ?? []).map((p) => ({
    id: p.id,
    displayName: `${p.first_name} ${p.last_name}`.trim() || 'Family member',
  }))
  options.sort((a, b) => a.displayName.localeCompare(b.displayName))

  if (!canEditTree) {
    options = linkedPersonId ? options.filter((p) => p.id === linkedPersonId) : []
  }

  return { options, canEditTree, linkedPersonId }
}

export async function updateRegion(
  id: string,
  patch: { label?: string | null; person_id?: string | null },
): Promise<PhotoRegion> {
  const { data, error } = await supabase
    .from('photo_regions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  const row = data as PhotoRegionRow
  const authors = await authorMapForUserIds([row.user_id])
  return (await withPeople([row], authors))[0]
}

export async function updateRegionLabel(id: string, label: string | null): Promise<PhotoRegion> {
  return updateRegion(id, { label })
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
