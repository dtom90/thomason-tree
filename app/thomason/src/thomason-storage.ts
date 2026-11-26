import type { Data } from 'family-chart'
import { supabase } from './lib/supabase'
import type { PersonInviteRow, PersonRow } from './lib/database.types'
import { fromChartData, toChartData, type LinkedPerson } from './tree-mapper'

export type TreeLoadResult = {
  data: Data
  linkedPerson: LinkedPerson | null
  /** Person ids that already have a user_id linked. */
  claimedPersonIds: Set<string>
  people: PersonRow[]
  /** Latest invite per person (by created_at), when the viewer can read invites. */
  invitesByPersonId: Map<string, PersonInviteRow>
  /** Linked Google account email per person id (editors only). */
  linkedEmailsByPersonId: Map<string, string>
}

export async function getCurrentPerson(): Promise<LinkedPerson | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('people')
    .select('id, can_edit')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return { id: data.id, can_edit: data.can_edit }
}

/** Clears people.user_id for the signed-in user. */
export async function unlinkMyPerson(): Promise<void> {
  const { error } = await supabase.rpc('unlink_my_person')
  if (error) throw error
}

/** Links the signed-in user to an unclaimed person. */
export async function linkMyPerson(personId: string): Promise<void> {
  const { error } = await supabase.rpc('link_my_person', { target_person_id: personId })
  if (error) throw error
}

/** Editor-only: create a shareable invite token for an unclaimed person. */
export async function createPersonInvite(
  personId: string,
  grantCanEdit: boolean,
  email?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_person_invite', {
    target_person_id: personId,
    grant_can_edit: grantCanEdit,
    invite_email: email?.trim() || null,
  })
  if (error) throw error
  if (!data) throw new Error('No invite token returned')
  return data
}

/** Email an existing invite link (editors only; requires Resend on the edge function). */
export async function sendPersonInviteEmail(opts: {
  to: string
  inviteUrl: string
  personLabel: string
  personUrl: string
  grantCanEdit: boolean
  inviterName?: string
}): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const res = await fetch(`${baseUrl}/functions/v1/send-person-invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: opts.to,
      inviteUrl: opts.inviteUrl,
      personLabel: opts.personLabel,
      personUrl: opts.personUrl,
      grantCanEdit: opts.grantCanEdit,
      inviterName: opts.inviterName,
    }),
  })

  const payload = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    throw new Error(payload?.error || `Edge Function returned ${res.status}`)
  }
  if (payload?.error) throw new Error(payload.error)
}

/** Redeem a pending invite for the signed-in user (links person + optional can_edit). */
export async function redeemPersonInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc('redeem_person_invite', { invite_token: token })
  if (error) throw error
}

/** Latest invite row per person_id (most recently created). */
export function indexLatestInvites(rows: PersonInviteRow[]): Map<string, PersonInviteRow> {
  const byPerson = new Map<string, PersonInviteRow>()
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  for (const row of sorted) {
    if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, row)
  }
  return byPerson
}

export async function loadPersonInvites(): Promise<Map<string, PersonInviteRow>> {
  const { data, error } = await supabase
    .from('person_invites')
    .select('id, person_id, email, grant_can_edit, created_at, expires_at, redeemed_at')
    .order('created_at', { ascending: false })

  // Non-editors get RLS denial — treat as no visible invites.
  if (error) {
    if (/permission|policy|rls/i.test(error.message)) return new Map()
    throw error
  }
  return indexLatestInvites((data ?? []) as PersonInviteRow[])
}

export async function loadLinkedPersonEmails(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('list_linked_person_emails')
  if (error) {
    if (/not an (editor|admin)|permission|policy|rls/i.test(error.message)) return new Map()
    throw error
  }
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (row.person_id && row.email) map.set(row.person_id, row.email)
  }
  return map
}

export async function loadTree(): Promise<TreeLoadResult> {
  const [peopleRes, relsRes, linkedPerson] = await Promise.all([
    supabase.from('people').select('*'),
    supabase.from('relationships').select('person_id, related_person_id, type'),
    getCurrentPerson(),
  ])

  if (peopleRes.error) throw peopleRes.error
  if (relsRes.error) throw relsRes.error

  const people = (peopleRes.data ?? []) as PersonRow[]
  const relationships = relsRes.data ?? []
  const claimedPersonIds = new Set(
    people.filter((p) => p.user_id != null).map((p) => p.id),
  )

  const [invitesByPersonId, linkedEmailsByPersonId] =
    linkedPerson?.can_edit === true
      ? await Promise.all([loadPersonInvites(), loadLinkedPersonEmails()])
      : [new Map<string, PersonInviteRow>(), new Map<string, string>()]

  return {
    data: toChartData(people, relationships),
    linkedPerson,
    claimedPersonIds,
    people,
    invitesByPersonId,
    linkedEmailsByPersonId,
  }
}

/** Updates only the signed-in user's linked person profile fields. */
export async function saveOwnPerson(data: Data, personId: string): Promise<void> {
  const { people } = fromChartData(data)
  const person = people.find((p) => p.id === personId)
  if (!person) return

  const { error } = await supabase
    .from('people')
    .update({
      first_name: person.first_name,
      last_name: person.last_name,
      birthday: person.birthday,
      gender: person.gender,
      updated_at: new Date().toISOString(),
    })
    .eq('id', personId)

  if (error) throw error
}

export async function setPersonAvatar(
  personId: string,
  avatar: { driveFileId: string; regionId: string | null } | null,
): Promise<void> {
  const { error } = await supabase
    .from('people')
    .update({
      avatar_drive_file_id: avatar?.driveFileId ?? null,
      avatar_region_id: avatar?.regionId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', personId)
  if (error) throw error
}

export async function saveTree(data: Data): Promise<void> {
  const { people: chartPeople, relationships } = fromChartData(data)

  const { data: existing, error: existingError } = await supabase
    .from('people')
    .select('id, user_id, can_edit, avatar_drive_file_id, avatar_region_id')

  if (existingError) throw existingError

  const metaById = new Map(
    (existing ?? []).map((row) => [
      row.id,
      {
        user_id: row.user_id,
        can_edit: row.can_edit,
        avatar_drive_file_id: row.avatar_drive_file_id,
        avatar_region_id: row.avatar_region_id,
      },
    ]),
  )

  const upsertRows = chartPeople.map((person) => {
    const meta = metaById.get(person.id)
    return {
      ...person,
      user_id: meta?.user_id ?? null,
      can_edit: meta?.can_edit ?? false,
      avatar_drive_file_id: meta?.avatar_drive_file_id ?? null,
      avatar_region_id: meta?.avatar_region_id ?? null,
      updated_at: new Date().toISOString(),
    }
  })

  const { error: upsertError } = await supabase.from('people').upsert(upsertRows)
  if (upsertError) throw upsertError

  const keepIds = new Set(chartPeople.map((p) => p.id))
  const toDelete = (existing ?? []).map((p) => p.id).filter((id) => !keepIds.has(id))
  if (toDelete.length > 0) {
    const { error: deletePeopleError } = await supabase.from('people').delete().in('id', toDelete)
    if (deletePeopleError) throw deletePeopleError
  }

  const { error: clearRelsError } = await supabase
    .from('relationships')
    .delete()
    .neq('person_id', '')
  if (clearRelsError) throw clearRelsError

  if (relationships.length > 0) {
    const { error: insertRelsError } = await supabase.from('relationships').insert(relationships)
    if (insertRelsError) throw insertRelsError
  }
}
