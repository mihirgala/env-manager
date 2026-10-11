import * as React from 'react'
import { isUnlocked } from '@/lib/crypto'
import { isTauri } from '@/lib/tauri'
import { loadConfig } from '@/lib/cloud-config'
import { UnlockScreen } from '@/screens/unlock'

/**
 * Boot gate: when encryption is set up (salt in config) but the master key
 * isn't in memory, force the Unlock screen. Local-only users who never set
 * a passphrase pass straight through.
 */
export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = React.useState<'checking' | 'open' | 'locked'>('checking')
  const [salt, setSalt] = React.useState('')
  const [setupSalt, setSetupSalt] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTauri()) {
        if (!cancelled) setState('open')
        return
      }
      try {
        const cfg = await loadConfig()
        if (cancelled) return
        if (cfg.cryptoSalt !== undefined && !isUnlocked()) {
          setSalt(cfg.cryptoSalt)
          setSetupSalt(cfg.cryptoSalt)
          setState('locked')
        } else {
          setState('open')
        }
      } catch {
        if (!cancelled) setState('open')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (state === 'locked') {
    return <UnlockScreen salt={salt} setupSalt={setupSalt} onUnlocked={() => setState('open')} />
  }
  return <>{children}</>
}
