<script lang="ts">
  import SunIcon from '@lucide/svelte/icons/sun'
  import MoonIcon from '@lucide/svelte/icons/moon'
  import MonitorIcon from '@lucide/svelte/icons/monitor'
  import { resetMode, setMode } from 'mode-watcher'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js'
  import { buttonVariants } from '$lib/components/ui/button/index.js'
  import { cn } from '$lib/utils.js'
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'relative')}
  >
    <SunIcon
      class="size-[1.1rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
    />
    <MoonIcon
      class="absolute size-[1.1rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
    />
    <span class="sr-only">Theme</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onclick={() => setMode('light')}>
      <SunIcon class="size-4" />
      Light
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={() => setMode('dark')}>
      <MoonIcon class="size-4" />
      Dark
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={() => resetMode()}>
      <MonitorIcon class="size-4" />
      System
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
