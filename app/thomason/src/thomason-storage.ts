import type { Data } from 'family-chart'

export const STORAGE_KEY = 'thomason-tree-data'

export function loadSavedTree(): Data | null {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return null
  try {
    return JSON.parse(saved) as Data
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveTree(data: Data): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function clearSavedTree(): void {
  localStorage.removeItem(STORAGE_KEY)
}
