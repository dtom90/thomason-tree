<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import XIcon from '@lucide/svelte/icons/x'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import ImageIcon from '@lucide/svelte/icons/image'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import { Button } from '$lib/components/ui/button/index.js'
  import {
    fetchDriveImageUrl,
    listDriveFolder,
    type DriveItem,
    type DriveListResult,
  } from './drive-api'
  import PhotoViewer from './PhotoViewer.svelte'

  type Props = {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  type Crumb = { id: string; name: string }

  let loading = $state(true)
  let error = $state<string | null>(null)
  let listing = $state<DriveListResult | null>(null)
  let crumbs = $state<Crumb[]>([])
  let thumbUrls = $state<Record<string, string>>({})
  let viewer = $state<{ id: string; name: string } | null>(null)

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
    void loadFolder()
  })

  onDestroy(() => {
    for (const url of Object.values(thumbUrls)) URL.revokeObjectURL(url)
  })
</script>

<div class="fixed inset-0 z-40 flex flex-col bg-background">
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
    <h2 class="text-base font-semibold">Photos</h2>
    <div class="min-w-0 flex-1 overflow-x-auto">
      <nav class="flex items-center gap-1 text-sm text-muted-foreground">
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
    <Button variant="ghost" size="sm" type="button" onclick={onClose}>
      <XIcon />
      Close
    </Button>
  </header>

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
                onclick={() => (viewer = { id: item.id, name: item.name })}
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
    onClose={() => (viewer = null)}
  />
{/if}
