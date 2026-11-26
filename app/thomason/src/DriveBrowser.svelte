<script lang="ts">
  import { onMount } from 'svelte'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import {
    listDriveFolder,
    listDriveGallery,
    type DriveItem,
    type DriveListResult,
  } from './drive-api'
  import {
    getPhotoIdFromUrl,
    getPhotosBrowseModeFromUrl,
    setPhotoIdInUrl,
    setPhotosBrowseModeInUrl,
    type PhotosBrowseMode,
  } from './photos-url'
  import LazyDriveThumb from './LazyDriveThumb.svelte'
  import PhotoViewer from './PhotoViewer.svelte'

  type Crumb = { id: string; name: string }

  let mode = $state<PhotosBrowseMode>(getPhotosBrowseModeFromUrl())
  let loading = $state(true)
  let error = $state<string | null>(null)
  let listing = $state<DriveListResult | null>(null)
  let crumbs = $state<Crumb[]>([])
  let scrollEl = $state<HTMLDivElement | undefined>()
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
      syncViewerFromUrl()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load folder'
      listing = null
    } finally {
      loading = false
    }
  }

  async function loadGallery() {
    loading = true
    error = null
    try {
      const result = await listDriveGallery()
      listing = result
      crumbs = [{ id: result.folderId, name: result.name || 'All photos' }]
      syncViewerFromUrl()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load gallery'
      listing = null
    } finally {
      loading = false
    }
  }

  async function loadCurrent() {
    if (mode === 'gallery') await loadGallery()
    else await loadFolder()
  }

  function setMode(next: PhotosBrowseMode) {
    if (next === mode) return
    mode = next
    setPhotosBrowseModeInUrl(next, 'push')
    crumbs = []
    void loadCurrent()
  }

  function syncBrowseModeFromUrl() {
    const next = getPhotosBrowseModeFromUrl()
    if (next === mode) {
      syncViewerFromUrl()
      return
    }
    mode = next
    crumbs = []
    void loadCurrent()
  }

  function openFolder(item: DriveItem) {
    void loadFolder(item.id, [...crumbs, { id: item.id, name: item.name }])
  }

  function goCrumb(index: number) {
    if (mode === 'gallery') return
    const crumb = crumbs[index]
    void loadFolder(crumb.id, crumbs.slice(0, index + 1))
  }

  onMount(() => {
    setPhotosBrowseModeInUrl(mode, 'replace')
    syncViewerFromUrl()
    void loadCurrent()
    const onPopState = () => syncBrowseModeFromUrl()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })
</script>

<div class="flex h-full flex-col bg-background">
  <div class="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
    <div
      class="inline-flex shrink-0 rounded-lg border border-border p-0.5"
      role="group"
      aria-label="Photos layout"
    >
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md transition-colors {mode ===
        'folder'
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        aria-pressed={mode === 'folder'}
        title="Folder view"
        onclick={() => setMode('folder')}
      >
        <FolderIcon class="size-3.5" />
        <span class="sr-only">Folder view</span>
      </button>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md transition-colors {mode ===
        'gallery'
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        aria-pressed={mode === 'gallery'}
        title="Gallery view"
        onclick={() => setMode('gallery')}
      >
        <LayoutGridIcon class="size-3.5" />
        <span class="sr-only">Gallery view</span>
      </button>
    </div>

    <div class="min-w-0 flex-1 overflow-x-auto">
      {#if mode === 'folder'}
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
      {:else}
        <p class="truncate text-sm font-medium text-foreground">All photos</p>
      {/if}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-4" bind:this={scrollEl}>
    {#if loading}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else if error}
      <p class="text-sm text-destructive">{error}</p>
    {:else if listing && listing.items.length === 0}
      <p class="text-sm text-muted-foreground">
        {mode === 'gallery' ? 'No photos yet.' : 'This folder is empty.'}
      </p>
    {:else if listing}
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each listing.items as item (item.id)}
          <li>
            {#if item.isFolder && mode === 'folder'}
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
                <LazyDriveThumb fileId={item.id} root={scrollEl ?? null} />
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
