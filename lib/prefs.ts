'use client'

/**
 * Small UI-preference helpers persisted to localStorage so the app remembers a
 * user's theme and sidebar choice between visits — the basics every chat UI has.
 */

const THEME_KEY = 'tribunal.theme.v1'
const SIDEBAR_KEY = 'tribunal.sidebar.v1'

/** Returns the stored theme (dark = true) or null when the user has not chosen. */
export function loadTheme(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    if (raw === 'dark') return true
    if (raw === 'light') return false
    return null
  } catch {
    return null
  }
}

export function saveTheme(dark: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {
    /* ignore */
  }
}

/** True when the user has collapsed the (desktop) sidebar. */
export function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open')
  } catch {
    /* ignore */
  }
}
