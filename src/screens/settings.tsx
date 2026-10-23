import { Archive, Monitor, Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { backupAllProjects, describeBackupResult } from '@/lib/backup-all'
import { trackableEnvFiles } from '@/lib/env-files'
import { folderKey } from '@/lib/paths'
import { createTauriStore } from '@/lib/store'
import { backupToVault, type SyncContext } from '@/lib/sync'
import {
  backupEnvFile,
  isTauri,
  linksRead,
  linksWrite,
  listEnvFiles,
  pickOpenFile,
  pickSaveFile,
  readEnvFile,
  writeEnvFile,
  type DialogFilter,
} from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import {
  currentSalt,
  generateRecoveryKey,
  isUnlocked,
  lock,
  setupPassphrase,
} from '@/lib/crypto'
import { ensureDeviceName, loadConfig, saveConfig } from '@/lib/config'
import {
  exportVaultFile,
  importPortableVault,
  preparePortableImport,
  readPortableVault,
  type PortableVault,
} from '@/lib/portable'

const VAULT_FILTERS: DialogFilter[] = [{ name: 'env-manager vault', extensions: ['db'] }]

const themeOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

interface VaultStats {
  snapshots: number
  bytes: number
  lastBackup: string | null
}

interface PendingVaultImport {
  path: string
  vault: PortableVault
  needsPassphrase: boolean
  passphrase: string
  error: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SettingsScreen(): React.JSX.Element {
  const toast = useToast()
  const { preference, resolved, setPreference } = useTheme()
  const vault = React.useMemo(() => new Vault(createTauriDriver()), [])
  const store = React.useMemo(() => createTauriStore(), [])
  const [deviceName, setDeviceName] = React.useState('')
  const [projects, setProjects] = React.useState<ProjectRecord[]>([])
  const [hasEncryption, setHasEncryption] = React.useState(false)
  const [unlocked, setUnlocked] = React.useState(isUnlocked())
  const [passphrase, setPassphrase] = React.useState('')
  const [recoveryCode, setRecoveryCode] = React.useState<string | null>(null)
  const [recoveryConfirm, setRecoveryConfirm] = React.useState('')
  const [stats, setStats] = React.useState<VaultStats | null>(null)
  const [statsError, setStatsError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [backingUp, setBackingUp] = React.useState(false)
  const [pendingVault, setPendingVault] = React.useState<PendingVaultImport | null>(null)
  const [importError, setImportError] = React.useState('')

  const computeStats = React.useCallback(
    async (rows: ProjectRecord[]): Promise<VaultStats> => {
      let snapshots = 0
      let bytes = 0
      let lastBackup: string | null = null
      for (const project of rows) {
        const found = trackableEnvFiles(
          await listEnvFiles(project.folderPath).catch(() => [] as string[]),
        )
        const names = found.length > 0 ? found : ['.env']
        for (const name of names) {
          const stored = await store.list(project.id, name, 20).catch(() => [])
          snapshots += stored.length
          for (const row of stored) {
            bytes += JSON.stringify(row.envelope).length
            if (lastBackup === null || row.createdAt > lastBackup) lastBackup = row.createdAt
          }
        }
      }
      return { snapshots, bytes, lastBackup }
    },
    [store],
  )

  React.useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    // Device label comes from the OS hostname unless the user overrode it.
    ensureDeviceName()
      .then((name) => {
        if (!cancelled) setDeviceName(name)
      })
      .catch(() => {})
    loadConfig()
      .then((cfg) => {
        if (cancelled) return
        setHasEncryption(cfg.cryptoSalt !== undefined)
        setUnlocked(isUnlocked())
      })
      .catch(() => {})
    ;(async () => {
      try {
        const rows = await vault.listProjects()
        if (cancelled) return
        setProjects(rows)
        try {
          const next = await computeStats(rows)
          if (!cancelled) setStats(next)
        } catch (err) {
          if (!cancelled) setStatsError(err instanceof Error ? err.message : 'Could not read vault stats')
        }
      } catch {
        // The project card below already surfaces an empty list.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [vault, computeStats])

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

  async function saveDeviceName(): Promise<void> {
    try {
      await saveConfig({ deviceName })
      toast('Device name saved.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error')
    }
  }

  async function refreshProjectsAndStats(): Promise<ProjectRecord[]> {
    const rows = await vault.listProjects()
    setProjects(rows)
    try {
      setStats(await computeStats(rows))
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Could not read vault stats')
    }
    return rows
  }

  async function backUpAll(): Promise<void> {
    if (!isUnlocked()) {
      toast('Unlock encryption to back up the vault.', 'error')
      return
    }
    if (projects.length === 0) return
    setBackingUp(true)
    try {
      const ctx: SyncContext = {
        store,
        io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
      }
      const result = await backupAllProjects({
        listProjects: () => vault.listProjects(),
        listEnvFiles,
        backup: async ({ project, fileName, filePath }) => {
          await backupToVault(ctx, {
            projectId: project.id,
            identity: project.identity,
            fileName,
            filePath,
          })
        },
      })
      await refreshProjectsAndStats()
      toast(describeBackupResult(result), result.failed > 0 ? 'error' : 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Back up all failed', 'error')
    } finally {
      setBackingUp(false)
    }
  }

  async function exportVault(): Promise<void> {
    if (!isUnlocked()) {
      toast('Unlock encryption to export the vault.', 'error')
      return
    }
    if (projects.length === 0) return
    setBusy(true)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const path = await pickSaveFile(`env-manager-vault-${stamp}.db`, VAULT_FILTERS)
      if (path === null) return
      const result = await exportVaultFile(path)
      toast(
        `Exported ${result.projects} project${result.projects === 1 ? '' : 's'} and ${result.snapshots} snapshot${result.snapshots === 1 ? '' : 's'} to ${path}.`,
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function pickVaultForImport(): Promise<void> {
    setImportError('')
    setBusy(true)
    try {
      const path = await pickOpenFile(VAULT_FILTERS)
      if (path === null) return
      const next = await readPortableVault(path)
      if (!isUnlocked()) {
        toast('Unlock encryption before importing a vault.', 'error')
        return
      }
      const sameSalt = next.meta.salt === currentSalt()
      setPendingVault({
        path,
        vault: next,
        needsPassphrase: !sameSalt && next.snapshots.length > 0,
        passphrase: '',
        error: '',
      })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Vault import failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmVaultImport(): Promise<void> {
    if (pendingVault === null) return
    if (!isUnlocked()) {
      toast('Unlock encryption before importing a vault.', 'error')
      return
    }
    setBusy(true)
    setImportError('')
    try {
      const local = await vault.listProjects()
      for (const project of pendingVault.vault.projects) {
        if (local.some((row) => row.identity === project.identity)) continue
        const byFolder = local.find(
          (row) => folderKey(row.folderPath) === folderKey(project.folderPath),
        )
        if (byFolder !== undefined) {
          throw new Error(
            `Folder ${project.folderPath} is already linked to ${byFolder.identity}. Unlink that project first, then import.`,
          )
        }
      }

      const payload = await preparePortableImport(pendingVault.vault, {
        passphrase: pendingVault.passphrase,
      })
      const result = await importPortableVault(payload)

      if (isTauri()) {
        const links = await linksRead().catch((): Record<string, string> => ({}))
        for (const project of pendingVault.vault.projects) {
          links[project.folderPath] = project.identity
        }
        await linksWrite(links).catch(() => {})
      }

      setPendingVault(null)
      await refreshProjectsAndStats()
      const parts = [
        `Imported ${result.projectsAdded} new project${result.projectsAdded === 1 ? '' : 's'}`,
        `${result.snapshotsAdded} snapshot${result.snapshotsAdded === 1 ? '' : 's'}`,
      ]
      if (result.projectsKept > 0) parts.push(`${result.projectsKept} already linked`)
      if (result.snapshotsSkipped > 0) parts.push(`${result.snapshotsSkipped} already present`)
      toast(parts.join(' · '))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Vault import failed'
      setPendingVault((previous) => (previous === null ? null : { ...previous, error: message }))
      setImportError(message)
    } finally {
      setBusy(false)
    }
  }

  function cancelVaultImport(): void {
    setPendingVault(null)
    setImportError('')
  }

  async function removeProject(project: ProjectRecord): Promise<void> {
    if (!window.confirm(`Unlink "${project.displayName}"? Your .env files stay on disk.`)) return
    try {
      await vault.removeProject(project.id)
      await refreshProjectsAndStats()
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
          <CardDescription>
            From your OS hostname — override it if you like. Used as the label in vault export
            metadata, not as a sync identity.
          </CardDescription>
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
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Follows your OS theme when set to System. The choice is saved on this device and
            applied before the first paint.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label="Theme">
            {themeOptions.map(({ value, label, icon: Icon }) => {
              const active = preference === value
              return (
                <Button
                  key={value}
                  type="button"
                  variant={active ? 'secondary' : 'outline'}
                  aria-pressed={active}
                  onClick={() => setPreference(value)}
                  className="w-full sm:w-auto"
                >
                  <Icon aria-hidden />
                  {label}
                </Button>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            Currently using the {resolved} theme
            {preference === 'system' ? ' (following your OS).' : '.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Encryption</CardTitle>
          <CardDescription>
            Zero-knowledge: passphrase → Argon2id → master key → portable per-file keys. Your
            passphrase is entered at every launch and never stored — not in a system credential
            store, not on disk.
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
                {unlocked ? 'Unlocked — keys in memory for this session.' : 'Locked.'}
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
          <CardTitle>Vault</CardTitle>
          <CardDescription>
            Local encrypted snapshots only — no account, no server, no network calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="min-w-0 break-all">
            <code>~/.env-manager/vault.db</code>
          </p>
          <p>
            {!isTauri()
              ? 'Vault stats appear in the desktop app.'
              : stats === null
                ? 'Reading vault…'
                : `${stats.snapshots.toLocaleString()} snapshots · ${formatBytes(stats.bytes)}`}
          </p>
          <p>
            Last backup:{' '}
            {!isTauri()
              ? '—'
              : stats?.lastBackup
                ? new Date(stats.lastBackup).toLocaleString()
                : 'none yet'}
          </p>
          <p className="text-muted-foreground">
            Rows hold ciphertext envelopes plus a local plaintext hash used only for conflict
            detection. Passphrases and keys are never stored.
          </p>
          {statsError !== '' && (
            <p role="alert" className="text-destructive">
              {statsError}
            </p>
          )}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="secondary"
              onClick={backUpAll}
              disabled={!isTauri() || !unlocked || projects.length === 0 || busy || backingUp}
              className="w-full sm:w-auto"
            >
              <Archive aria-hidden />
              {backingUp ? 'Backing up…' : 'Back up all now'}
            </Button>
            <p className="text-sm text-muted-foreground">
              {!unlocked
                ? 'Unlock encryption to write snapshots.'
                : projects.length === 0
                  ? 'Add a project first.'
                  : 'Writes an encrypted snapshot for every env file in every project.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vault file</CardTitle>
          <CardDescription>
            One encrypted <code>.db</code> file holds every project and snapshot. Move it by hand —
            USB drive, external disk, anywhere. There is no server in the loop.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={exportVault}
              disabled={!isTauri() || !unlocked || projects.length === 0 || busy}
              className="w-full sm:w-auto"
            >
              Export vault (.db)…
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={pickVaultForImport}
              disabled={!isTauri() || busy}
              className="w-full sm:w-auto"
            >
              Import vault (.db)…
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Project names and folder paths are plaintext metadata; secret values stay encrypted.
            The file never contains plaintext hashes.
          </p>
          {!unlocked && (
            <p className="text-sm text-muted-foreground">
              Unlock encryption to export or import the vault.
            </p>
          )}
          {importError !== '' && pendingVault === null && (
            <p role="alert" className="text-sm text-destructive">
              {importError}
            </p>
          )}
        </CardContent>
      </Card>

      {pendingVault !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Import this vault file?</CardTitle>
            <CardDescription>
              {pendingVault.vault.projects.length} project
              {pendingVault.vault.projects.length === 1 ? '' : 's'} ·{' '}
              {pendingVault.vault.snapshots.length} snapshot
              {pendingVault.vault.snapshots.length === 1 ? '' : 's'} from{' '}
              {pendingVault.vault.meta.deviceName} · exported{' '}
              {new Date(pendingVault.vault.meta.createdAt).toLocaleString()}. Import merges into
              this vault; nothing local is deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pendingVault.needsPassphrase && (
              <Input
                type="password"
                autoComplete="off"
                aria-label="Vault file passphrase"
                placeholder="Passphrase for this vault file"
                value={pendingVault.passphrase}
                onChange={(e) =>
                  setPendingVault((previous) =>
                    previous === null
                      ? null
                      : { ...previous, passphrase: e.target.value, error: '' },
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pendingVault.passphrase !== '') void confirmVaultImport()
                }}
              />
            )}
            {!pendingVault.needsPassphrase && (
              <p className="text-sm text-muted-foreground">
                Encrypted with this vault's passphrase. Snapshots reuse the local key and duplicate
                content is skipped.
              </p>
            )}
            {pendingVault.error !== '' && (
              <p role="alert" className="text-sm text-destructive">
                {pendingVault.error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={confirmVaultImport}
                disabled={busy || (pendingVault.needsPassphrase && pendingVault.passphrase === '')}
              >
                {busy ? 'Importing…' : 'Import vault'}
              </Button>
              <Button type="button" variant="outline" onClick={cancelVaultImport} disabled={busy}>
                Cancel
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              New projects keep the folder paths saved in the file. Projects already linked keep
              their local path. If a path does not exist on this device, move the project there
              before restoring.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Projects / Remove</CardTitle>
          <CardDescription>
            Remove unlinks the app from a project. Your <code>.env</code> files stay intact on
            disk, and nothing is written into your repos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {projects.map((project) => (
            <div key={project.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3">
              <Link
                to={`/project/${encodeURIComponent(project.id)}`}
                className="mr-auto min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                title={project.folderPath}
              >
                {project.displayName}
              </Link>
              <Button type="button" variant="outline" onClick={() => removeProject(project)}>
                Remove
              </Button>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">No projects linked yet.</p>
          )}
          {!isTauri() && (
            <p className="text-sm text-muted-foreground">
              Open the desktop app (<code>pnpm tauri dev</code>) to manage projects.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
