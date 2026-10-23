import * as React from 'react'
import { Navigate } from 'react-router-dom'
import { loadConfig, saveConfig } from '@/lib/config'
import { isTauri } from '@/lib/tauri'
import { Vault, createTauriDriver } from '@/lib/vault'

type GateState = 'checking' | 'ready' | 'onboarding'

/**
 * First-run gate: before the dashboard, send brand-new installs (no projects,
 * onboarding never completed) to the onboarding flow. Existing installs and
 * the Vite-only preview pass straight through.
 */
export function FirstRunGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = React.useState<GateState>('checking')

  React.useEffect(() => {
    if (!isTauri()) {
      setState('ready')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [cfg, projects] = await Promise.all([
          loadConfig(),
          new Vault(createTauriDriver()).listProjects(),
        ])
        if (cancelled) return
        if (cfg.seenOnboarding === true) {
          setState('ready')
          return
        }
        if (projects.length > 0) {
          // Existing vault from before onboarding existed — don't interrupt.
          await saveConfig({ seenOnboarding: true }).catch(() => {})
          if (!cancelled) setState('ready')
          return
        }
        setState('onboarding')
      } catch {
        // Never trap the user on the splash because of a read error.
        if (!cancelled) setState('ready')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Opening your local vault…</p>
      </div>
    )
  }
  if (state === 'onboarding') return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
