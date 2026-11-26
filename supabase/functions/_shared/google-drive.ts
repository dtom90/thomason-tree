export type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const IMAGE_MIME_PREFIX = 'image/'
export const PERSON_PHOTOS_FOLDER_NAME = 'Thomason Family Tree Photos'

let cachedToken: { key: string; accessToken: string; expiresAt: number } | null = null

export function getRootFolderId(): string {
  const id = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')
  if (!id) throw new Error('Missing GOOGLE_DRIVE_ROOT_FOLDER_ID')
  return id
}

/** Optional override for who to impersonate (domain-wide delegation). */
export function getImpersonateUser(): string | null {
  const email = Deno.env.get('GOOGLE_DRIVE_IMPERSONATE_USER')?.trim()
  return email || null
}

export function getServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON')
  const parsed = JSON.parse(raw) as ServiceAccount
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON')
  }
  return parsed
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data)
  } else if (data instanceof Uint8Array) {
    bytes = data
  } else {
    bytes = new Uint8Array(data)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Exchange a service-account JWT for an access token.
 * When `subject` is set, impersonates that Workspace user (domain-wide delegation required).
 */
export async function getAccessToken(
  sa: ServiceAccount,
  subject?: string | null,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = subject?.toLowerCase() || '__sa__'
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken
  }

  const header = { alg: 'RS256', typ: 'JWT' }
  const claim: Record<string, string | number> = {
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  if (subject) claim.sub = subject

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned),
  )
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`

  const tokenRes = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${text}`)
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    key: cacheKey,
    accessToken: tokenJson.access_token,
    expiresAt: now + (tokenJson.expires_in ?? 3600),
  }
  return cachedToken.accessToken
}

export async function driveFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://www.googleapis.com/drive/v3${path}`
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(url, { ...init, headers })
}

type DriveFileMeta = {
  id: string
  name?: string
  mimeType?: string
  parents?: string[]
  driveId?: string
  owners?: Array<{ emailAddress?: string; displayName?: string }>
}

export async function getFileMeta(
  accessToken: string,
  fileId: string,
  fields = 'id,name,mimeType,parents',
): Promise<DriveFileMeta> {
  const res = await driveFetch(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Drive get failed: ${res.status} ${text}`)
  }
  return (await res.json()) as DriveFileMeta
}

/** Owner email of a My Drive folder (null on Shared Drives / if unavailable). */
export async function getFolderOwnerEmail(
  accessToken: string,
  folderId: string,
): Promise<string | null> {
  const meta = await getFileMeta(
    accessToken,
    folderId,
    'id,driveId,owners(emailAddress)',
  )
  if (meta.driveId) return null
  const email = meta.owners?.[0]?.emailAddress?.trim()
  return email || null
}

/**
 * Token for creating files under the Drive root.
 * Shared Drive → SA token. My Drive → impersonate folder owner (or GOOGLE_DRIVE_IMPERSONATE_USER).
 */
export async function getWriteAccessToken(
  sa: ServiceAccount,
  rootId: string,
): Promise<{ accessToken: string; asUser: string | null }> {
  const saToken = await getAccessToken(sa, null)
  const root = await getFileMeta(saToken, rootId, 'id,driveId,owners(emailAddress)')

  if (root.driveId) {
    return { accessToken: saToken, asUser: null }
  }

  const subject =
    getImpersonateUser() || root.owners?.[0]?.emailAddress?.trim() || null
  if (!subject) {
    throw new Error(
      'Cannot upload: My Drive folder has no owner email, and GOOGLE_DRIVE_IMPERSONATE_USER is not set. Use a Shared Drive, or set impersonation.',
    )
  }

  try {
    const userToken = await getAccessToken(sa, subject)
    return { accessToken: userToken, asUser: subject }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot impersonate folder owner (${subject}). Enable domain-wide delegation for the service account with scope ${DRIVE_SCOPE}, or move the root to a Shared Drive. (${detail})`,
    )
  }
}

/** True if fileId is the root folder or a descendant of it (any parent path). */
export async function assertUnderRoot(
  accessToken: string,
  fileId: string,
  rootId: string,
): Promise<DriveFileMeta> {
  if (fileId === rootId) {
    return getFileMeta(accessToken, fileId)
  }

  const meta = await getFileMeta(accessToken, fileId)
  if ((meta.parents ?? []).includes(rootId)) return meta

  // Walk every parent chain. Drive files can have multiple parents (e.g. organized
  // into the family folder while still living under another folder); following only
  // parents[0] falsely rejects those.
  const visited = new Set<string>([fileId])
  const queue = [...(meta.parents ?? [])]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (currentId === rootId) return meta
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const node = await getFileMeta(accessToken, currentId)
    for (const parentId of node.parents ?? []) {
      if (parentId === rootId) return meta
      if (!visited.has(parentId)) queue.push(parentId)
    }
  }

  throw new ContainmentError(`File ${fileId} is outside the configured Drive root`)
}

export class ContainmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContainmentError'
  }
}

export function isImageMime(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith(IMAGE_MIME_PREFIX)
}

export function isFolderMime(mimeType: string | undefined): boolean {
  return mimeType === FOLDER_MIME
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Find or create the dedicated person-photos folder under the Drive root. */
export async function findOrCreatePersonPhotosFolder(
  accessToken: string,
  rootId: string,
): Promise<string> {
  const name = PERSON_PHOTOS_FOLDER_NAME
  const q = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `'${rootId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ')

  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    fields: 'files(id, name)',
    pageSize: '1',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const listRes = await driveFetch(accessToken, `/files?${params}`)
  if (!listRes.ok) {
    const text = await listRes.text()
    throw new Error(`Drive folder lookup failed: ${listRes.status} ${text}`)
  }
  const listJson = (await listRes.json()) as { files?: Array<{ id: string }> }
  const existing = listJson.files?.[0]
  if (existing?.id) return existing.id

  const createRes = await driveFetch(accessToken, '/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [rootId],
    }),
  })
  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(`Drive folder create failed: ${createRes.status} ${text}`)
  }
  const created = (await createRes.json()) as { id: string }
  return created.id
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-google-access-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status)
}
