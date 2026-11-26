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
  import { setPersonAvatar } from './thomason-storage'

  type Props = {
    personId: string
    personLabel?: string
    avatarDriveFileId?: string | null
    /** Mirrors the person sidebar edit/view toggle. */
    editing?: boolean
    /** Editors: any person. Viewers: only their linked person. */
    canUpload?: boolean
    canSetAvatar?: boolean
    onAvatarChange?: (
      personId: string,
      avatar: { driveFileId: string; regionId: string | null } | null,
    ) => void
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
  let selectedAvatarFileId = $state<string | null>(avatarDriveFileId)
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let fileInput: HTMLInputElement | undefined = $state()
  const thumbUrls = new Set<string>()

  $effect(() => {
    selectedAvatarFileId = avatarDriveFileId
  })

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

  async function chooseAvatar(item: GalleryItem) {
    if (!showSetAvatar || busy) return
    busy = true
    loadError = null
    try {
      const avatar = { driveFileId: item.driveFileId, regionId: item.regionId }
      await setPersonAvatar(personId, avatar)
      selectedAvatarFileId = item.driveFileId
      onAvatarChange?.(personId, avatar)
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to set profile photo'
    } finally {
      busy = false
    }
  }

  async function clearAvatar() {
    if (!showSetAvatar || busy || !selectedAvatarFileId) return
    busy = true
    loadError = null
    try {
      await setPersonAvatar(personId, null)
      selectedAvatarFileId = null
      onAvatarChange?.(personId, null)
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to clear profile photo'
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void loadGallery()
  })

  onDestroy(() => {
    revokeThumbs()
  })
</script>

<div class="f3-person-photos space-y-3 border-t border-border pt-3">
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

  {#if showSetAvatar && items.length > 0}
    <p class="text-xs text-muted-foreground">
      Click a photo to use it as the profile picture on the tree.
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
    <div class="grid grid-cols-3 gap-2">
      {#each items as item (item.driveFileId)}
        {@const isAvatar = selectedAvatarFileId === item.driveFileId}
        {@const tileClass = `relative aspect-square overflow-hidden rounded-md bg-muted ${isAvatar ? 'ring-2 ring-primary' : ''}`}
        {#snippet tileBody()}
          {#if item.thumbUrl}
            <img src={item.thumbUrl} alt="" class="h-full w-full object-cover" />
          {:else}
            <div class="flex h-full items-center justify-center text-[10px] text-muted-foreground">
              Photo
            </div>
          {/if}
          {#if isAvatar}
            <span
              class="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <CheckIcon class="size-3" />
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
            class="{tileClass} text-left ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
            onclick={() => chooseAvatar(item)}
            title={isAvatar ? 'Current profile photo' : 'Use as profile photo'}
          >
            {@render tileBody()}
          </button>
        {:else}
          <div class={tileClass} title={isAvatar ? 'Profile photo' : undefined}>
            {@render tileBody()}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
