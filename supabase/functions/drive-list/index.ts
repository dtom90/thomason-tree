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

type ListedItem = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  isImage: boolean
}

type GalleryPayload = {
  folderId: string
  name: string
  parents: string[]
  items: ListedItem[]
  mode: 'gallery'
}

const GALLERY_TTL_MS = 3 * 60 * 1000

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) throw new Error('Missing Supabase service role env')
  return createClient(url, key)
}

async function readGalleryCache(rootId: string): Promise<GalleryPayload | null> {
  const { data, error } = await adminClient()
    .from('drive_gallery_cache')
    .select('payload, refreshed_at')
    .eq('root_id', rootId)
    .maybeSingle()
  if (error) {
    console.error('gallery cache read failed', error)
    return null
  }
  if (!data?.payload || !data.refreshed_at) return null
  const age = Date.now() - new Date(data.refreshed_at).getTime()
  if (Number.isNaN(age) || age >= GALLERY_TTL_MS) return null
  return data.payload as GalleryPayload
}

async function writeGalleryCache(rootId: string, payload: GalleryPayload): Promise<void> {
  const { error } = await adminClient().from('drive_gallery_cache').upsert(
    {
      root_id: rootId,
      payload,
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: 'root_id' },
  )
  if (error) console.error('gallery cache write failed', error)
}

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
    const mode = url.searchParams.get('mode') === 'gallery' ? 'gallery' : 'folder'
    const refresh = url.searchParams.get('refresh') === '1'
    const folderId = mode === 'gallery' ? rootId : (url.searchParams.get('folderId') || rootId)

    if (mode === 'gallery' && !refresh) {
      const cached = await readGalleryCache(rootId)
      if (cached) {
        return jsonResponse({ ...cached, cached: true })
      }
    }

    const sa = getServiceAccount()
    const accessToken = await getAccessToken(sa)
    const folder = await assertUnderRoot(accessToken, folderId, rootId)

    async function listChildren(parentId: string): Promise<ListedItem[]> {
      const children: ListedItem[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({
          q: `'${parentId}' in parents and trashed = false`,
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
          throw new Error(`Drive list failed: ${listRes.status} ${text}`)
        }
        const listJson = (await listRes.json()) as {
          files?: Array<{ id: string; name: string; mimeType: string }>
          nextPageToken?: string
        }
        for (const f of listJson.files ?? []) {
          children.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            isFolder: isFolderMime(f.mimeType),
            isImage: isImageMime(f.mimeType),
          })
        }
        pageToken = listJson.nextPageToken
      } while (pageToken)
      return children
    }

    let items: ListedItem[]

    if (mode === 'gallery') {
      // Flat list of every image under the family root (BFS through folders).
      const images: ListedItem[] = []
      const queue = [rootId]
      const seen = new Set<string>([rootId])
      while (queue.length > 0) {
        const batch = queue.splice(0, 8)
        const results = await Promise.all(batch.map((id) => listChildren(id)))
        for (const children of results) {
          for (const child of children) {
            if (child.isImage) {
              images.push(child)
            } else if (child.isFolder && !seen.has(child.id)) {
              seen.add(child.id)
              queue.push(child.id)
            }
          }
        }
      }
      images.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      items = images

      const payload: GalleryPayload = {
        folderId: rootId,
        name: 'All photos',
        parents: folder.parents ?? [],
        items,
        mode: 'gallery',
      }
      await writeGalleryCache(rootId, payload)
      return jsonResponse({ ...payload, cached: false })
    }

    items = await listChildren(folderId)
    items.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

    return jsonResponse({
      folderId,
      name: folder.name ?? '',
      parents: folder.parents ?? [],
      items,
      mode,
    })
  } catch (err) {
    if (err instanceof ContainmentError) {
      return errorResponse(err.message, 403)
    }
    console.error(err)
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500)
  }
})
