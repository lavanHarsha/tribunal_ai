'use client'

import type { SavedDebate } from './ai/types'

const STORAGE_KEY = 'tribunal.history.v1'
const MAX_ITEMS = 25

/** Loads persisted debates from localStorage (safe during SSR). */
export function loadHistory(): SavedDebate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedDebate[]) : []
  } catch {
    return []
  }
}

/** Prepends a debate to history, de-duplicates by id, and caps the list. */
export function saveDebate(debate: SavedDebate): SavedDebate[] {
  if (typeof window === 'undefined') return []
  const next = [debate, ...loadHistory().filter((d) => d.id !== debate.id)].slice(0, MAX_ITEMS)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage full or unavailable — history is best-effort */
  }
  return next
}

/** Removes all persisted debates. */
export function clearHistory(): SavedDebate[] {
  if (typeof window === 'undefined') return []
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return []
}
