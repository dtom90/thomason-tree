import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  assertUnderRoot,
  ContainmentError,
  corsHeaders,
  errorResponse,
  getAccessToken,
  getRootFolderId,
  getServiceAccount,
  isFolderMime,
  isImageMime,
  jsonResponse,
  driveFetch,
} from '../_shared/google-drive.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing Authorization', 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) return errorResponse('Unauthorized', 401)

    const rootId = getRootFolderId()
    const url = new URL(req.url)
    const folderId = url.searchParams.get('folderId') || rootId

    const sa = getServiceAccount()
    const accessToken = await getAccessToken(sa)
    const folder = await assertUnderRoot(accessToken, folderId, rootId)

    const items: Array<{
      id: string
      name: string
      mimeType: string
      isFolder: boolean
      isImage: boolean
    }> = []
    let pageToken: string | undefined

    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        spaces: 'drive',
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (pageToken) params.set('pageToken', pageToken)

      const listRes = await driveFetch(accessToken, `/files?${params}`)
      if (!listRes.ok) {
        const text = await listRes.text()
        return errorResponse(`Drive list failed: ${listRes.status} ${text}`, 502)
      }
      const listJson = (await listRes.json()) as {
        files?: Array<{ id: string; name: string; mimeType: string }>
        nextPageToken?: string
      }
      for (const f of listJson.files ?? []) {
        items.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          isFolder: isFolderMime(f.mimeType),
          isImage: isImageMime(f.mimeType),
        })
      }
      pageToken = listJson.nextPageToken
    } while (pageToken)

    items.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

    return jsonResponse({
      folderId,
      name: folder.name ?? '',
      parents: folder.parents ?? [],
      items,
    })
  } catch (err) {
    if (err instanceof ContainmentError) {
      return errorResponse(err.message, 403)
    }
    console.error(err)
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500)
  }
})
