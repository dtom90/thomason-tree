<script lang="ts">
  import CircleUserIcon from '@lucide/svelte/icons/circle-user'
  import HardDriveIcon from '@lucide/svelte/icons/hard-drive'
  import LogOutIcon from '@lucide/svelte/icons/log-out'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { buttonVariants } from '$lib/components/ui/button/index.js'
  import { cn } from '$lib/utils.js'
  import { signInWithGoogleDrive } from '../../google-auth'

  let {
    email,
    canEdit,
    onSignOut,
  }: {
    email: string
    canEdit: boolean
    onSignOut: () => void
  } = $props()

  let reconnectBusy = $state(false)

  async function reconnectDrive() {
    reconnectBusy = true
    try {
      await signInWithGoogleDrive()
    } catch (err) {
      console.error('Drive reconnect failed', err)
      reconnectBusy = false
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-w-[12rem] gap-1.5')}
    title={email}
  >
    <CircleUserIcon class="size-3.5 shrink-0" />
    <span class="truncate">{email}</span>
    <span class="sr-only">Account</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-48">
    <DropdownMenu.Label class="space-y-1.5 font-normal">
      <div class="truncate" title={email}>{email}</div>
      <Badge variant="secondary" class="font-normal">
        {canEdit ? 'Editor' : 'Viewer'}
      </Badge>
    </DropdownMenu.Label>
    <DropdownMenu.Separator />
    <DropdownMenu.Item disabled={reconnectBusy} onclick={reconnectDrive}>
      <HardDriveIcon class="size-4" />
      {reconnectBusy ? 'Redirecting…' : 'Reconnect Drive (photos)'}
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={onSignOut}>
      <LogOutIcon class="size-4" />
      Sign out
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
