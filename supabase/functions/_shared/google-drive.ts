export type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const IMAGE_MIME_PREFIX = 'image/'

let cachedToken: { accessToken: string; expiresAt: number } | null = null

export function getRootFolderId(): string {
  const id = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')
  if (!id) throw new Error('Missing GOOGLE_DRIVE_ROOT_FOLDER_ID')
  return id
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

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken
  }

  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
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

/** True if fileId is the root folder or a descendant of it. */
export async function assertUnderRoot(
  accessToken: string,
  fileId: string,
  rootId: string,
): Promise<DriveFileMeta> {
  const visited = new Set<string>()
  let currentId = fileId
  let meta: DriveFileMeta | null = null

  while (currentId) {
    if (currentId === rootId) {
      if (!meta) meta = await getFileMeta(accessToken, fileId)
      return meta
    }
    if (visited.has(currentId)) break
    visited.add(currentId)

    const node = await getFileMeta(accessToken, currentId)
    if (!meta) meta = node
    const parents = node.parents ?? []
    if (parents.length === 0) break
    if (parents.includes(rootId)) return meta
    currentId = parents[0]
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

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
