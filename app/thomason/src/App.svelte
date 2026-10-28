<script lang="ts">
  import { onMount } from 'svelte'
  import { ModeWatcher } from 'mode-watcher'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import f3, { type Data, type EditTree } from 'family-chart'
  import seedData from '../data/thomason.json'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js'
  import {
    loadSavedTree,
    saveTree,
    clearSavedTree,
    downloadJson,
  } from './thomason-storage'

  let chartEl: HTMLDivElement | undefined = $state()
  let status = $state('Loading…')
  let resetOpen = $state(false)
  let editTree: EditTree | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  function schedulePersist() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      if (!editTree) return
      saveTree(editTree.exportData())
      status = 'Saved in this browser'
    }, 400)
  }

  function initChart(data: Data) {
    if (!chartEl) return
    const f3Chart = f3.createChart(chartEl, data)
      .setTransitionTime(1000)
      .setCardXSpacing(250)
      .setCardYSpacing(150)

    const f3Card = f3Chart.setCardHtml().setCardDisplay([
      ['first name', 'last name'],
      ['birthday'],
    ])

    editTree = f3Chart
      .editTree()
      .setFields(['first name', 'last name', 'birthday', 'gender'])
      .setEditFirst(true)
      .setCardClickOpen(f3Card)
      .setOnChange(() => schedulePersist())

    f3Chart.updateTree({ initial: true })
    editTree.open(f3Chart.getMainDatum())
    f3Chart.updateTree({ initial: true })
  }

  onMount(() => {
    const saved = loadSavedTree()
    const data = saved ?? (seedData as unknown as Data)
    initChart(data)
    status = saved ? 'Restored from this browser' : 'Edit cards to build your tree'
  })

  function handleDownload() {
    if (!editTree) return
    downloadJson(editTree.getDataJson(), 'thomason.json')
    status = 'Downloaded thomason.json'
  }

  function confirmReset() {
    clearSavedTree()
    window.location.reload()
  }
</script>

<ModeWatcher />

<header
  class="flex h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 shadow-sm"
>
  <h1 class="min-w-[10rem] flex-1 text-base font-semibold tracking-tight">
    Thomason family tree
  </h1>
  <Badge variant="secondary" class="max-w-[min(100%,20rem)] truncate font-normal">
    {status}
  </Badge>
  <ThemeToggle />
  <Button type="button" onclick={handleDownload}>
    <DownloadIcon />
    Download JSON
  </Button>
  <Button variant="outline" type="button" onclick={() => (resetOpen = true)}>
    <RotateCcwIcon />
    Reset
  </Button>
  <AlertDialog.Root bind:open={resetOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Reset tree data?</AlertDialog.Title>
        <AlertDialog.Description>
          This discards browser-saved changes and reloads the seed data from
          <code class="rounded bg-muted px-1 py-0.5 text-xs">app/thomason/data/thomason.json</code>.
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
