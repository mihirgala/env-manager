/**
 * Theme preference — pure helpers shared by the boot script, provider and tests.
 *
 * `config.json` is the source of truth (`theme`), but `localStorage` is a
 * synchronous mirror so the tiny boot script in `index.html` can apply the
 * class before first paint. Storage failures (privacy mode, disabled storage)
 * must never throw and fall back to `system`.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'env-manager.theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return systemDark ? 'dark' : 'light'
}

/** Toggles the `dark` class on `<html>`; no-op outside a DOM. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

export function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function storePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Mirror only — config.json still persists the preference.
  }
}

/** Calls `cb` when the OS theme changes; returns an unsubscribe function. */
export function watchSystemTheme(cb: (dark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (event: MediaQueryListEvent): void => cb(event.matches)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
