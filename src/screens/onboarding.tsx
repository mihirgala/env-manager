import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCopy,
  FolderPlus,
  FolderSearch,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/components/theme-toggle'
import { useToast } from '@/components/toaster'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { loadConfig, saveConfig } from '@/lib/config'
import { generateRecoveryKey, setupPassphrase } from '@/lib/crypto'
import { isTauri } from '@/lib/tauri'

type Step = 'welcome' | 'security' | 'projects'

const stepOrder: Step[] = ['welcome', 'security', 'projects']
const stepLabel: Record<Step, string> = {
  welcome: 'Welcome',
  security: 'Security',
  projects: 'Projects',
}

type Target = '/' | '/add' | '/add?tab=scan'

/**
 * First-run onboarding. Shown before the dashboard by `FirstRunGate` for a
 * brand-new vault. Three screens, all skippable: what the app is, set the
 * passphrase (with a show-once recovery code), then add or scan projects.
 */
export function OnboardingScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const [checking, setChecking] = React.useState(true)
  const [step, setStep] = React.useState<Step>('welcome')
  const [hasEncryption, setHasEncryption] = React.useState(false)
  const [passphrase, setPassphrase] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [recoveryCode, setRecoveryCode] = React.useState<string | null>(null)
  const [savedCode, setSavedCode] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // Visiting /onboarding after setup should not repeat the flow.
  React.useEffect(() => {
    if (!isTauri()) {
      setChecking(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadConfig()
        if (!cancelled) setHasEncryption(cfg.cryptoSalt !== undefined)
        if (cfg.seenOnboarding === true) {
          navigate('/', { replace: true })
          return
        }
      } catch {
        // Continue with onboarding — setup failures surface inline.
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const stepIndex = stepOrder.indexOf(step)

  async function finish(target: Target): Promise<void> {
    setBusy(true)
    try {
      if (isTauri()) await saveConfig({ seenOnboarding: true })
    } catch {
      // Non-fatal: the gate only re-checks on the next launch.
    } finally {
      setBusy(false)
      navigate(target, { replace: true })
    }
  }

  async function createPassphrase(): Promise<void> {
    setError('')
    if (!isTauri()) {
      setError('Passphrase setup needs the desktop app — run `pnpm tauri dev`.')
      return
    }
    if (passphrase.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match.')
      return
    }
    setBusy(true)
    try {
      const { salt } = await setupPassphrase(passphrase)
      const { code, blob } = await generateRecoveryKey()
      await saveConfig({ cryptoSalt: salt, recoveryBlob: blob })
      setHasEncryption(true)
      setRecoveryCode(code)
      setSavedCode(false)
      setPassphrase('')
      setConfirm('')
      toast('Encryption is on. Save the recovery code — it is shown once.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up encryption.')
    } finally {
      setBusy(false)
    }
  }

  async function copyCode(): Promise<void> {
    if (recoveryCode === null) return
    try {
      await navigator.clipboard.writeText(recoveryCode)
      toast('Recovery code copied.')
    } catch {
      setError('Clipboard is unavailable — select the code and copy it manually.')
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Getting things ready…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-[60px] items-center gap-3 border-b px-4 py-2 sm:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <KeyRound aria-hidden size={18} />
        </span>
        <span className="min-w-0 truncate text-sm font-semibold tracking-tight">env-manager</span>
        <span className="ml-auto shrink-0">
          <ThemeToggle />
        </span>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Onboarding progress">
            {stepOrder.map((name, index) => {
              const current = name === step
              const done = index < stepIndex
              return (
                <li key={name} className="flex items-center gap-2">
                  <span
                    aria-current={current ? 'step' : undefined}
                    className={
                      current
                        ? 'inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-primary px-3 font-medium text-primary-foreground'
                        : done
                          ? 'inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-secondary px-3 font-medium text-secondary-foreground'
                          : 'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-muted-foreground'
                    }
                  >
                    {done ? <Check aria-hidden size={13} /> : <span aria-hidden>{index + 1}</span>}
                    {stepLabel[name]}
                  </span>
                  {index < stepOrder.length - 1 && (
                    <span aria-hidden className="text-muted-foreground">
                      /
                    </span>
                  )}
                </li>
              )
            })}
          </ol>

          {step === 'welcome' && (
            <Card>
              <CardHeader>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  local-first · v0.1
                </p>
                <CardTitle className="text-[clamp(1.4rem,2.5vw+1rem,2rem)]">
                  Your .env files, with a safety net
                </CardTitle>
                <CardDescription>
                  env-manager is a sidecar. Your <code>.env</code> files stay exactly where they
                  are and remain the source of truth — the app only reads and writes them when you
                  ask, and keeps encrypted backups in a local vault.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col gap-3 text-sm">
                  <li className="flex items-start gap-3">
                    <ShieldCheck aria-hidden className="mt-0.5 shrink-0 text-primary" size={18} />
                    <span>
                      <span className="font-medium">No account, no server.</span> The vault and the
                      passphrase never leave this device.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <FolderSearch aria-hidden className="mt-0.5 shrink-0 text-primary" size={18} />
                    <span>
                      <span className="font-medium">Fits real projects.</span> Add one folder or
                      scan a parent folder, including monorepo subfolders.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <FolderPlus aria-hidden className="mt-0.5 shrink-0 text-primary" size={18} />
                    <span>
                      <span className="font-medium">Move backups by hand.</span> One encrypted{' '}
                      <code>.db</code> vault file goes on a USB drive — there is nothing to sync
                      to.
                    </span>
                  </li>
                </ul>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => finish('/')}
                    disabled={busy || recoveryCode !== null}
                    className="w-full sm:w-auto"
                  >
                    Skip setup
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setStep('security')}
                    className="w-full sm:ml-auto sm:w-auto"
                  >
                    Get started
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 'security' && (
            <Card>
              <CardHeader>
                <CardTitle>Protect the vault</CardTitle>
                <CardDescription>
                  A passphrase turns the local backup store into ciphertext. It is entered at every
                  launch and never stored — not in the OS credential store, not on disk.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {!hasEncryption && recoveryCode === null && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="onboarding-passphrase" className="text-sm font-medium">
                        Passphrase
                      </label>
                      <Input
                        id="onboarding-passphrase"
                        type="password"
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="onboarding-confirm" className="text-sm font-medium">
                        Confirm passphrase
                      </label>
                      <Input
                        id="onboarding-confirm"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Type it again"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </div>
                    {error !== '' && (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Skipping leaves backups unavailable until you set a passphrase in Settings.
                    </p>
                  </>
                )}

                {recoveryCode !== null && (
                  <div className="rounded-md border border-destructive p-3" role="alert">
                    <p className="text-sm font-medium">Recovery code — shown once. Save it now.</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-sm">
                        {recoveryCode}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={copyCode}
                        className="w-full sm:w-auto"
                      >
                        <ClipboardCopy aria-hidden />
                        Copy
                      </Button>
                    </div>
                    <label className="mt-3 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={savedCode}
                        onChange={(e) => setSavedCode(e.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span>
                        I saved this code somewhere safe. It is the only way back in if I forget my
                        passphrase.
                      </span>
                    </label>
                  </div>
                )}

                {hasEncryption && recoveryCode === null && (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Encryption is already set up on this device. Continue to add your first
                    projects.
                  </p>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setError('')
                      setStep('welcome')
                    }}
                    disabled={busy}
                    className="w-full sm:w-auto"
                  >
                    <ArrowLeft aria-hidden />
                    Back
                  </Button>
                  <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
                    {!hasEncryption && recoveryCode === null && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setError('')
                          setStep('projects')
                        }}
                        disabled={busy}
                        className="w-full sm:w-auto"
                      >
                        Set up later
                      </Button>
                    )}
                    {recoveryCode === null ? (
                      <Button
                        type="button"
                        onClick={hasEncryption ? () => setStep('projects') : createPassphrase}
                        disabled={
                          busy || (!hasEncryption && (passphrase.length < 8 || confirm.length < 8))
                        }
                        className="w-full sm:w-auto"
                      >
                        {busy ? 'Working…' : hasEncryption ? 'Continue' : 'Set passphrase'}
                        <ArrowRight aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => setStep('projects')}
                        disabled={!savedCode}
                        className="w-full sm:w-auto"
                      >
                        Continue
                        <ArrowRight aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 'projects' && (
            <Card>
              <CardHeader>
                <CardTitle>Add your first projects</CardTitle>
                <CardDescription>
                  Pick a folder containing repositories, or add a single project. Only folders with
                  a real env file are offered — templates like <code>.env.example</code> are
                  ignored.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button
                  type="button"
                  onClick={() => finish('/add?tab=scan')}
                  disabled={busy}
                  className="w-full justify-start whitespace-normal"
                >
                  <FolderSearch aria-hidden />
                  <span className="text-left">
                    <span className="block">Scan a parent folder</span>
                    <span className="block text-xs font-normal opacity-80">
                      Finds repos and monorepo subfolders — recommended
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => finish('/add')}
                  disabled={busy}
                  className="w-full justify-start whitespace-normal"
                >
                  <FolderPlus aria-hidden />
                  <span className="text-left">
                    <span className="block">Add one folder</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      Pick a single project folder
                    </span>
                  </span>
                </Button>
                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep('security')}
                    disabled={busy}
                    className="w-full sm:w-auto"
                  >
                    <ArrowLeft aria-hidden />
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => finish('/')}
                    disabled={busy}
                    className="w-full sm:ml-auto sm:w-auto"
                  >
                    Go to dashboard
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="border-t px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
        No account. No server. Your <code>.env</code> stays yours — uninstalling leaves it intact.
      </footer>
    </div>
  )
}
