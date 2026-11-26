<script lang="ts">
  import { onMount } from 'svelte'
  import { ModeWatcher } from 'mode-watcher'
  import ImagesIcon from '@lucide/svelte/icons/images'
  import NetworkIcon from '@lucide/svelte/icons/network'
  import f3, { type Data, type EditTree } from 'family-chart'
  import type { Session } from '@supabase/supabase-js'
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import AccountMenu from '$lib/components/AccountMenu.svelte'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import { supabase } from '$lib/supabase'
  import AuthForm from './AuthForm.svelte'
  import DriveBrowser from './DriveBrowser.svelte'
  import { loadTree, saveTree, linkMyPerson, unlinkMyPerson } from './thomason-storage'
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
  let unlinkOpen = $state(false)
  let unlinking = $state(false)
  let linkOpen = $state(false)
  let linkPersonId = $state<string | null>(null)
  let linking = $state(false)

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

  function injectAccountLinkField(
    form: HTMLElement,
    personId: string,
    opts: { isMe: boolean; canClaim: boolean; editable: boolean },
  ) {
    if (form.querySelector('.f3-you-field')) return
    if (!opts.isMe && !opts.canClaim) return

    const fields = form.querySelector('.f3-form-fields')
    if (!fields) return

    const field = document.createElement('div')
    field.className = opts.editable ? 'f3-form-field f3-you-field' : 'f3-info-field f3-you-field'

    if (opts.isMe && opts.editable) {
      field.innerHTML = `
        <label>You</label>
        <div class="f3-you-field-row">
          <span class="f3-you-field-copy">Your account is linked to this person</span>
          <button type="button" class="f3-unlink-you-btn">Unlink</button>
        </div>
      `
      field.querySelector('.f3-unlink-you-btn')?.addEventListener('click', () => {
        unlinkOpen = true
      })
    } else if (opts.isMe) {
      field.innerHTML = `
        <span class="f3-info-field-label">You</span>
        <span class="f3-info-field-value">
          <span class="card-you-badge f3-form-you-badge">You</span>
        </span>
      `
    } else {
      field.innerHTML = `
        <label>You</label>
        <div class="f3-you-field-row">
          <span class="f3-you-field-copy">Link this person to your account</span>
          <button type="button" class="f3-link-you-btn">Link</button>
        </div>
      `
      field.querySelector('.f3-link-you-btn')?.addEventListener('click', () => {
        linkPersonId = personId
        linkOpen = true
      })
    }

    fields.appendChild(field)
  }

  function initChart(
    data: Data,
    centerId: string | null,
    editable: boolean,
    claimedIds: Set<string>,
  ) {
    if (!chartEl) return
    destroyChart()

    const f3Chart = f3
      .createChart(chartEl, data)
      .setTransitionTime(1000)
      .setCardXSpacing(250)
      .setCardYSpacing(150)

    const f3Card = f3Chart
      .setCardHtml()
      .setCardDisplay([['first name', 'last name']])
      .setOnCardUpdate(function (this: HTMLElement, d) {
        if (!centerId || d.data.id !== centerId) return
        const card = this.querySelector('.card')
        if (!card) return
        card.classList.add('card-you')
        const inner = card.querySelector('.card-inner')
        if (inner && !inner.querySelector('.card-you-badge')) {
          const badge = document.createElement('div')
          badge.className = 'card-you-badge'
          badge.textContent = 'You'
          inner.appendChild(badge)
        }
      })

    if (centerId && data.some((d) => d.id === centerId)) {
      f3Chart.updateMainId(centerId)
    }

    const tree = f3Chart
      .editTree()
      .setFields([
        'first name',
        'last name',
        { type: 'date', label: 'birthday', id: 'birthday' },
      ])
      .setEditFirst(false)
      .setCardClickOpen(f3Card)
      .setOnFormCreation(({ cont, form_creator }) => {
        const personId = form_creator.datum_id
        if (!personId || !data.some((d) => d.id === personId)) return
        const form = cont.querySelector('.f3-form')
        if (!form) return
        injectAccountLinkField(form, personId, {
          isMe: centerId === personId,
          canClaim: !centerId && !claimedIds.has(personId),
          editable: !form.classList.contains('non-editable'),
        })
      })

    if (editable) {
      tree.setOnChange(() => schedulePersist())
    } else {
      tree.setNoEdit()
    }

    editTree = tree
    f3Chart.updateTree({ initial: true })
    const main = f3Chart.getMainDatum()
    if (main) editTree.open(main)
    f3Chart.updateTree({ initial: true })
  }

  async function bootstrapTree() {
    if (!chartEl) return
    const generation = ++loadGeneration
    try {
      const result = await loadTree()
      if (generation !== loadGeneration) return
      linkedPerson = result.linkedPerson
      initChart(
        result.data,
        result.linkedPerson?.id ?? null,
        result.linkedPerson?.can_edit === true,
        result.claimedPersonIds,
      )
    } catch (err) {
      if (generation !== loadGeneration) return
      console.error('Failed to load tree', err)
    }
  }

  async function confirmUnlink() {
    unlinking = true
    try {
      await unlinkMyPerson()
      unlinkOpen = false
      await bootstrapTree()
    } catch (err) {
      console.error('Unlink failed', err)
    } finally {
      unlinking = false
    }
  }

  async function confirmLink() {
    if (!linkPersonId) return
    linking = true
    try {
      await linkMyPerson(linkPersonId)
      linkOpen = false
      linkPersonId = null
      await bootstrapTree()
    } catch (err) {
      console.error('Link failed', err)
    } finally {
      linking = false
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

  <AlertDialog.Root bind:open={unlinkOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Unlink this person?</AlertDialog.Title>
        <AlertDialog.Description>
          Your account will no longer be linked to this person. You can be linked again later.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel disabled={unlinking}>Cancel</AlertDialog.Cancel>
        <Button variant="destructive" disabled={unlinking} onclick={confirmUnlink}>
          {unlinking ? 'Unlinking…' : 'Unlink'}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  <AlertDialog.Root
    bind:open={linkOpen}
    onOpenChange={(open) => {
      if (!open) linkPersonId = null
    }}
  >
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Link this person?</AlertDialog.Title>
        <AlertDialog.Description>
          Your account will be linked to this person so the tree can treat them as you.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel disabled={linking}>Cancel</AlertDialog.Cancel>
        <Button disabled={linking} onclick={confirmLink}>
          {linking ? 'Linking…' : 'Link'}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/if}
