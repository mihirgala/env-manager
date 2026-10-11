import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { recoverWithCode, unlock } from '@/lib/crypto'

/** Shown by the auth gate when encryption is set up but the vault is locked. */
export function UnlockScreen({ salt, setupSalt, onUnlocked }: {
  salt: string
  setupSalt: string | undefined
  onUnlocked: () => void
}): React.JSX.Element {
  const [mode, setMode] = React.useState<'passphrase' | 'recovery'>('passphrase')
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      if (mode === 'passphrase') {
        await unlock(value, salt)
      } else {
        const { loadConfig } = await import('@/lib/cloud-config')
        const cfg = await loadConfig()
        if (cfg.recoveryBlob === undefined) throw new Error('No recovery blob stored on this device.')
        await recoverWithCode(value, cfg.recoveryBlob, setupSalt)
      }
      setValue('')
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Unlock env-manager</CardTitle>
          <CardDescription>
            Your passphrase decrypts the master key in memory only — it never leaves this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-1" role="tablist" aria-label="Unlock method">
            {(['passphrase', 'recovery'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setValue('')
                  setError('')
                }}
                className={
                  mode === m
                    ? 'inline-flex min-h-[44px] items-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground'
                    : 'inline-flex min-h-[44px] items-center rounded-md px-3 text-sm hover:bg-accent'
                }
              >
                {m === 'passphrase' ? 'Passphrase' : 'Recovery code'}
              </button>
            ))}
          </div>
          <Input
            type="password"
            autoComplete={mode === 'passphrase' ? 'current-password' : 'off'}
            aria-label={mode === 'passphrase' ? 'Passphrase' : 'Recovery code'}
            placeholder={mode === 'passphrase' ? 'Your passphrase' : 'xxxx-xxxx-…'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          {error !== '' && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="button" onClick={submit} disabled={value === '' || busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
