import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  assertUnderRoot,
  ContainmentError,
  corsHeaders,
  errorResponse,
  findOrCreatePersonPhotosFolder,
  getRootFolderId,
  isImageMime,
  jsonResponse,
} from '../_shared/google-drive.ts'

async function invalidateGalleryCache(rootId: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return
  const admin = createClient(url, key)
  const { error } = await admin.from('drive_gallery_cache').delete().eq('root_id', rootId)
  if (error) console.error('gallery cache invalidate failed', error)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing Authorization', 401)

    const googleToken = req.headers.get('X-Google-Access-Token')?.trim()
    if (!googleToken) {
      return errorResponse(
        'Missing Google Drive token. Sign out and sign in again (drive.file), then select the family folder in the picker.',
        401,
      )
    }

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

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorResponse('Missing file', 400)
    }
    if (!isImageMime(file.type)) {
      return errorResponse('File must be an image', 400)
    }
    if (file.size <= 0) {
      return errorResponse('Empty file', 400)
    }

    const rootId = getRootFolderId()
    // Upload as the signed-in Google user (free personal Drive quota).
    const accessToken = googleToken
    try {
      await assertUnderRoot(accessToken, rootId, rootId)
    } catch (err) {
      if (err instanceof ContainmentError) {
        return errorResponse(
          'Your Google account cannot access the family photos folder. Select it in the picker, and ask an owner to share it with edit access.',
          403,
        )
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('401') || message.includes('403') || message.includes('404')) {
        return errorResponse(
          'Google Drive permission missing for the family folder. Reconnect Drive and select the shared folder in the picker.',
          401,
        )
      }
      throw err
    }

    const folderId = await findOrCreatePersonPhotosFolder(accessToken, rootId)

    const safeName = (file.name || 'photo').replace(/[/\\]/g, '_').slice(0, 200)
    const mimeType = file.type || 'application/octet-stream'
    const bytes = new Uint8Array(await file.arrayBuffer())

    const metadata = {
      name: safeName,
      parents: [folderId],
      mimeType,
    }
    const boundary = 'thomason_upload_boundary'
    const metaPart =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n`
    const fileHeader = `--${boundary}\r\n` + `Content-Type: ${mimeType}\r\n\r\n`
    const closing = `\r\n--${boundary}--`
    const metaBytes = new TextEncoder().encode(metaPart)
    const headerBytes = new TextEncoder().encode(fileHeader)
    const closeBytes = new TextEncoder().encode(closing)
    const body = new Uint8Array(
      metaBytes.length + headerBytes.length + bytes.length + closeBytes.length,
    )
    body.set(metaBytes, 0)
    body.set(headerBytes, metaBytes.length)
    body.set(bytes, metaBytes.length + headerBytes.length)
    body.set(closeBytes, metaBytes.length + headerBytes.length + bytes.length)

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    )
    if (!uploadRes.ok) {
      const text = await uploadRes.text()
      if (uploadRes.status === 401 || uploadRes.status === 403) {
        return errorResponse(
          `Drive upload denied (${uploadRes.status}). Re-sign in with Google Drive access, and ensure the photos folder is shared with you as an editor. ${text}`,
          uploadRes.status,
        )
      }
      return errorResponse(`Drive upload failed: ${uploadRes.status} ${text}`, 502)
    }

    const uploaded = (await uploadRes.json()) as {
      id: string
      name: string
      mimeType: string
    }
    await invalidateGalleryCache(rootId)
    return jsonResponse({
      id: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
    })
  } catch (err) {
    console.error(err)
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500)
  }
})
