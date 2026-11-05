import type { Data, Datum } from 'family-chart'
import type { PersonRow, RelationshipInsert, RelationshipRow } from './lib/database.types'

export type LinkedPerson = {
  id: string
  can_edit: boolean
}

/** Rebuild family-chart Data from normalized DB rows. */
export function toChartData(
  people: PersonRow[],
  relationships: Pick<RelationshipRow, 'person_id' | 'related_person_id' | 'type'>[],
): Data {
  const parentsByChild = new Map<string, string[]>()
  const childrenByParent = new Map<string, string[]>()
  const spousesByPerson = new Map<string, string[]>()

  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) {
      if (!list.includes(value)) list.push(value)
    } else {
      map.set(key, [value])
    }
  }

  for (const rel of relationships) {
    if (rel.type === 'parent') {
      // person_id = child, related_person_id = parent
      push(parentsByChild, rel.person_id, rel.related_person_id)
      push(childrenByParent, rel.related_person_id, rel.person_id)
    } else if (rel.type === 'spouse') {
      push(spousesByPerson, rel.person_id, rel.related_person_id)
      push(spousesByPerson, rel.related_person_id, rel.person_id)
    }
  }

  return people.map((person): Datum => ({
    id: person.id,
    data: {
      'first name': person.first_name,
      'last name': person.last_name,
      birthday: person.birthday,
      gender: person.gender,
    },
    rels: {
      parents: parentsByChild.get(person.id) ?? [],
      spouses: spousesByPerson.get(person.id) ?? [],
      children: childrenByParent.get(person.id) ?? [],
    },
  }))
}

/**
 * Convert chart export into people field updates + relationship rows.
 * Does not include user_id / can_edit (preserved separately on save).
 */
export function fromChartData(data: Data): {
  people: Array<{
    id: string
    first_name: string
    last_name: string
    birthday: string
    gender: 'M' | 'F'
  }>
  relationships: RelationshipInsert[]
} {
  const people = data.map((datum) => {
    const gender = datum.data.gender === 'F' ? 'F' : 'M'
    return {
      id: datum.id,
      first_name: String(datum.data['first name'] ?? ''),
      last_name: String(datum.data['last name'] ?? ''),
      birthday: String(datum.data.birthday ?? ''),
      gender: gender as 'M' | 'F',
    }
  })

  const relationships: RelationshipInsert[] = []
  const seenSpouse = new Set<string>()
  const seenParent = new Set<string>()

  for (const datum of data) {
    for (const parentId of datum.rels.parents ?? []) {
      const key = `${datum.id}|${parentId}`
      if (seenParent.has(key)) continue
      seenParent.add(key)
      relationships.push({
        person_id: datum.id,
        related_person_id: parentId,
        type: 'parent',
      })
    }

    for (const spouseId of datum.rels.spouses ?? []) {
      const [a, b] = datum.id < spouseId ? [datum.id, spouseId] : [spouseId, datum.id]
      const key = `${a}|${b}`
      if (seenSpouse.has(key)) continue
      seenSpouse.add(key)
      relationships.push({
        person_id: a,
        related_person_id: b,
        type: 'spouse',
      })
    }
  }

  return { people, relationships }
}

export const SEED_PEOPLE = [
  { id: '0', first_name: 'Ancestor', last_name: 'Thomason', birthday: '', gender: 'M' as const },
  { id: '1', first_name: 'Partner', last_name: 'Thomason', birthday: '', gender: 'F' as const },
  { id: '2', first_name: 'Child', last_name: 'Thomason', birthday: '', gender: 'M' as const },
]

export const SEED_RELATIONSHIPS: RelationshipInsert[] = [
  { person_id: '2', related_person_id: '0', type: 'parent' },
  { person_id: '2', related_person_id: '1', type: 'parent' },
  { person_id: '0', related_person_id: '1', type: 'spouse' },
]
