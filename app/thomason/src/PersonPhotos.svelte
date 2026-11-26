<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import CheckIcon from '@lucide/svelte/icons/check'
  import { Button } from '$lib/components/ui/button/index.js'
  import { detectFaceBoxes } from './face-detect'
  import {
    createRegionsForPersonUpload,
    ensureFamilyFolderAccess,
    fetchDriveImageUrl,
    listRegionsForPerson,
    uploadPersonPhoto,
    type PhotoRegion,
  } from './drive-api'
  import { signInWithGoogleDrive } from './google-auth'

  type AvatarRef = { driveFileId: string; regionId: string | null }

  type Props = {
    personId: string
    personLabel?: string
    avatarDriveFileId?: string | null
    /** Mirrors the person sidebar edit/view toggle. */
    editing?: boolean
    /** Editors: any person. Viewers: only their linked person. */
    canUpload?: boolean
    canSetAvatar?: boolean
    /** Called on form Save when the profile photo draft changed. */
    onAvatarChange?: (personId: string, avatar: AvatarRef | null) => void
  }

  let {
    personId,
    personLabel = '',
    avatarDriveFileId = null,
    editing = false,
    canUpload = false,
    canSetAvatar = false,
    onAvatarChange,
  }: Props = $props()

  const showUpload = $derived(editing && canUpload)
  const showSetAvatar = $derived(editing && canSetAvatar)

  type GalleryItem = {
    driveFileId: string
    regionId: string | null
    regionCount: number
    thumbUrl: string | null
  }

  let items = $state<GalleryItem[]>([])
  /** undefined = unchanged from saved; null = clear; otherwise pending selection. */
  let draftAvatar = $state<AvatarRef | null | undefined>(undefined)
  const selectedAvatarFileId = $derived(
    draftAvatar !== undefined ? (draftAvatar?.driveFileId ?? null) : (avatarDriveFileId ?? null),
  )
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()
  const thumbUrls = new Set<string>()
  let boundForm: HTMLFormElement | null = null

  function revokeThumbs() {
    for (const url of thumbUrls) URL.revokeObjectURL(url)
    thumbUrls.clear()
  }

  async function loadGallery() {
    loadError = null
    try {
      const regions = await listRegionsForPerson(personId)
      const byFile = new Map<string, PhotoRegion[]>()
      for (const region of regions) {
        const list = byFile.get(region.drive_file_id) ?? []
        list.push(region)
        byFile.set(region.drive_file_id, list)
      }

      revokeThumbs()
      const next: GalleryItem[] = []
      for (const [driveFileId, fileRegions] of byFile) {
        let thumbUrl: string | null = null
        try {
          thumbUrl = await fetchDriveImageUrl(driveFileId, 'thumb')
          thumbUrls.add(thumbUrl)
        } catch {
          /* thumb optional */
        }
        next.push({
          driveFileId,
          regionId: fileRegions[0]?.id ?? null,
          regionCount: fileRegions.length,
          thumbUrl,
        })
      }
      items = next
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load photos'
    }
  }

  const needsDriveReconnect = $derived(
    !!loadError &&
      (/Drive access|Drive permission|Google Drive|provider_token|Missing Google|VITE_GOOGLE|Reconnect Google/i.test(
        loadError,
      ) ||
        /sign (out and )?sign in again/i.test(loadError)),
  )

  const needsFolderPick = $derived(
    !!loadError && /select the shared folder|Folder selection cancelled|family folder/i.test(loadError),
  )

  async function reconnectDrive() {
    busy = true
    loadError = null
    try {
      await signInWithGoogleDrive()
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to reconnect Google Drive'
      busy = false
    }
  }

  async function connectFamilyFolder() {
    busy = true
    loadError = null
    try {
      await ensureFamilyFolderAccess()
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to connect family folder'
    } finally {
      busy = false
    }
  }

  async function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !showUpload) return

    busy = true
    loadError = null
    try {
      const boxes = await detectFaceBoxes(file)
      const uploaded = await uploadPersonPhoto(file)
      await createRegionsForPersonUpload({
        drive_file_id: uploaded.id,
        person_id: personId,
        label: personLabel || null,
        boxes,
      })
      await loadGallery()
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Upload failed'
    } finally {
      busy = false
    }
  }

  function chooseAvatar(item: GalleryItem) {
    if (!showSetAvatar || busy) return
    // Selecting the already-saved photo clears any draft change.
    if (item.driveFileId === (avatarDriveFileId ?? null)) {
      draftAvatar = undefined
      return
    }
    draftAvatar = { driveFileId: item.driveFileId, regionId: item.regionId }
  }

  function clearAvatar() {
    if (!showSetAvatar || busy || !selectedAvatarFileId) return
    draftAvatar = avatarDriveFileId ? null : undefined
  }

  function onFormSubmit() {
    if (!showSetAvatar || draftAvatar === undefined) return
    onAvatarChange?.(personId, draftAvatar)
  }

  onMount(() => {
    void loadGallery()
    const form = rootEl?.closest('form')
    if (form instanceof HTMLFormElement) {
      boundForm = form
      // Capture so the draft commits before family-chart's submit reopens the form.
      form.addEventListener('submit', onFormSubmit, true)
    }
  })

  onDestroy(() => {
    boundForm?.removeEventListener('submit', onFormSubmit, true)
    boundForm = null
    revokeThumbs()
  })
