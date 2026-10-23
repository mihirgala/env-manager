import * as React from 'react'
import { loadConfig, saveConfig } from '@/lib/config'
import { isTauri } from '@/lib/tauri'
import {
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = React.useState<ThemePreference>(readStoredPreference)
  const [systemDark, setSystemDark] = React.useState(systemPrefersDark)
  const resolved = resolveTheme(preference, systemDark)

  // Apply before paint in the browser; the inline boot script covers the very
  // first load, this covers React updates and config reconciliation.
  React.useLayoutEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  React.useEffect(() => watchSystemTheme(setSystemDark), [])

  // config.json is the source of truth; localStorage is only the synchronous
  // mirror used by the boot script. If they disagree, config wins on mount.
  React.useEffect(() => {
    let cancelled = false
    void loadConfig()
      .then((config) => {
        if (cancelled) return
        const next = isThemePreference(config.theme) ? config.theme : readStoredPreference()
        setPreferenceState(next)
        storePreference(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Match native window chrome where the platform supports it. Failure is
  // expected outside Tauri and on older runtimes — never break the preview.
  React.useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (!cancelled) await getCurrentWindow().setTheme(resolved)
      } catch {
        // Missing capability or unsupported platform: the app still themes.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolved])

  const setPreference = React.useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    storePreference(next)
    void saveConfig({ theme: next }).catch(() => {})
  }, [])

  const value = React.useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext)
  if (context === null) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
