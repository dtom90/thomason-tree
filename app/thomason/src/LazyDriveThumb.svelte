<script lang="ts">
  import ImageIcon from '@lucide/svelte/icons/image'
  import { enqueueDriveThumb } from './thumb-queue'

  let {
    fileId,
    root = null,
  }: {
    fileId: string
    root?: Element | null
  } = $props()

  let node = $state<HTMLElement | undefined>()
  let thumbUrl = $state<string | null>(null)

  $effect(() => {
    const el = node
    const id = fileId
    const scrollRoot = root
    if (!el || !id) return

    let objectUrl: string | null = null
    let cancelled = false
    thumbUrl = null

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        obs.disconnect()
        void enqueueDriveThumb(id)
          .then((url) => {
            if (cancelled) {
              URL.revokeObjectURL(url)
              return
            }
            objectUrl = url
            thumbUrl = url
          })
          .catch(() => {
            /* keep placeholder */
          })
      },
      { root: scrollRoot, rootMargin: '240px 0px', threshold: 0 },
    )
    obs.observe(el)

    return () => {
      cancelled = true
      obs.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  })
</script>

<div bind:this={node} class="aspect-square bg-muted/50">
  {#if thumbUrl}
    <img src={thumbUrl} alt="" class="size-full object-cover" />
  {:else}
    <div class="flex size-full items-center justify-center">
      <ImageIcon class="size-10 text-muted-foreground" />
    </div>
  {/if}
</div>
