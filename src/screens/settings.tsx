import * as React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { isTauri, configRead, configWrite, listEnvFiles, readEnvFile } from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import {
  generateRecoveryKey,
  isUnlocked,
  lock,
  setupPassphrase,
} from '@/lib/crypto'
import { SupabaseCloudClient } from '@/lib/cloud'
import { isCloudConfigured, loadConfig, saveConfig } from '@/lib/cloud-config'

function downloadFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function SettingsScreen(): React.JSX.Element {
  const toast = useToast()
  const vault = React.useMemo(() => new Vault(createTauriDriver()), [])
  const [deviceName, setDeviceName] = React.useState('')
  const [projects, setProjects] = React.useState<ProjectRecord[]>([])
  const [hasEncryption, setHasEncryption] = React.useState(false)
  const [unlocked, setUnlocked] = React.useState(isUnlocked())
  const [passphrase, setPassphrase] = React.useState('')
  const [recoveryCode, setRecoveryCode] = React.useState<string | null>(null)
  const [recoveryConfirm, setRecoveryConfirm] = React.useState('')
  const [cloudUrl, setCloudUrl] = React.useState('')
  const [cloudKey, setCloudKey] = React.useState('')
  const [cloudOn, setCloudOn] = React.useState(false)
  const [sessionEmail, setSessionEmail] = React.useState<string | null>(null)
  const [otpEmail, setOtpEmail] = React.useState('')
  const [otpCode, setOtpCode] = React.useState('')
  const [otpSent, setOtpSent] = React.useState(false)
  const [knownDevices, setKnownDevices] = React.useState<{ name: string; lastSeen: string }[]>([])
  const [cloudDevices, setCloudDevices] = React.useState<{ name: string; lastPush: string }[]>([])

  React.useEffect(() => {
    if (!isTauri()) return
    configRead()
      .then((cfg) => {
        if (typeof cfg['deviceName'] === 'string') setDeviceName(cfg['deviceName'])
      })
      .catch(() => {})
    loadConfig()
      .then(async (cfg) => {
        setHasEncryption(cfg.cryptoSalt !== undefined)
        setUnlocked(isUnlocked())
        if (typeof cfg.cloudUrl === 'string') setCloudUrl(cfg.cloudUrl)
        if (typeof cfg.cloudKey === 'string') setCloudKey(cfg.cloudKey)
        const on = isCloudConfigured(cfg)
        setCloudOn(on)
        setKnownDevices(cfg.devices ?? [])
        if (on) {
          try {
            const client = new SupabaseCloudClient((cfg.cloudUrl as string).trim(), (cfg.cloudKey as string).trim())
            setSessionEmail(await client.sessionEmail())
            // Devices seen in cloud snapshots (read-only server truth).
            const seen = new Map<string, string>()
            for (const p of await client.listProjects()) {
              const snap = await client.latestSnapshot(p.id).catch(() => null)
              if (snap?.deviceName !== null && snap?.deviceName !== undefined) {
                const prev = seen.get(snap.deviceName)
                if (prev === undefined || snap.createdAt > prev) seen.set(snap.deviceName, snap.createdAt)
              }
            }
            setCloudDevices([...seen.entries()].map(([name, lastPush]) => ({ name, lastPush })))
          } catch {
            setSessionEmail(null)
          }
        }
      })
      .catch(() => {})
    vault
      .listProjects()
      .then(setProjects)
      .catch(() => {})
  }, [vault])

  async function setupEncryption(): Promise<void> {
    try {
      const { salt } = await setupPassphrase(passphrase)
      const { code, blob } = await generateRecoveryKey()
      await saveConfig({ cryptoSalt: salt, recoveryBlob: blob })
      setHasEncryption(true)
      setUnlocked(true)
      setRecoveryCode(code)
      setRecoveryConfirm('')
      setPassphrase('')
      toast('Encryption set up. Save the recovery code — it is shown once.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Setup failed', 'error')
    }
  }

  function confirmRecoverySaved(): void {
    if (recoveryConfirm.trim().toLowerCase() !== (recoveryCode ?? '').toLowerCase()) {
      toast('Code does not match — copy it exactly, then confirm.', 'error')
      return
    }
    setRecoveryCode(null)
    setRecoveryConfirm('')
    toast('Recovery confirmed.')
  }

  function lockNow(): void {
    lock()
    setUnlocked(false)
    toast('Locked.')
  }

  async function forgetDevice(name: string): Promise<void> {
    try {
      const cfg = await loadConfig()
      await saveConfig({ devices: (cfg.devices ?? []).filter((d) => d.name !== name) })
      setKnownDevices((all) => all.filter((d) => d.name !== name))
      toast(`Forgot ${name} locally. (Cloud snapshots keep their device label.)`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Forget failed', 'error')
    }
  }

  async function saveCloud(): Promise<void> {
    try {
      const cfg = await saveConfig({ cloudUrl: cloudUrl.trim(), cloudKey: cloudKey.trim() })
      setCloudOn(isCloudConfigured(cfg))
      toast('Cloud settings saved. Server sees ciphertext only.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error')
    }
  }

  async function sendOtp(): Promise<void> {
    try {
      const client = new SupabaseCloudClient(cloudUrl.trim(), cloudKey.trim())
      await client.signInWithEmail(otpEmail.trim())
      setOtpSent(true)
      toast('Check your email for the code.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
    }
  }

  async function verifyOtp(): Promise<void> {
    try {
      const client = new SupabaseCloudClient(cloudUrl.trim(), cloudKey.trim())
      await client.verifyOtp(otpEmail.trim(), otpCode.trim())
      setSessionEmail(await client.sessionEmail())
      setOtpCode('')
      toast('Signed in.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Verify failed', 'error')
    }
  }

  async function signOut(): Promise<void> {
    try {
      const client = new SupabaseCloudClient(cloudUrl.trim(), cloudKey.trim())
      await client.signOut()
      setSessionEmail(null)
      toast('Signed out.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-out failed', 'error')
    }
  }
  async function saveDeviceName(): Promise<void> {
    try {
      const cfg = await configRead().catch((): Record<string, unknown> => ({}))
      cfg['deviceName'] = deviceName
      await configWrite(cfg)
      toast('Device name saved.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error')
    }
  }

  async function exportAll(): Promise<void> {
    // Plaintext backup per project, all .env* files. Export never touches cloud state.
    try {
      for (const p of projects) {
        const sep = p.folderPath.includes('/') ? '/' : '\\'
        const base = p.folderPath.replace(/[\\/]+$/, '')
        let names = ['.env']
        try {
          const found = await listEnvFiles(p.folderPath)
          if (found.length > 0) names = found
        } catch {
          // fall back to .env
        }
        for (const name of names) {
          try {
            const content = await readEnvFile(`${base}${sep}${name}`)
            downloadFile(`${p.displayName}.${name}.export`, content)
          } catch {
            toast(`Skipped ${p.displayName}/${name} — not readable.`, 'error')
          }
        }
      }
      toast('Export downloaded per project.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    }
  }

  async function removeProject(p: ProjectRecord): Promise<void> {
    if (!window.confirm(`Unlink "${p.displayName}"? Your .env files stay on disk.`)) return
    try {
      await vault.removeProject(p.id)
      setProjects((all) => all.filter((x) => x.id !== p.id))
      toast('Project unlinked — .env files left intact.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Remove failed', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Device</CardTitle>
          <CardDescription>Shown alongside cloud snapshots in P2.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Device name"
            placeholder="e.g. work-laptop"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="secondary" onClick={saveDeviceName} disabled={!isTauri()}>
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Encryption</CardTitle>
          <CardDescription>
            Zero-knowledge: passphrase → Argon2id → master key → per-project keys. The passphrase
            and keys never leave this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!hasEncryption && recoveryCode === null && (
            <>
              <Input
                type="password"
                autoComplete="new-password"
                aria-label="New passphrase"
                placeholder="New passphrase (min 8 characters)"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="min-w-0"
              />
              <div>
                <Button type="button" onClick={setupEncryption} disabled={passphrase.length < 8 || !isTauri()}>
                  Set up encryption
                </Button>
              </div>
            </>
          )}
          {recoveryCode !== null && (
            <div className="rounded-md border border-destructive p-3" role="alert">
              <p className="text-sm font-medium">Recovery code — shown once. Save it now:</p>
              <code className="mt-1 block break-all text-base">{recoveryCode}</code>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Confirm recovery code"
                  placeholder="Type the code to confirm"
                  autoComplete="off"
                  value={recoveryConfirm}
                  onChange={(e) => setRecoveryConfirm(e.target.value)}
                  className="min-w-0 flex-1 font-mono"
                />
                <Button type="button" variant="secondary" onClick={confirmRecoverySaved}>
                  I saved it
                </Button>
              </div>
            </div>
          )}
          {hasEncryption && recoveryCode === null && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm text-muted-foreground">
                {unlocked ? 'Unlocked — keys in memory.' : 'Locked.'}
              </p>
              {unlocked && (
                <Button type="button" variant="outline" onClick={lockNow}>
                  Lock now
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cloud (optional)</CardTitle>
          <CardDescription>
            Local-only is the default and needs no account. With Supabase configured, the server
            sees ciphertext only. Per-project <code>local-only</code> skips cloud entirely.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            aria-label="Supabase URL"
            placeholder="https://xyz.supabase.co"
            autoComplete="off"
            spellCheck={false}
            value={cloudUrl}
            onChange={(e) => setCloudUrl(e.target.value)}
          />
          <Input
            aria-label="Supabase anon key"
            placeholder="anon key"
            autoComplete="off"
            spellCheck={false}
            value={cloudKey}
            onChange={(e) => setCloudKey(e.target.value)}
          />
          <div>
            <Button type="button" variant="secondary" onClick={saveCloud} disabled={!isTauri()}>
              Save cloud settings
            </Button>
          </div>
          {cloudOn && (
            <>
              {sessionEmail !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-auto text-sm">
                    Signed in as <code>{sessionEmail}</code>
                  </p>
                  <Button type="button" variant="outline" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label="Email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      value={otpEmail}
                      onChange={(e) => setOtpEmail(e.target.value)}
                      className="min-w-0 flex-1"
                    />
                    <Button type="button" variant="secondary" onClick={sendOtp} disabled={otpEmail.trim() === ''}>
                      Send code
                    </Button>
                  </div>
                  {otpSent && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        aria-label="Email code"
                        placeholder="6-digit code"
                        autoComplete="one-time-code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="min-w-0 flex-1 font-mono"
                      />
                      <Button type="button" onClick={verifyOtp} disabled={otpCode.trim() === ''}>
                        Verify
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>
            This device plus every device seen pushing to your cloud snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm">
            This device: <code>{deviceName !== '' ? deviceName : '(unnamed)'}</code>
          </p>
          {knownDevices.length === 0 && cloudDevices.length === 0 && (
            <p className="text-sm text-muted-foreground">No other devices seen yet.</p>
          )}
          {knownDevices.map((d) => (
            <div key={d.name} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3">
              <span className="mr-auto min-w-0 truncate text-sm">
                <code>{d.name}</code> <span className="text-muted-foreground">· last push {d.lastSeen}</span>
              </span>
              <Button type="button" variant="outline" onClick={() => forgetDevice(d.name)}>
                Forget
              </Button>
            </div>
          ))}
          {cloudDevices
            .filter((d) => !knownDevices.some((k) => k.name === d.name))
            .map((d) => (
              <div key={d.name} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3">
                <span className="mr-auto min-w-0 truncate text-sm">
                  <code>{d.name}</code> <span className="text-muted-foreground">· cloud snapshot {d.lastPush}</span>
                </span>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export / Remove</CardTitle>
          <CardDescription>
            Export gives you plaintext backups per project. Remove unlinks the app — your{' '}
            <code>.env</code> files stay intact.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>
            <Button type="button" variant="secondary" onClick={exportAll} disabled={!isTauri() || projects.length === 0}>
              Export all backups
            </Button>
          </div>
          {projects.map((p) => (
            <div key={p.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3">
              <Link to={`/project/${encodeURIComponent(p.id)}`} className="mr-auto min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline">
                {p.displayName}
              </Link>
              <Button type="button" variant="outline" onClick={() => removeProject(p)}>
                Remove
              </Button>
            </div>
          ))}
          {!isTauri() && (
            <p className="text-sm text-muted-foreground">
              Open the desktop app (<code>npm run tauri dev</code>) to manage projects.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