</script>

<div class="f3-person-photos space-y-3 border-t border-border pt-3" bind:this={rootEl}>
  <div class="flex items-center justify-between gap-2">
    <p class="text-sm font-medium">Photos</p>
    {#if showUpload}
      <Button
        size="sm"
        type="button"
        disabled={busy}
        onclick={() => fileInput?.click()}
      >
        <UploadIcon />
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        class="hidden"
        onchange={onFileChange}
      />
    {/if}
  </div>

  {#if items.length > 0 && selectedAvatarFileId && !showSetAvatar}
    <p class="text-xs text-muted-foreground">
      The highlighted photo is the profile picture on the tree.
    </p>
  {:else if showSetAvatar && items.length > 0}
    <p class="text-xs text-muted-foreground">
      Click a photo to use it as the profile picture, then Save.
      {#if selectedAvatarFileId}
        <button
          type="button"
          class="ml-1 underline underline-offset-2 hover:text-foreground"
          disabled={busy}
          onclick={clearAvatar}
        >
          Clear profile photo
        </button>
      {/if}
    </p>
  {/if}

  {#if loadError}
    <div class="space-y-2">
      <p class="text-xs text-destructive">{loadError}</p>
      {#if editing}
        <div class="flex flex-wrap gap-2">
          {#if needsFolderPick}
            <Button size="sm" variant="secondary" type="button" disabled={busy} onclick={connectFamilyFolder}>
              Select family folder
            </Button>
          {/if}
          {#if needsDriveReconnect}
            <Button size="sm" variant="secondary" type="button" disabled={busy} onclick={reconnectDrive}>
              Reconnect Google Drive
            </Button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if items.length === 0 && !loadError}
    <p class="text-xs text-muted-foreground">
      {#if showUpload}
        Upload a photo of {personLabel || 'this person'}
      {:else if canUpload}
        Edit to upload photos of {personLabel || 'this person'}
      {:else}
        No photos yet
      {/if}
    </p>
  {:else}
    <div class="f3-person-photo-grid grid grid-cols-3 gap-2">
      {#each items as item (item.driveFileId)}
        {@const isAvatar = selectedAvatarFileId === item.driveFileId}
        {@const tileClass = `f3-person-photo-tile relative aspect-square overflow-hidden rounded-md bg-muted${isAvatar ? ' is-avatar' : ''}`}
        {#snippet tileBody()}
          {#if item.thumbUrl}
            <img src={item.thumbUrl} alt="" class="h-full w-full object-cover" />
          {:else}
            <div class="flex h-full items-center justify-center text-[10px] text-muted-foreground">
              Photo
            </div>
          {/if}
          {#if isAvatar}
            <span class="f3-person-photo-avatar-badge">
              <CheckIcon class="size-3" aria-hidden="true" />
              <span class="f3-person-photo-avatar-label">Profile</span>
            </span>
          {/if}
          {#if item.regionCount > 1}
            <span
              class="absolute bottom-1 right-1 rounded bg-background/90 px-1 text-[10px] font-medium"
            >
              {item.regionCount} faces
            </span>
          {/if}
        {/snippet}
        {#if showSetAvatar}
          <button
            type="button"
            class="{tileClass} text-left transition focus-visible:outline-none"
            disabled={busy}
            aria-pressed={isAvatar}
            onclick={() => chooseAvatar(item)}
            title={isAvatar ? 'Current profile photo' : 'Use as profile photo'}
          >
            {@render tileBody()}
          </button>
        {:else}
          <div
            class={tileClass}
            title={isAvatar ? 'Profile photo' : undefined}
            aria-current={isAvatar ? 'true' : undefined}
          >
            {@render tileBody()}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
