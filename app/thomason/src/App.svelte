<script lang="ts">
  import { onMount } from 'svelte'
  import { ModeWatcher } from 'mode-watcher'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import LogOutIcon from '@lucide/svelte/icons/log-out'
  import f3, { type Data, type EditTree } from 'family-chart'
  import type { Session } from '@supabase/supabase-js'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js'
  import { supabase } from '$lib/supabase'
  import AuthForm from './AuthForm.svelte'
  import { loadTree, resetTreeToSeed, saveTree } from './thomason-storage'
  import type { LinkedPerson } from './tree-mapper'

  let chartEl: HTMLDivElement | undefined = $state()
  let session = $state<Session | null>(null)
  let authReady = $state(false)
  let status = $state('Loading…')
  let resetOpen = $state(false)
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
        status = 'Saved'
      } catch (err) {
        status = err instanceof Error ? err.message : 'Save failed'
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
        .setFields(['first name', 'last name', 'birthday', 'gender'])
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
    status = 'Loading tree…'
    try {
      const result = await loadTree()
      if (generation !== loadGeneration) return
      linkedPerson = result.linkedPerson
      initChart(result.data, result.linkedPerson?.id ?? null, result.linkedPerson?.can_edit === true)
      status =
        result.linkedPerson?.can_edit === true
          ? 'Editor — changes save to Supabase'
          : 'Viewer — read only'
    } catch (err) {
      if (generation !== loadGeneration) return
      console.error('Failed to load tree', err)
      status =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to load tree'
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
      status = 'Signed out'
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

  async function confirmReset() {
    resetOpen = false
    status = 'Resetting…'
    try {
      await resetTreeToSeed()
      await bootstrapTree()
      status = 'Reset to seed'
    } catch (err) {
      status = err instanceof Error ? err.message : 'Reset failed'
    }
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
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80"
  >
    <h1 class="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
      Thomason family tree
    </h1>
    <Badge variant="secondary" class="hidden font-normal sm:inline-flex">
      {canEdit ? 'Editor' : 'Viewer'}
    </Badge>
    <span class="hidden max-w-[14rem] truncate text-sm text-muted-foreground md:inline" title={status}>
      {status}
    </span>
    <span class="hidden max-w-[12rem] truncate text-sm text-muted-foreground lg:inline">
      {session.user.email}
    </span>
    <div class="ml-1 flex items-center gap-1.5">
      <ThemeToggle />
      {#if canEdit}
        <Button variant="ghost" size="sm" type="button" onclick={() => (resetOpen = true)}>
          <RotateCcwIcon />
          Reset
        </Button>
      {/if}
      <Button variant="ghost" size="sm" type="button" onclick={signOut}>
        <LogOutIcon />
        Sign out
      </Button>
    </div>
    <AlertDialog.Root bind:open={resetOpen}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Reset tree data?</AlertDialog.Title>
          <AlertDialog.Description>
            This replaces the shared tree with the seed data. Account links on matching person ids
            are kept.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action onclick={confirmReset}>Reset</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </header>

  <div class="f3 chart-root" bind:this={chartEl}></div>
{/if}
