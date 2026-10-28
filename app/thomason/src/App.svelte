<script lang="ts">
  import { onMount } from 'svelte'
  import f3, { type Data, type EditTree } from 'family-chart'
  import seedData from '../data/thomason.json'
  import {
    loadSavedTree,
    saveTree,
    clearSavedTree,
    downloadJson,
  } from './thomason-storage'

  let chartEl: HTMLDivElement | undefined = $state()
  let status = $state('Loading…')
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

  function handleReset() {
    if (
      !confirm(
        'Discard browser-saved changes and reload the seed data from app/thomason/data/thomason.json?',
      )
    ) {
      return
    }
    clearSavedTree()
    window.location.reload()
  }
</script>

<header class="toolbar">
  <h1>Thomason family tree</h1>
  <span class="status" aria-live="polite">{status}</span>
  <button type="button" class="primary" onclick={handleDownload}>Download JSON</button>
  <button type="button" onclick={handleReset}>Reset from file</button>
</header>

<div class="f3" bind:this={chartEl}></div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    background: #252525;
    border-bottom: 1px solid #333;
  }

  h1 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    flex: 1;
    min-width: 160px;
  }

  button {
    font: inherit;
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid #444;
    background: #333;
    color: #eee;
  }

  button:hover {
    background: #3d3d3d;
  }

  button.primary {
    background: #2d6a4f;
    border-color: #40916c;
  }

  button.primary:hover {
    background: #40916c;
  }

  .status {
    font-size: 0.8125rem;
    color: #999;
  }

  .f3 {
    width: 100%;
    height: calc(100vh - 53px);
    background-color: rgb(33, 33, 33);
    color: #fff;
  }
</style>
