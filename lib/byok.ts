'use client'

/**
 * Bring-Your-Own-Key (BYOK) storage.
 *
 * A user may paste their own Gemini API key so their debates bill to their own
 * Google account instead of the shared server key. The key lives only in this
 * browser (localStorage) and is sent to our API on a per-request header, which
 * forwards it straight to Google. It is never stored or logged server-side.
 */

const STORAGE_KEY = 'tribunal.byok.v1'

export type ByokState = {
  /** Whether the user has switched BYOK on. */
  enabled: boolean
  /** The raw key. Empty when none has been entered. */
  key: string
}

const EMPTY: ByokState = { enabled: false, key: '' }

/** Loads BYOK state from localStorage (SSR-safe). */
export function loadByok(): ByokState {
  if (typeof window === 'undefined') return { ...EMPTY }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<ByokState>
    return {
      enabled: parsed.enabled === true,
      key: typeof parsed.key === 'string' ? parsed.key : '',
    }
  } catch {
    return { ...EMPTY }
  }
}

/** Persists BYOK state. Best-effort — storage may be unavailable. */
export function saveByok(state: ByokState): ByokState {
  if (typeof window === 'undefined') return state
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: state.enabled, key: state.key }))
  } catch {
    /* private mode / quota — ignore, state still applies for this session */
  }
  return state
}

/** Removes any stored key and disables BYOK. */
export function clearByok(): ByokState {
  if (typeof window === 'undefined') return { ...EMPTY }
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return { ...EMPTY }
}

/** The key to actually send: only when BYOK is on AND a key exists. */
export function activeByokKey(state: ByokState): string | undefined {
  const key = state.key.trim()
  return state.enabled && key ? key : undefined
}

/** A short, non-reversible label for showing the key is set (e.g. "AIza…7f3c"). */
export function maskKey(key: string): string {
  const k = key.trim()
  if (!k) return ''
  if (k.length <= 8) return `${k.slice(0, 2)}…`
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}
