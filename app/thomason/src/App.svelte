<script lang="ts">
  import { mount, onMount, unmount } from 'svelte'
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
  import PersonPhotos from './PersonPhotos.svelte'
  import { hydrateChartAvatars, loadAvatarRefs, resolveAvatarUrl } from './avatar'
  import { loadTree, saveOwnPerson, saveTree, linkMyPerson, unlinkMyPerson } from './thomason-storage'
  import type { LinkedPerson } from './tree-mapper'
  import type { Chart } from 'family-chart'

  type Tab = 'tree' | 'photos'

  let chartEl: HTMLDivElement | undefined = $state()
  let session = $state<Session | null>(null)
  let authReady = $state(false)
  let activeTab = $state<Tab>('tree')
  let linkedPerson = $state<LinkedPerson | null>(null)
  let editTree: EditTree | undefined
  let chart: Chart | undefined
  let chartData: Data = []
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let loadGeneration = 0
  let unlinkOpen = $state(false)
  let unlinking = $state(false)
  let linkOpen = $state(false)
  let linkPersonId = $state<string | null>(null)
  let linking = $state(false)
  let personPhotosMount: Record<string, unknown> | null = null
  let avatarBlobUrls: string[] = []
  let avatarDriveByPerson = $state<Map<string, string | null>>(new Map())

  const canEditTree = $derived(linkedPerson?.can_edit === true)

  function unmountPersonPhotos() {
    if (!personPhotosMount) return
    try {
      unmount(personPhotosMount)
    } catch {
      /* already gone */
    }
    personPhotosMount = null
  }

  function revokeAvatarBlobs() {
    for (const url of avatarBlobUrls) URL.revokeObjectURL(url)
    avatarBlobUrls = []
  }

  function schedulePersist() {
    if (!linkedPerson) return
    const person = linkedPerson
    clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!editTree) return
      try {
        const data = editTree.exportData()
        if (person.can_edit) await saveTree(data)
        else await saveOwnPerson(data, person.id)
      } catch (err) {
        console.error('Save failed', err)
      }
    }, 400)
  }

  function destroyChart() {
    clearTimeout(persistTimer)
    unmountPersonPhotos()
    revokeAvatarBlobs()
    editTree = undefined
    chart = undefined
    chartData = []
    avatarDriveByPerson = new Map()
    if (chartEl) chartEl.innerHTML = ''
  }

  async function handleAvatarChange(
    personId: string,
    avatar: { driveFileId: string; regionId: string | null } | null,
  ) {
    const nextMap = new Map(avatarDriveByPerson)
    nextMap.set(personId, avatar?.driveFileId ?? null)
    avatarDriveByPerson = nextMap

    const datum = chartData.find((d) => d.id === personId)
    if (!datum || !chart) return

    const previous = typeof datum.data.avatar === 'string' ? datum.data.avatar : null
    if (previous && avatarBlobUrls.includes(previous)) {
      URL.revokeObjectURL(previous)
      avatarBlobUrls = avatarBlobUrls.filter((u) => u !== previous)
    }

    if (!avatar) {
      delete datum.data.avatar
      chart.updateTree({})
      return
    }

    try {
      const refs = await loadAvatarRefs([
        {
          id: personId,
          avatar_drive_file_id: avatar.driveFileId,
          avatar_region_id: avatar.regionId,
        },
      ])
      const ref = refs.get(personId)
      if (!ref) return
      const url = await resolveAvatarUrl(ref)
      avatarBlobUrls.push(url)
      datum.data.avatar = url
      chart.updateTree({})
    } catch (err) {
      console.error('Failed to refresh avatar', err)
    }
  }

  function injectPersonPhotos(
    form: HTMLElement,
    personId: string,
    data: Data,
    canSetAvatar: boolean,
  ) {
    unmountPersonPhotos()
    form.querySelector('.f3-person-photos-host')?.remove()

    const host = document.createElement('div')
    host.className = 'f3-person-photos-host'
    const fields = form.querySelector('.f3-form-fields')
    if (fields?.parentElement) {
      fields.parentElement.insertBefore(host, fields.nextSibling)
    } else {
      form.appendChild(host)
    }

    const datum = data.find((d) => d.id === personId)
    const first = String(datum?.data['first name'] ?? '').trim()
    const last = String(datum?.data['last name'] ?? '').trim()
    const personLabel = `${first} ${last}`.trim()

    personPhotosMount = mount(PersonPhotos, {
      target: host,
      props: {
        personId,
        personLabel,
        avatarDriveFileId: avatarDriveByPerson.get(personId) ?? null,
        canSetAvatar,
        onAvatarChange: handleAvatarChange,
      },
    })
  }

  function injectAccountLinkField(
    form: HTMLElement,
    personId: string,
    opts: {
      isMe: boolean
      canClaim: boolean
      editable: boolean
      selfEditOnly: boolean
    },
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

    if (opts.selfEditOnly) {
      form.querySelector('.f3-add-relative-btn')?.remove()
      form.querySelector('.f3-form-danger')?.remove()
    }
  }

  function initChart(
    data: Data,
    linked: LinkedPerson | null,
    claimedIds: Set<string>,
  ) {
    if (!chartEl) return
    destroyChart()

    const centerId = linked?.id ?? null
    const treeEditor = linked?.can_edit === true
    const selfEditOnly = linked != null && !treeEditor

    chartData = data
    const f3Chart = f3
      .createChart(chartEl, data)
      .setTransitionTime(1000)
      .setCardXSpacing(250)
      .setCardYSpacing(150)

    const f3Card = f3Chart
      .setCardHtml()
      .setStyle('imageCircleRect')
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
        if (!(form instanceof HTMLElement)) return
        injectAccountLinkField(form, personId, {
          isMe: centerId === personId,
          canClaim: !centerId && !claimedIds.has(personId),
          editable: !form.classList.contains('non-editable'),
          selfEditOnly,
        })
        const canSetAvatar =
          treeEditor || (selfEditOnly && !!centerId && personId === centerId)
        injectPersonPhotos(form, personId, data, canSetAvatar)
      })

    if (treeEditor) {
      tree.setOnChange(() => schedulePersist())
    } else if (selfEditOnly && centerId) {
      tree
        .setCanEdit((datum) => datum.id === centerId)
        .setCanDelete(() => false)
        .setCanAdd(() => ({ parent: false, spouse: false, child: false }))
        .setOnChange(() => schedulePersist())
    } else {
      tree.setNoEdit()
    }

    chart = f3Chart
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
      avatarDriveByPerson = new Map(
        result.people.map((p) => [p.id, p.avatar_drive_file_id]),
      )
      revokeAvatarBlobs()
      const refs = await loadAvatarRefs(result.people)
      if (generation !== loadGeneration) return
      avatarBlobUrls = await hydrateChartAvatars(result.data, refs)
      if (generation !== loadGeneration) {
        revokeAvatarBlobs()
        return
      }
      initChart(result.data, result.linkedPerson, result.claimedPersonIds)
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
        <AccountMenu email={session.user.email ?? ''} canEdit={canEditTree} onSignOut={signOut} />
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
