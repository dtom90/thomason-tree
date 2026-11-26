<script lang="ts">
  import { onMount } from 'svelte'
  import { ModeWatcher } from 'mode-watcher'
  import ImagesIcon from '@lucide/svelte/icons/images'
  import NetworkIcon from '@lucide/svelte/icons/network'
  import f3, { type Data, type EditTree } from 'family-chart'
  import type { Session } from '@supabase/supabase-js'
  import AccountMenu from '$lib/components/AccountMenu.svelte'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import { supabase } from '$lib/supabase'
  import AuthForm from './AuthForm.svelte'
  import DriveBrowser from './DriveBrowser.svelte'
  import { loadTree, saveTree } from './thomason-storage'
  import type { LinkedPerson } from './tree-mapper'

  type Tab = 'tree' | 'photos'

  let chartEl: HTMLDivElement | undefined = $state()
  let session = $state<Session | null>(null)
  let authReady = $state(false)
  let activeTab = $state<Tab>('tree')
  let linkedPerson = $state<LinkedPerson | null>(null)
  let editTree: EditTree | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let loadGeneration = 0

  const canEdit = $derived(linkedPerson?.can_edit === true)

  function schedulePersist() {
    if (!canEdit) return
    clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!editTree) return
      try {
        await saveTree(editTree.exportData())
      } catch (err) {
        console.error('Save failed', err)
      }
    }, 400)
  }

  function destroyChart() {
    clearTimeout(persistTimer)
    editTree = undefined
    if (chartEl) chartEl.innerHTML = ''
  }

  function initChart(data: Data, centerId: string | null, editable: boolean) {
    if (!chartEl) return
    destroyChart()

    const f3Chart = f3
      .createChart(chartEl, data)
      .setTransitionTime(1000)
      .setCardXSpacing(250)
      .setCardYSpacing(150)

    const f3Card = f3Chart.setCardHtml().setCardDisplay([
      ['first name', 'last name'],
      ['birthday'],
    ])

    if (centerId && data.some((d) => d.id === centerId)) {
      f3Chart.updateMainId(centerId)
    }

    if (editable) {
      editTree = f3Chart
        .editTree()
        .setFields(['first name', 'last name', 'birthday'])
        .setEditFirst(true)
        .setCardClickOpen(f3Card)
        .setOnChange(() => schedulePersist())

      f3Chart.updateTree({ initial: true })
      editTree.open(f3Chart.getMainDatum())
      f3Chart.updateTree({ initial: true })
    } else {
      f3Chart.updateTree({ initial: true })
    }
  }

  async function bootstrapTree() {
    if (!chartEl) return
    const generation = ++loadGeneration
    try {
      const result = await loadTree()
      if (generation !== loadGeneration) return
      linkedPerson = result.linkedPerson
      initChart(result.data, result.linkedPerson?.id ?? null, result.linkedPerson?.can_edit === true)
    } catch (err) {
      if (generation !== loadGeneration) return
      console.error('Failed to load tree', err)
    }
  }

  onMount(() => {
    let unsubscribed = false

    supabase.auth.getSession().then(({ data }) => {
      if (unsubscribed) return
      session = data.session
      authReady = true
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      session = next
      authReady = true
    })

    return () => {
      unsubscribed = true
      subscription.unsubscribe()
      clearTimeout(persistTimer)
    }
  })

  $effect(() => {
    if (!authReady) return

    if (!session) {
      destroyChart()
      linkedPerson = null
      return
    }

    if (!chartEl) return

    const userId = session.user.id
    void userId
    void bootstrapTree()
  })

  async function signOut() {
    destroyChart()
    await supabase.auth.signOut()
  }
</script>

<ModeWatcher />

{#if !authReady}
  <div class="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
{:else if !session}
  <AuthForm />
{:else}
  <div class="flex h-dvh flex-col">
    <header
      class="relative flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <h1 class="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        Thomason Family Tree
      </h1>
      <nav
        class="absolute left-1/2 flex -translate-x-1/2 gap-1"
        aria-label="Main"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tree'}
          class="inline-flex h-14 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors {activeTab ===
          'tree'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = 'tree')}
        >
          <NetworkIcon class="size-3.5" />
          Family tree
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'photos'}
          class="inline-flex h-14 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors {activeTab ===
          'photos'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = 'photos')}
        >
          <ImagesIcon class="size-3.5" />
          Photos
        </button>
      </nav>
      <div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <ThemeToggle />
        <AccountMenu email={session.user.email ?? ''} {canEdit} onSignOut={signOut} />
      </div>
    </header>

    <main class="relative min-h-0 flex-1">
      <div class="absolute inset-0 {activeTab === 'tree' ? '' : 'invisible pointer-events-none'}">
        <div class="f3 chart-root" bind:this={chartEl}></div>
      </div>
      {#if activeTab === 'photos'}
        <DriveBrowser />
      {/if}
    </main>
  </div>
{/if}
