<script lang="ts">
  import { mount, onMount, unmount } from 'svelte'
  import { ModeWatcher } from 'mode-watcher'
  import ImagesIcon from '@lucide/svelte/icons/images'
  import NetworkIcon from '@lucide/svelte/icons/network'
  import f3, { type Data, type Datum, type EditTree } from 'family-chart'
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
  import {
    createPersonInvite,
    loadPersonInvites,
    loadTree,
    saveOwnPerson,
    saveTree,
    linkMyPerson,
    redeemPersonInvite,
    sendPersonInviteEmail,
    unlinkMyPerson,
  } from './thomason-storage'
  import {
    captureInviteFromUrl,
    clearPendingInvite,
    inviteUrl,
    peekPendingInvite,
  } from './invite'
  import {
    inviteStatusActionLabel,
    inviteStatusCopy,
    resolvePersonInviteStatus,
    type PendingPersonInvite,
  } from './invite-status'
  import type { PersonInviteRow } from './lib/database.types'
  import { getPersonIdFromUrl, setPersonIdInUrl } from './person-url'
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
  let persistedPersonIds = new Set<string>()
  let claimedPersonIds = $state<Set<string>>(new Set())
  let invitesByPersonId = $state<Map<string, PersonInviteRow>>(new Map())
  let pendingPersonInvites = $state<PendingPersonInvite[]>([])
  let inviteQueued = $state(false)
  let unlinkOpen = $state(false)
  let unlinking = $state(false)
  let linkOpen = $state(false)
  let linkPersonId = $state<string | null>(null)
  let linking = $state(false)
  let deleteOpen = $state(false)
  let deletePersonLabel = $state('')
  let pendingDelete: {
    deletePerson: () => void
    postSubmit: (props?: { delete?: boolean }) => void
  } | null = null
  let inviteOpen = $state(false)
  let invitePersonId = $state<string | null>(null)
  let invitePersonLabel = $state('')
  let inviteAsEditor = $state(false)
  let inviteEmail = $state('')
  let inviteCreating = $state(false)
  let inviteLink = $state<string | null>(null)
  let inviteCopied = $state(false)
  let inviteEmailedTo = $state<string | null>(null)
  let inviteError = $state<string | null>(null)
  let redeemNotice = $state<string | null>(null)
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
    persistTimer = setTimeout(() => {
      void flushTreePersist(person).catch((err) => {
        console.error('Save failed', err)
      })
    }, 400)
  }

  async function flushTreePersist(person = linkedPerson): Promise<void> {
    if (!person || !editTree) return
    clearTimeout(persistTimer)
    const data = editTree.exportData()
    if (person.can_edit) {
      await saveTree(data)
      for (const row of data) persistedPersonIds.add(row.id)
      await processPendingPersonInvites()
    } else {
      await saveOwnPerson(data, person.id)
    }
  }

  function errorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === 'object' && 'message' in err) {
      const message = String((err as { message: unknown }).message).trim()
      if (message) return message
    }
    if (err instanceof Error && err.message.trim()) return err.message
    return fallback
  }

  function personLabelFromData(personId: string, fallback: string): string {
    const datum = (editTree?.exportData() ?? chartData).find((d) => d.id === personId)
    const first = String(datum?.data['first name'] ?? '').trim()
    const last = String(datum?.data['last name'] ?? '').trim()
    return `${first} ${last}`.trim() || fallback
  }

  function queuePendingPersonInvite(invite: PendingPersonInvite): void {
    pendingPersonInvites = [
      ...pendingPersonInvites.filter((p) => p.personId !== invite.personId),
      invite,
    ]
  }

  async function createInviteLink(opts: {
    personId: string
    email: string | null
    grantCanEdit: boolean
  }): Promise<string> {
    const token = await createPersonInvite(opts.personId, opts.grantCanEdit, opts.email)
    return inviteUrl(token)
  }

  async function emailInviteLink(opts: {
    personId: string
    personLabel: string
    email: string
    grantCanEdit: boolean
    link: string
  }): Promise<void> {
    const personPage = new URL(window.location.origin)
    personPage.searchParams.set('person', opts.personId)
    await sendPersonInviteEmail({
      to: opts.email,
      inviteUrl: opts.link,
      personLabel: opts.personLabel,
      personUrl: personPage.toString(),
      grantCanEdit: opts.grantCanEdit,
    })
  }

  async function processPendingPersonInvites(): Promise<void> {
    const due = pendingPersonInvites.filter((p) => persistedPersonIds.has(p.personId))
    if (due.length === 0) return

    pendingPersonInvites = pendingPersonInvites.filter((p) => !persistedPersonIds.has(p.personId))

    for (const invite of due) {
      const label = personLabelFromData(invite.personId, invite.personLabel)
      try {
        const link = await createInviteLink({
          personId: invite.personId,
          email: invite.email,
          grantCanEdit: invite.grantCanEdit,
        })
        let emailed = false
        if (invite.email) {
          try {
            await emailInviteLink({
              personId: invite.personId,
              personLabel: label,
              email: invite.email,
              grantCanEdit: invite.grantCanEdit,
              link,
            })
            emailed = true
          } catch (err) {
            console.error('Pending invite email failed', err)
            redeemNotice = errorMessage(
              err,
              `Invite created for ${label}, but the email could not be sent.`,
            )
          }
        }
        if (inviteOpen && invitePersonId === invite.personId) {
          inviteLink = link
          inviteQueued = false
          inviteEmailedTo = emailed ? invite.email : null
          invitePersonLabel = label
        } else if (emailed && invite.email) {
          redeemNotice = `Invitation sent to ${invite.email} for ${label}.`
        } else if (!invite.email) {
          redeemNotice = `Invite link ready for ${label}.`
        }
        await refreshInviteStatuses()
        refreshOpenInviteField(invite.personId)
      } catch (err) {
        console.error('Pending invite failed', err)
        queuePendingPersonInvite(invite)
        redeemNotice = errorMessage(err, `Could not send invite for ${label}.`)
        refreshOpenInviteField(invite.personId)
      }
    }
  }

  function destroyChart() {
    clearTimeout(persistTimer)
    unmountPersonPhotos()
    // Do not revoke avatar blobs here — initChart calls destroyChart after
    // hydrateChartAvatars has already assigned those URLs onto chart data.
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
    opts: { editing: boolean; canUpload: boolean; canSetAvatar: boolean },
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
        editing: opts.editing,
        canUpload: opts.canUpload,
        canSetAvatar: opts.canSetAvatar,
        onAvatarChange: handleAvatarChange,
      },
    })
  }

  function personInviteStatusFor(personId: string) {
    return resolvePersonInviteStatus({
      personId,
      claimed: claimedPersonIds.has(personId),
      queued: pendingPersonInvites.find((p) => p.personId === personId),
      latestInvite: invitesByPersonId.get(personId),
    })
  }

  function escapeInviteHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  }

  function renderInviteField(
    form: HTMLElement,
    fields: Element,
    personId: string,
    personLabel: string,
  ) {
    const status = personInviteStatusFor(personId)
    const action = inviteStatusActionLabel(status)
    const copy = escapeInviteHtml(inviteStatusCopy(status))

    let inviteField = form.querySelector('.f3-invite-field')
    if (!(inviteField instanceof HTMLElement)) {
      inviteField = document.createElement('div')
      inviteField.className = 'f3-form-field f3-invite-field'
      fields.appendChild(inviteField)
    }

    inviteField.innerHTML = `
      <label>Invite</label>
      <div class="f3-you-field-row">
        <span class="f3-you-field-copy">${copy}</span>
        ${
          action
            ? `<button type="button" class="f3-invite-you-btn">${escapeInviteHtml(action)}</button>`
            : ''
        }
      </div>
    `

    inviteField.querySelector('.f3-invite-you-btn')?.addEventListener('click', () => {
      const queued = pendingPersonInvites.find((p) => p.personId === personId)
      const latest = invitesByPersonId.get(personId)
      invitePersonId = personId
      invitePersonLabel = personLabel
      inviteAsEditor = queued?.grantCanEdit ?? latest?.grant_can_edit ?? false
      inviteEmail = queued?.email ?? latest?.email ?? ''
      inviteLink = null
      inviteCopied = false
      inviteEmailedTo = null
      // Prefill from queue/latest; show the form so Edit can change email/role.
      inviteQueued = false
      inviteError = null
      inviteOpen = true
    })
  }

  function refreshOpenInviteField(personId: string) {
    const form = chartEl?.querySelector('.f3-form')
    const fields = form?.querySelector('.f3-form-fields')
    if (!(form instanceof HTMLElement) || !fields) return
    if (!form.querySelector('.f3-invite-field') && !canEditTree) return
    const datum = chartData.find((d) => d.id === personId)
    const first = String(datum?.data['first name'] ?? '').trim()
    const last = String(datum?.data['last name'] ?? '').trim()
    const personLabel = `${first} ${last}`.trim() || 'this person'
    if (canEditTree && linkedPerson?.id !== personId) {
      renderInviteField(form, fields, personId, personLabel)
    }
  }

  async function refreshInviteStatuses() {
    if (!canEditTree) {
      invitesByPersonId = new Map()
      return
    }
    invitesByPersonId = await loadPersonInvites()
  }

  function injectAccountLinkField(
    form: HTMLElement,
    personId: string,
    opts: {
      isMe: boolean
      canClaim: boolean
      canInvite: boolean
      personLabel: string
      editable: boolean
      selfEditOnly: boolean
    },
  ) {
    const fields = form.querySelector('.f3-form-fields')
    if (!fields) return

    if ((opts.isMe || opts.canClaim) && !form.querySelector('.f3-account-link-field')) {
      const field = document.createElement('div')
      field.className = opts.editable
        ? 'f3-form-field f3-you-field f3-account-link-field'
        : 'f3-info-field f3-you-field f3-account-link-field'

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

    if (opts.canInvite) {
      renderInviteField(form, fields, personId, opts.personLabel)
    }

    if (opts.selfEditOnly) {
      form.querySelector('.f3-add-relative-btn')?.remove()
      form.querySelector('.f3-form-danger')?.remove()
    }
  }

  function initChart(
    data: Data,
    linked: LinkedPerson | null,
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
      .setStyle('imageRect')
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

    const urlPersonId = getPersonIdFromUrl()
    const initialPersonId =
      (urlPersonId && data.some((d) => d.id === urlPersonId) ? urlPersonId : null) ??
      (centerId && data.some((d) => d.id === centerId) ? centerId : null)
    if (initialPersonId) {
      f3Chart.updateMainId(initialPersonId)
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
        if (!personId) return
        setPersonIdInUrl(personId)
        const form = cont.querySelector('.f3-form')
        if (!(form instanceof HTMLElement)) return
        const datum = data.find((d) => d.id === personId)
        const first = String(datum?.data['first name'] ?? '').trim()
        const last = String(datum?.data['last name'] ?? '').trim()
        const personLabel = `${first} ${last}`.trim() || 'this person'
        const isMe = linkedPerson?.id === personId
        const claimed = claimedPersonIds.has(personId)
        injectAccountLinkField(form, personId, {
          isMe,
          canClaim: linkedPerson == null && !claimed,
          // Editors see invite status for everyone except themselves (including joined).
          canInvite: canEditTree && !isMe,
          personLabel,
          editable: !form.classList.contains('non-editable'),
          selfEditOnly: linkedPerson != null && !canEditTree,
        })
        // Editors: any person. Viewers: only their linked person.
        // Upload / avatar controls only appear while the sidebar is in edit mode.
        const editing = !form.classList.contains('non-editable')
        const canManageOwnPhotos =
          canEditTree || (linkedPerson != null && !canEditTree && isMe)
        injectPersonPhotos(form, personId, data, {
          editing,
          canUpload: canManageOwnPhotos,
          canSetAvatar: canManageOwnPhotos,
        })
      })

    if (treeEditor) {
      tree
        .setOnDelete((datum, deletePerson, postSubmit) => {
          requestDeletePerson(datum, deletePerson, postSubmit)
        })
        .setOnChange(() => schedulePersist())
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

  async function tryRedeemPendingInvite(): Promise<void> {
    const token = captureInviteFromUrl() ?? peekPendingInvite()
    if (!token) return

    try {
      await redeemPersonInvite(token)
      clearPendingInvite()
      redeemNotice = 'Invitation accepted — you are linked to your person on the tree.'
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)
      // Already linked: drop stale invite quietly so it does not retry forever.
      if (/already linked/i.test(message)) {
        clearPendingInvite()
        return
      }
      console.error('Invite redeem failed', err)
      redeemNotice = message || 'Could not accept this invitation.'
      if (!/not authenticated/i.test(message)) clearPendingInvite()
    }
  }

  async function bootstrapTree() {
    if (!chartEl) return
    const generation = ++loadGeneration
    try {
      await tryRedeemPendingInvite()
      if (generation !== loadGeneration) return
      const result = await loadTree()
      if (generation !== loadGeneration) return
      linkedPerson = result.linkedPerson
      persistedPersonIds = new Set(result.people.map((p) => p.id))
      claimedPersonIds = result.claimedPersonIds
      invitesByPersonId = result.invitesByPersonId
      pendingPersonInvites = []
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
      initChart(result.data, result.linkedPerson)
    } catch (err) {
      if (generation !== loadGeneration) return
      console.error('Failed to load tree', err)
    }
  }

  async function confirmCreateInvite() {
    if (!invitePersonId) return
    const email = inviteEmail.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      inviteError = 'Enter a valid email address, or leave it blank for a link only.'
      return
    }
    if (claimedPersonIds.has(invitePersonId)) {
      inviteError = 'This person is already linked to an account.'
      return
    }

    inviteCreating = true
    inviteError = null
    inviteCopied = false
    inviteEmailedTo = null
    inviteQueued = false
    try {
      const personId = invitePersonId
      const label = invitePersonLabel || 'a family member'

      // New relatives are omitted from export/save until the form Save clears `_new_rel_data`.
      if (!persistedPersonIds.has(personId)) {
        queuePendingPersonInvite({
          personId,
          personLabel: label,
          email: email || null,
          grantCanEdit: inviteAsEditor,
        })
        inviteQueued = true
        refreshOpenInviteField(personId)
        return
      }

      const link = await createInviteLink({
        personId,
        email: email || null,
        grantCanEdit: inviteAsEditor,
      })
      inviteLink = link
      if (email) {
        try {
          await emailInviteLink({
            personId,
            personLabel: label,
            email,
            grantCanEdit: inviteAsEditor,
            link,
          })
          inviteEmailedTo = email
        } catch (err) {
          console.error('Send invite email failed', err)
          inviteError = errorMessage(
            err,
            'Invite link created, but the email could not be sent. Copy the link below.',
          )
        }
      }
      await refreshInviteStatuses()
      refreshOpenInviteField(personId)
    } catch (err) {
      console.error('Create invite failed', err)
      inviteError = errorMessage(err, 'Could not create invite')
    } finally {
      inviteCreating = false
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      inviteCopied = true
    } catch (err) {
      console.error('Copy failed', err)
      inviteError = 'Could not copy link — select and copy it manually.'
    }
  }

  function requestDeletePerson(
    datum: Datum,
    deletePerson: () => void,
    postSubmit: (props?: { delete?: boolean }) => void,
  ) {
    const first = String(datum.data['first name'] ?? '').trim()
    const last = String(datum.data['last name'] ?? '').trim()
    deletePersonLabel = `${first} ${last}`.trim() || 'this person'
    pendingDelete = { deletePerson, postSubmit }
    deleteOpen = true
  }

  function confirmDeletePerson() {
    const pending = pendingDelete
    pendingDelete = null
    deleteOpen = false
    if (!pending) return
    pending.deletePerson()
    pending.postSubmit({ delete: true })
  }

  function cancelDeletePerson() {
    pendingDelete = null
    deleteOpen = false
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
      revokeAvatarBlobs()
    }
  })

  $effect(() => {
    if (!authReady) return

    if (!session) {
      destroyChart()
      revokeAvatarBlobs()
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
    revokeAvatarBlobs()
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

  <AlertDialog.Root
    bind:open={deleteOpen}
    onOpenChange={(open) => {
      if (!open) {
        pendingDelete = null
        deletePersonLabel = ''
      }
    }}
  >
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Delete {deletePersonLabel || 'this person'}?</AlertDialog.Title>
        <AlertDialog.Description>
          This removes them from the family tree. Related connections will be cleared. This cannot
          be undone from here.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={cancelDeletePerson}>Cancel</AlertDialog.Cancel>
        <Button variant="destructive" onclick={confirmDeletePerson}>Delete</Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

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

  <AlertDialog.Root
    bind:open={inviteOpen}
    onOpenChange={(open) => {
      if (!open) {
        invitePersonId = null
        invitePersonLabel = ''
        inviteLink = null
        inviteCopied = false
        inviteEmailedTo = null
        inviteQueued = false
        inviteError = null
        inviteAsEditor = false
        inviteEmail = ''
      }
    }}
  >
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Invite to {invitePersonLabel || 'this person'}</AlertDialog.Title>
        <AlertDialog.Description>
          Optionally email someone an invite, or create a link they can open, sign in with Google,
          and join as this person. Links expire in 14 days.
        </AlertDialog.Description>
      </AlertDialog.Header>

      {#if inviteQueued}
        <div class="space-y-3 text-sm">
          <p>
            Invitation queued
            {#if inviteEmail.trim()}
              for <span class="font-medium">{inviteEmail.trim()}</span>
            {/if}.
          </p>
          <p class="text-muted-foreground">
            Click <span class="font-medium">Save</span> on this person to create them and send the
            invite.
          </p>
          <p class="text-xs text-muted-foreground">
            Role: {inviteAsEditor ? 'Editor' : 'Viewer'}
          </p>
        </div>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Done</AlertDialog.Cancel>
        </AlertDialog.Footer>
      {:else if inviteLink}
        <div class="space-y-3">
          {#if inviteEmailedTo}
            <p class="text-sm text-foreground">
              Invitation emailed to <span class="font-medium">{inviteEmailedTo}</span>.
            </p>
          {/if}
          {#if inviteError}
            <p class="text-sm text-destructive">{inviteError}</p>
          {/if}
          <label class="block space-y-1.5 text-sm">
            <span class="font-medium">Invite link</span>
            <textarea
              class="min-h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs"
              readonly
              value={inviteLink}
            ></textarea>
          </label>
          <p class="text-xs text-muted-foreground">
            Role: {inviteAsEditor ? 'Editor' : 'Viewer'}
          </p>
        </div>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Done</AlertDialog.Cancel>
          <Button onclick={copyInviteLink}>
            {inviteCopied ? 'Copied' : 'Copy link'}
          </Button>
        </AlertDialog.Footer>
      {:else}
        <div class="space-y-4">
          {#if invitePersonId && !persistedPersonIds.has(invitePersonId)}
            <p class="text-sm text-muted-foreground">
              This person is not saved yet. The invite will be sent when you click Save.
            </p>
          {/if}
          <label class="block space-y-1.5 text-sm">
            <span class="font-medium">Email <span class="font-normal text-muted-foreground">(optional)</span></span>
            <input
              type="email"
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="cousin@example.com"
              autocomplete="email"
              bind:value={inviteEmail}
              disabled={inviteCreating}
            />
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="mt-0.5 size-4 rounded border-border"
              bind:checked={inviteAsEditor}
              disabled={inviteCreating}
            />
            <span>
              <span class="font-medium">Editor</span>
              <span class="block text-muted-foreground">
                Can edit the whole family tree. Leave unchecked for viewer (own profile only).
              </span>
            </span>
          </label>
          {#if inviteError}
            <p class="text-sm text-destructive">{inviteError}</p>
          {/if}
        </div>
        <AlertDialog.Footer>
          <AlertDialog.Cancel disabled={inviteCreating}>Cancel</AlertDialog.Cancel>
          <Button disabled={inviteCreating} onclick={confirmCreateInvite}>
            {inviteCreating
              ? inviteEmail.trim()
                ? 'Sending…'
                : 'Creating…'
              : invitePersonId && !persistedPersonIds.has(invitePersonId)
                ? 'Queue invitation'
                : inviteEmail.trim()
                  ? 'Send invitation'
                  : 'Create invite link'}
          </Button>
        </AlertDialog.Footer>
      {/if}
    </AlertDialog.Content>
  </AlertDialog.Root>

  {#if redeemNotice}
    <div
      class="fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg"
      role="status"
    >
      <div class="flex items-start gap-3">
        <p class="flex-1">{redeemNotice}</p>
        <button
          type="button"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          onclick={() => (redeemNotice = null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  {/if}
{/if}
