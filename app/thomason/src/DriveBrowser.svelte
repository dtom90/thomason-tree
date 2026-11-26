<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import ImageIcon from '@lucide/svelte/icons/image'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import {
    fetchDriveImageUrl,
    listDriveFolder,
    type DriveItem,
    type DriveListResult,
  } from './drive-api'
  import { getPhotoIdFromUrl, setPhotoIdInUrl } from './photos-url'
  import PhotoViewer from './PhotoViewer.svelte'

  type Crumb = { id: string; name: string }

  let loading = $state(true)
  let error = $state<string | null>(null)
  let listing = $state<DriveListResult | null>(null)
  let crumbs = $state<Crumb[]>([])
  let thumbUrls = $state<Record<string, string>>({})
  let viewer = $state<{ id: string; name: string } | null>(null)

  function nameForPhoto(photoId: string): string {
    return listing?.items.find((i) => i.id === photoId)?.name ?? 'Photo'
  }

  function syncViewerFromUrl() {
    const photoId = getPhotoIdFromUrl()
    if (!photoId) {
      viewer = null
      return
    }
    if (viewer?.id === photoId) {
      if (viewer.name === 'Photo') viewer = { id: photoId, name: nameForPhoto(photoId) }
      return
    }
    viewer = { id: photoId, name: nameForPhoto(photoId) }
  }

  function openPhoto(item: DriveItem) {
    viewer = { id: item.id, name: item.name }
    setPhotoIdInUrl(item.id, 'push')
  }

  function closeViewer() {
    viewer = null
    setPhotoIdInUrl(null, 'replace')
  }

  async function loadFolder(folderId?: string, nextCrumbs?: Crumb[]) {
    loading = true
    error = null
    try {
      const result = await listDriveFolder(folderId)
      listing = result
      if (nextCrumbs) {
        crumbs = nextCrumbs
      } else if (crumbs.length === 0) {
        crumbs = [{ id: result.folderId, name: result.name || 'Photos' }]
      }
      await loadThumbs(result.items.filter((i) => i.isImage))
      syncViewerFromUrl()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load folder'
      listing = null
    } finally {
      loading = false
    }
  }

  async function loadThumbs(images: DriveItem[]) {
    const keep = new Set(images.map((i) => i.id))
    const next: Record<string, string> = {}
    for (const [id, url] of Object.entries(thumbUrls)) {
      if (keep.has(id)) next[id] = url
      else URL.revokeObjectURL(url)
    }
    await Promise.all(
      images.slice(0, 40).map(async (img) => {
        if (next[img.id]) return
        try {
          next[img.id] = await fetchDriveImageUrl(img.id, 'thumb')
        } catch {
          try {
            next[img.id] = await fetchDriveImageUrl(img.id, 'full')
          } catch {
            /* leave placeholder icon */
          }
        }
      }),
    )
    thumbUrls = next
  }

  function openFolder(item: DriveItem) {
    void loadFolder(item.id, [...crumbs, { id: item.id, name: item.name }])
  }

  function goCrumb(index: number) {
    const crumb = crumbs[index]
    void loadFolder(crumb.id, crumbs.slice(0, index + 1))
  }

  onMount(() => {
    syncViewerFromUrl()
    void loadFolder()
    const onPopState = () => syncViewerFromUrl()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  onDestroy(() => {
    for (const url of Object.values(thumbUrls)) URL.revokeObjectURL(url)
  })
</script>

<div class="flex h-full flex-col bg-background">
  <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
    <div class="min-w-0 flex-1 overflow-x-auto">
      <nav class="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Folder path">
        {#each crumbs as crumb, i (crumb.id)}
          {#if i > 0}
            <ChevronRightIcon class="size-3.5 shrink-0 opacity-60" />
          {/if}
          <button
            type="button"
            class="max-w-[10rem] truncate rounded px-1 hover:text-foreground {i === crumbs.length - 1
              ? 'font-medium text-foreground'
              : ''}"
            onclick={() => goCrumb(i)}
          >
            {crumb.name}
          </button>
        {/each}
      </nav>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    {#if loading}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else if error}
      <p class="text-sm text-destructive">{error}</p>
    {:else if listing && listing.items.length === 0}
      <p class="text-sm text-muted-foreground">This folder is empty.</p>
    {:else if listing}
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each listing.items as item (item.id)}
          <li>
            {#if item.isFolder}
              <button
                type="button"
                class="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-foreground/30"
                onclick={() => openFolder(item)}
              >
                <div class="flex aspect-square items-center justify-center bg-muted/50">
                  <FolderIcon class="size-10 text-muted-foreground" />
                </div>
                <span class="truncate px-2 py-2 text-sm">{item.name}</span>
              </button>
            {:else if item.isImage}
              <button
                type="button"
                class="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-foreground/30"
                onclick={() => openPhoto(item)}
              >
                <div class="aspect-square bg-muted/50">
                  {#if thumbUrls[item.id]}
                    <img
                      src={thumbUrls[item.id]}
                      alt=""
                      class="size-full object-cover"
                    />
                  {:else}
                    <div class="flex size-full items-center justify-center">
                      <ImageIcon class="size-10 text-muted-foreground" />
                    </div>
                  {/if}
                </div>
                <span class="truncate px-2 py-2 text-sm">{item.name}</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if viewer}
  <PhotoViewer
    fileId={viewer.id}
    fileName={viewer.name}
    onClose={closeViewer}
  />
{/if}
