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
  isImageMime,
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

    const url = new URL(req.url)
    const fileId = url.searchParams.get('id')
    if (!fileId) return errorResponse('Missing id', 400)
    const wantThumb = url.searchParams.get('size') === 'thumb'

    const rootId = getRootFolderId()
    const sa = getServiceAccount()
    const accessToken = await getAccessToken(sa)
    const meta = await assertUnderRoot(accessToken, fileId, rootId)

    if (!isImageMime(meta.mimeType)) {
      return errorResponse('Not an image', 400)
    }

    // Prefer API media (reliable with service accounts). Optional thumbnailLink
    // for grid previews — never use drive.google.com/thumbnail (often HTML 200).
    let mediaRes: Response | null = null

    if (wantThumb) {
      const thumbMeta = await driveFetch(
        accessToken,
        `/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`,
      )
      if (thumbMeta.ok) {
        const { thumbnailLink } = (await thumbMeta.json()) as { thumbnailLink?: string }
        if (thumbnailLink) {
          const sized = thumbnailLink.includes('=s')
            ? thumbnailLink.replace(/=s\d+/, '=s400')
            : `${thumbnailLink}=s400`
          const thumbRes = await fetch(sized, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const thumbType = thumbRes.headers.get('Content-Type') || ''
          if (thumbRes.ok && thumbType.startsWith('image/')) {
            mediaRes = thumbRes
          }
        }
      }
    }

    if (!mediaRes) {
      mediaRes = await driveFetch(
        accessToken,
        `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      )
    }

    if (!mediaRes.ok) {
      const text = await mediaRes.text()
      return errorResponse(`Drive media failed: ${mediaRes.status} ${text}`, 502)
    }

    const contentType = mediaRes.headers.get('Content-Type') || meta.mimeType || 'application/octet-stream'
    if (!contentType.startsWith('image/')) {
      return errorResponse(`Unexpected content type: ${contentType}`, 502)
    }

    const body = mediaRes.body
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    if (err instanceof ContainmentError) {
      return errorResponse(err.message, 403)
    }
    console.error(err)
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500)
  }
})
