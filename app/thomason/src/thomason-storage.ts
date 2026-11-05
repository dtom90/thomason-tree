import type { Data } from 'family-chart'
import { supabase } from './lib/supabase'
import type { PersonRow } from './lib/database.types'
import { fromChartData, toChartData, type LinkedPerson } from './tree-mapper'

export type TreeLoadResult = {
  data: Data
  linkedPerson: LinkedPerson | null
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

  return {
    data: toChartData(people, relationships),
    linkedPerson,
  }
}

export async function saveTree(data: Data): Promise<void> {
  const { people: chartPeople, relationships } = fromChartData(data)

  const { data: existing, error: existingError } = await supabase
    .from('people')
    .select('id, user_id, can_edit')

  if (existingError) throw existingError

  const metaById = new Map(
    (existing ?? []).map((row) => [row.id, { user_id: row.user_id, can_edit: row.can_edit }]),
  )

  const upsertRows = chartPeople.map((person) => {
    const meta = metaById.get(person.id)
    return {
      ...person,
      user_id: meta?.user_id ?? null,
      can_edit: meta?.can_edit ?? false,
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

/** Reset to seed via security-definer RPC (preserves user_id/can_edit on matching ids). */
export async function resetTreeToSeed(): Promise<void> {
  const { error } = await supabase.rpc('reset_tree_to_seed')
  if (error) throw error
}
