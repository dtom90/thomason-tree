declare global {
  interface Window {
    gapi?: {
      load: (name: string, cb: () => void) => void
    }
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder
        DocsView: new (viewId?: string) => GoogleDocsView
        ViewId: { FOLDERS: string; DOCS: string }
        Action: { PICKED: string; CANCEL: string }
        Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string }
        Response: { ACTION: string; DOCUMENTS: string }
        Document: { ID: string; NAME: string; MIME_TYPE: string }
      }
    }
  }
}

type GoogleDocsView = {
  setIncludeFolders: (v: boolean) => GoogleDocsView
  setSelectFolderEnabled: (v: boolean) => GoogleDocsView
  setParent: (id: string) => GoogleDocsView
  setOwnedByMe: (v: boolean) => GoogleDocsView
  setEnableDrives: (v: boolean) => GoogleDocsView
  setMimeTypes: (types: string) => GoogleDocsView
  setQuery: (q: string) => GoogleDocsView
}

type GooglePickerBuilder = {
  addView: (view: GoogleDocsView) => GooglePickerBuilder
  enableFeature: (feature: string) => GooglePickerBuilder
  setOAuthToken: (token: string) => GooglePickerBuilder
  setDeveloperKey: (key: string) => GooglePickerBuilder
  setAppId: (id: string) => GooglePickerBuilder
  setTitle: (title: string) => GooglePickerBuilder
  setCallback: (cb: (data: Record<string, unknown>) => void) => GooglePickerBuilder
  build: () => { setVisible: (v: boolean) => void }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

function getPickerConfig(): { apiKey: string; appId: string } {
  const apiKey = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim()
  if (!apiKey) {
    throw new Error(
      'Missing VITE_GOOGLE_API_KEY. Add a Google Cloud API key (Picker enabled) to .env.local.',
    )
  }
  // Project number is required for drive.file: without it, Picker selection does not grant access.
  const appId = (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined)?.trim()
  if (!appId) {
    throw new Error(
      'Missing VITE_GOOGLE_APP_ID. Set it to your Google Cloud project number (Console → Home → Project number).',
    )
  }
  return { apiKey, appId }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.loaded = '1'
      resolve()
    }
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

async function loadGooglePicker(): Promise<NonNullable<NonNullable<typeof window.google>['picker']>> {
  await loadScript('https://apis.google.com/js/api.js')
  if (!window.gapi) throw new Error('Google API failed to load')
  await new Promise<void>((resolve) => {
    window.gapi!.load('picker', () => resolve())
  })
  const picker = window.google?.picker
  if (!picker) throw new Error('Google Picker failed to load')
  return picker
}

export type FamilyFolderTarget = {
  rootId: string
  rootName: string
  parentId: string | null
}

/**
 * Open Google Picker aimed at the shared family root folder.
 * User confirms the folder once; that grants drive.file access for uploads there.
 */
export async function pickFamilyRootFolder(
  accessToken: string,
  target: FamilyFolderTarget,
): Promise<string> {
  const { apiKey, appId } = getPickerConfig()
  const pickerApi = await loadGooglePicker()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error, id?: string) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(id!)
    }

    const views: GoogleDocsView[] = []

    // Prefer browsing the parent so the family root itself is selectable.
    if (target.parentId) {
      views.push(
        new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes(FOLDER_MIME)
          .setParent(target.parentId),
      )
    }

    // Shared-with-me / search fallback when parent isn't browsable.
    views.push(
      new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME)
        .setOwnedByMe(false)
        .setQuery(target.rootName),
    )

    views.push(
      new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME)
        .setEnableDrives(true)
        .setQuery(target.rootName),
    )

    let builder = new pickerApi.PickerBuilder()
      .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setTitle(`Select “${target.rootName}” (family photos folder)`)
      .setCallback((data) => {
        const action = data[pickerApi.Response.ACTION] as string
        if (action === pickerApi.Action.CANCEL) {
          finish(new Error('Folder selection cancelled'))
          return
        }
        if (action !== pickerApi.Action.PICKED) return
        const docs = data[pickerApi.Response.DOCUMENTS] as
          | Array<Record<string, string>>
          | undefined
        const doc = docs?.[0]
        if (!doc) {
          finish(new Error('No folder selected'))
          return
        }
        const id = doc[pickerApi.Document.ID]
        if (id !== target.rootId) {
          finish(
            new Error(
              `Please select the shared folder “${target.rootName}” (not a different folder).`,
            ),
          )
          return
        }
        finish(undefined, id)
      })

    for (const view of views) builder = builder.addView(view)
    builder = builder.setAppId(appId)

    builder.build().setVisible(true)
  })
}

export type DriveFolderAccess = {
  ok: boolean
  status: number
  detail: string
}

/** Check whether the user token can see the family root (drive.file granted). */
export async function probeDriveFolderAccess(
  accessToken: string,
  folderId: string,
): Promise<DriveFolderAccess> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (res.ok) return { ok: true, status: res.status, detail: 'ok' }
  let detail = res.statusText
  try {
    detail = await res.text()
  } catch {
    /* ignore */
  }
  return { ok: false, status: res.status, detail: detail.slice(0, 300) }
}

export async function canAccessDriveFolder(
  accessToken: string,
  folderId: string,
): Promise<boolean> {
  return (await probeDriveFolderAccess(accessToken, folderId)).ok
}
