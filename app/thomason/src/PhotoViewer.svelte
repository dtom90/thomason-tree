<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import XIcon from '@lucide/svelte/icons/x'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'
  import NetworkIcon from '@lucide/svelte/icons/network'
  import { Button } from '$lib/components/ui/button/index.js'
  import { supabase } from '$lib/supabase'
  import {
    createComment,
    createRegion,
    deleteComment,
    deleteRegion,
    fetchDriveImageUrl,
    listComments,
    listRegionPersonOptions,
    listRegions,
    updateRegion,
    type PersonRef,
    type PhotoComment,
    type PhotoRegion,
  } from './drive-api'
  import PersonSearchInput from './PersonSearchInput.svelte'

  type Props = {
    fileId: string
    fileName: string
    onClose: () => void
  }

  let { fileId, fileName, onClose }: Props = $props()

  let imageUrl = $state<string | null>(null)
  let loadError = $state<string | null>(null)
  let regions = $state<PhotoRegion[]>([])
  let comments = $state<PhotoComment[]>([])
  let selectedRegionId = $state<string | null>(null)
  let currentUserId = $state<string | null>(null)
  let personOptions = $state<PersonRef[]>([])
  let drawing = $state(false)
  let drawStart = $state<{ x: number; y: number } | null>(null)
  let draftBox = $state<{ x: number; y: number; w: number; h: number } | null>(null)
  let pendingLabel = $state('')
  /** Empty string means no tree person. */
  let pendingPersonId = $state('')
  /** Display name for the currently linked person (for label auto-fill). */
  let linkedPersonName = $state<string | null>(null)
  let showLabelPrompt = $state(false)
  let commentBody = $state('')
  let busy = $state(false)
  let stageEl: HTMLDivElement | undefined = $state()

  const selectedRegion = $derived(regions.find((r) => r.id === selectedRegionId) ?? null)
  const visibleComments = $derived(
    selectedRegionId
      ? comments.filter((c) => c.region_id === selectedRegionId)
      : comments.filter((c) => c.region_id == null),
  )
  const canAssociatePerson = $derived(personOptions.length > 0)
  /** Options for the edit select, including a linked person outside the picker list. */
  const editPersonOptions = $derived.by(() => {
    const opts = [...personOptions]
    const linked = selectedRegion?.person
    if (linked && !opts.some((p) => p.id === linked.id)) {
      opts.unshift(linked)
    }
    return opts
  })
  async function loadAll() {
    loadError = null
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      currentUserId = user?.id ?? null
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      imageUrl = await fetchDriveImageUrl(fileId, 'full')
      const [nextRegions, nextComments, personPicker] = await Promise.all([
        listRegions(fileId),
        listComments(fileId),
        listRegionPersonOptions(),
      ])
      regions = nextRegions
      comments = nextComments
      personOptions = personPicker.options
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load photo'
    }
  }

  onMount(() => {
    void loadAll()
  })

  onDestroy(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  })

  function normFromEvent(e: PointerEvent): { x: number; y: number } | null {
    if (!stageEl) return null
    const rect = stageEl.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || showLabelPrompt) return
    const p = normFromEvent(e)
    if (!p) return
    drawing = true
    drawStart = p
    draftBox = { x: p.x, y: p.y, w: 0, h: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing || !drawStart) return
    const p = normFromEvent(e)
    if (!p) return
    const x = Math.min(drawStart.x, p.x)
    const y = Math.min(drawStart.y, p.y)
    const w = Math.abs(p.x - drawStart.x)
    const h = Math.abs(p.y - drawStart.y)
    draftBox = { x, y, w, h }
  }

  function onPointerUp() {
    if (!drawing) return
    drawing = false
    drawStart = null
    if (!draftBox || draftBox.w < 0.02 || draftBox.h < 0.02) {
      draftBox = null
      return
    }
    pendingLabel = ''
    pendingPersonId = ''
    linkedPersonName = null
    showLabelPrompt = true
  }

  function onPersonChange(_nextId: string, person: PersonRef | null) {
    const prevName = linkedPersonName
    const nextName = person?.displayName ?? null
    const label = pendingLabel.trim()
    if (nextName && (!label || label === prevName)) {
      pendingLabel = nextName
    } else if (!nextName && prevName && label === prevName) {
      pendingLabel = ''
    }
    linkedPersonName = nextName
  }

  async function confirmRegion() {
    if (!draftBox) return
    busy = true
    try {
      const region = await createRegion({
        drive_file_id: fileId,
        x: draftBox.x,
        y: draftBox.y,
        w: draftBox.w,
        h: draftBox.h,
        label: pendingLabel.trim() || null,
        person_id: pendingPersonId || null,
      })
      regions = [...regions, region]
      selectedRegionId = region.id
      draftBox = null
      showLabelPrompt = false
      pendingLabel = region.label ?? ''
      pendingPersonId = region.person_id ?? ''
      linkedPersonName = region.person?.displayName ?? null
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to save box'
    } finally {
      busy = false
    }
  }

  function cancelRegion() {
    draftBox = null
    showLabelPrompt = false
    pendingLabel = ''
    pendingPersonId = ''
    linkedPersonName = null
  }

  async function saveRegionDetails() {
    if (!selectedRegion) return
    busy = true
    try {
      const updated = await updateRegion(selectedRegion.id, {
        label: pendingLabel.trim() || null,
        person_id: pendingPersonId || null,
      })
      regions = regions.map((r) => (r.id === updated.id ? updated : r))
      pendingPersonId = updated.person_id ?? ''
      linkedPersonName = updated.person?.displayName ?? null
      pendingLabel = updated.label ?? ''
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to update box'
    } finally {
      busy = false
    }
  }

  async function removeRegion(id: string) {
    busy = true
    try {
      await deleteRegion(id)
      regions = regions.filter((r) => r.id !== id)
      comments = comments.map((c) => (c.region_id === id ? { ...c, region_id: null } : c))
      if (selectedRegionId === id) selectedRegionId = null
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to delete box'
    } finally {
      busy = false
    }
  }

  async function submitComment() {
    const body = commentBody.trim()
    if (!body) return
    busy = true
    try {
      const comment = await createComment({
        drive_file_id: fileId,
        body,
        region_id: selectedRegionId,
      })
      comments = [...comments, comment]
      commentBody = ''
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to post comment'
    } finally {
      busy = false
    }
  }

  async function removeComment(id: string) {
    busy = true
    try {
      await deleteComment(id)
      comments = comments.filter((c) => c.id !== id)
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to delete comment'
    } finally {
      busy = false
    }
  }

  function selectRegion(id: string) {
    selectedRegionId = selectedRegionId === id ? null : id
    if (selectedRegionId) {
      const r = regions.find((x) => x.id === selectedRegionId)
      pendingLabel = r?.label ?? ''
      pendingPersonId = r?.person_id ?? ''
      linkedPersonName = r?.person?.displayName ?? null
    } else {
      pendingLabel = ''
      pendingPersonId = ''
      linkedPersonName = null
    }
  }

  function formatTime(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return iso
    }
  }
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
    <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{fileName}</h2>
    <Button variant="ghost" size="sm" type="button" onclick={onClose}>
      <XIcon />
      Close
    </Button>
  </header>

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
      {#if loadError && !imageUrl}
        <p class="text-sm text-destructive">{loadError}</p>
      {:else if !imageUrl}
        <p class="text-sm text-muted-foreground">Loading image…</p>
      {:else}
        <div
          bind:this={stageEl}
          class="relative max-h-full max-w-full touch-none select-none"
          role="application"
          aria-label="Photo annotation canvas. Drag to draw a face box."
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
        >
          <img src={imageUrl} alt={fileName} class="block max-h-[min(80dvh,900px)] max-w-full object-contain" draggable="false" />
          <div class="pointer-events-none absolute inset-0">
            {#each regions as region (region.id)}
              {@const boxTitle = region.person
                ? `On tree: ${region.person.displayName}`
                : region.label || 'Face box'}
              <button
                type="button"
                class="pointer-events-auto absolute border-2 bg-primary/10 {selectedRegionId === region.id
                  ? 'border-primary'
                  : 'border-primary/60'}"
                style="left:{region.x * 100}%;top:{region.y * 100}%;width:{region.w * 100}%;height:{region.h * 100}%;"
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation()
                  selectRegion(region.id)
                }}
                title={boxTitle}
              >
                {#if region.person || region.label}
                  <span
                    class="absolute -top-5 left-0 flex max-w-[14rem] items-center gap-1 truncate rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"
                  >
                    {#if region.person}
                      <NetworkIcon class="size-2.5 shrink-0" />
                      {region.person.displayName}
                    {:else}
                      {region.label}
                    {/if}
                  </span>
                {/if}
              </button>
            {/each}
            {#if draftBox}
              <div
                class="absolute border-2 border-dashed border-primary bg-primary/20"
                style="left:{draftBox.x * 100}%;top:{draftBox.y * 100}%;width:{draftBox.w * 100}%;height:{draftBox.h * 100}%;"
              ></div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <aside class="flex w-full shrink-0 flex-col border-t border-border lg:w-80 lg:border-l lg:border-t-0">
      <div class="border-b border-border p-3">
        <p class="text-xs text-muted-foreground">
          Drag on the photo to box a face. Click a box to comment on it; clear selection for photo comments.
        </p>
        {#if selectedRegion}
          <div class="mt-3 space-y-2">
            <p class="text-xs font-medium">
              Box by {selectedRegion.author.displayName}
            </p>
            {#if currentUserId === selectedRegion.user_id}
              {#if canAssociatePerson || selectedRegion.person}
                <label class="block space-y-1">
                  <span class="text-xs text-muted-foreground">On tree as</span>
                  <PersonSearchInput
                    options={editPersonOptions}
                    bind:personId={pendingPersonId}
                    disabled={!canAssociatePerson}
                    onPersonChange={onPersonChange}
                  />
                </label>
              {/if}
              <input
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="Label (e.g. name)"
                bind:value={pendingLabel}
              />
              <div class="flex gap-2">
                <Button size="sm" type="button" disabled={busy} onclick={saveRegionDetails}>Save</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onclick={() => removeRegion(selectedRegion.id)}
                >
                  <Trash2Icon />
                  Delete
                </Button>
              </div>
            {:else}
              {#if selectedRegion.person}
                <p
                  class="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs"
                >
                  <NetworkIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    On tree as
                    <span class="font-medium">{selectedRegion.person.displayName}</span>
                  </span>
                </p>
              {/if}
              {#if selectedRegion.label && selectedRegion.label !== selectedRegion.person?.displayName}
                <p class="text-sm">{selectedRegion.label}</p>
              {:else if !selectedRegion.person}
                <p class="text-sm text-muted-foreground">No label</p>
              {/if}
            {/if}
            <Button size="sm" variant="secondary" type="button" onclick={() => (selectedRegionId = null)}>
              Clear selection
            </Button>
          </div>
        {/if}
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <h3 class="px-3 pt-3 text-sm font-semibold">
          {selectedRegionId ? 'Comments on box' : 'Photo comments'}
        </h3>
        <ul class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {#each visibleComments as comment (comment.id)}
            <li class="rounded-md border border-border p-2 text-sm">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="font-medium">{comment.author.displayName}</p>
                  <p class="text-xs text-muted-foreground">{formatTime(comment.created_at)}</p>
                </div>
                {#if currentUserId === comment.user_id}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onclick={() => removeComment(comment.id)}
                  >
                    <Trash2Icon />
                  </Button>
                {/if}
              </div>
              <p class="mt-1 whitespace-pre-wrap">{comment.body}</p>
            </li>
          {:else}
            <li class="text-sm text-muted-foreground">No comments yet.</li>
          {/each}
        </ul>
        <form
          class="flex gap-2 border-t border-border p-3"
          onsubmit={(e) => {
            e.preventDefault()
            void submitComment()
          }}
        >
          <input
            class="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            placeholder={selectedRegionId ? 'Comment on this face…' : 'Comment on photo…'}
            bind:value={commentBody}
          />
          <Button size="sm" type="submit" disabled={busy || !commentBody.trim()}>Post</Button>
        </form>
      </div>
    </aside>
  </div>

  {#if showLabelPrompt && draftBox}
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div class="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
        <h3 class="text-sm font-semibold">Tag this face</h3>
        <p class="mt-1 text-xs text-muted-foreground">
          Optionally link to someone on the tree and add a label.
        </p>
        {#if canAssociatePerson}
          <label class="mt-3 block space-y-1">
            <span class="text-xs text-muted-foreground">On tree as</span>
            <PersonSearchInput
              options={personOptions}
              bind:personId={pendingPersonId}
              onPersonChange={onPersonChange}
            />
          </label>
        {/if}
        <input
          class="mt-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          placeholder="Label (e.g. name)"
          bind:value={pendingLabel}
        />
        <div class="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onclick={cancelRegion}>Cancel</Button>
          <Button size="sm" type="button" disabled={busy} onclick={confirmRegion}>Save box</Button>
        </div>
      </div>
    </div>
  {/if}

  {#if loadError && imageUrl}
    <p class="border-t border-border px-4 py-2 text-sm text-destructive">{loadError}</p>
  {/if}
</div>
