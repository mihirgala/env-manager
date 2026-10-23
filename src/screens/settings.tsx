import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { buildBundle, parseBundle, serializeBundle, type Bundle } from '@/lib/bundle'
import { trackableEnvFiles } from '@/lib/env-files'
import { folderKey, joinPath } from '@/lib/paths'
import { createTauriStore } from '@/lib/store'
import {
  isTauri,
  linksRead,
  linksWrite,
  listEnvFiles,
  pickOpenFile,
  pickProjectFolder,
  readEnvFile,
  writeEnvFile,
  type DialogFilter,
} from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import {
  generateRecoveryKey,
  isUnlocked,
  lock,
  setupPassphrase,
} from '@/lib/crypto'
import { ensureDeviceName, loadConfig, saveConfig } from '@/lib/config'

const BUNDLE_FILTERS: DialogFilter[] = [{ name: 'env-manager bundle', extensions: ['envmgr'] }]

interface VaultStats {
  snapshots: number
  bytes: number
  lastBackup: string | null
}

interface PendingImport {
  bundle: Bundle
  path: string
}

function safeName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim()
  return safe === '' ? 'project' : safe.slice(0, 80)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SettingsScreen(): React.JSX.Element {
  const toast = useToast()
  const navigate = useNavigate()
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
  const [pendingImport, setPendingImport] = React.useState<PendingImport | null>(null)
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

  async function exportAllBundles(): Promise<void> {
    if (!isUnlocked()) {
      toast('Unlock encryption to export encrypted bundles.', 'error')
      return
    }
    if (projects.length === 0) return
    setBusy(true)
    try {
      const directory = await pickProjectFolder()
      if (directory === null) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      let exported = 0
      let skipped = 0
      let failed = 0
      for (const project of projects) {
        const names = trackableEnvFiles(
          await listEnvFiles(project.folderPath).catch(() => [] as string[]),
        )
        if (names.length === 0) {
          skipped += 1
          continue
        }
        const contents: Record<string, string> = {}
        for (const name of names) {
          try {
            contents[name] = await readEnvFile(joinPath(project.folderPath, name))
          } catch {
            // Missing/unreadable files are skipped; the rest still export.
          }
        }
        if (Object.keys(contents).length === 0) {
          skipped += 1
          continue
        }
        try {
          const bundle = await buildBundle({
            identity: project.identity,
            displayName: project.displayName,
            files: contents,
          })
          const name = `${safeName(project.displayName)}-${safeName(project.identity)}-${stamp}.envmgr`
          await writeEnvFile(joinPath(directory, name), serializeBundle(bundle))
          exported += 1
        } catch {
          failed += 1
        }
      }
      const parts = [`Exported ${exported} bundle${exported === 1 ? '' : 's'}`]
      if (skipped > 0) parts.push(`skipped ${skipped}`)
      if (failed > 0) parts.push(`failed ${failed}`)
      toast(parts.join(' · '), failed > 0 ? 'error' : 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function pickBundleForImport(): Promise<void> {
    setImportError('')
    setBusy(true)
    try {
      const path = await pickOpenFile(BUNDLE_FILTERS)
      if (path === null) return
      const bundle = parseBundle(await readEnvFile(path))
      const rows = await vault.listProjects()
      setProjects(rows)
      const match = rows.find((project) => project.identity === bundle.project.identity)
      if (match !== undefined) {
        navigate(`/project/${encodeURIComponent(match.id)}`, { state: { bundlePath: path } })
        return
      }
      setPendingImport({ bundle, path })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Bundle import failed')
    } finally {
      setBusy(false)
    }
  }

  async function addProjectForBundle(): Promise<void> {
    if (pendingImport === null) return
    setImportError('')
    setBusy(true)
    try {
      const folder = await pickProjectFolder()
      if (folder === null) return
      const rows = await vault.listProjects()
      const byFolder = rows.find((project) => folderKey(project.folderPath) === folderKey(folder))
      if (byFolder !== undefined && byFolder.identity !== pendingImport.bundle.project.identity) {
        throw new Error(
          `That folder is already linked to ${byFolder.identity}. Unlink it first, or choose another folder.`,
        )
      }
      const existing =
        byFolder ??
        rows.find((project) => project.identity === pendingImport.bundle.project.identity) ??
        (await vault.addProject({
          identity: pendingImport.bundle.project.identity,
          displayName: pendingImport.bundle.project.displayName,
          folderPath: folder,
        }))
      if (isTauri()) {
        const links = await linksRead().catch((): Record<string, string> => ({}))
        links[existing.folderPath] = existing.identity
        await linksWrite(links).catch(() => {})
      }
      const path = pendingImport.path
      setPendingImport(null)
      await refreshProjectsAndStats()
      navigate(`/project/${encodeURIComponent(existing.id)}`, { state: { bundlePath: path } })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not add the project')
    } finally {
      setBusy(false)
    }
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
            From your OS hostname — override it if you like. Used as the label in encrypted bundle
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
          <CardTitle>Encryption</CardTitle>
          <CardDescription>
            Zero-knowledge: passphrase → Argon2id → master key → per-project keys. Your passphrase
            is entered at every launch and never stored — not in the OS keychain, not on disk.
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
            {stats === null ? 'Reading vault…' : `${stats.snapshots.toLocaleString()} snapshots · ${formatBytes(stats.bytes)}`}
          </p>
          <p>
            Last backup:{' '}
            {stats?.lastBackup ? new Date(stats.lastBackup).toLocaleString() : 'none yet'}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import / export</CardTitle>
          <CardDescription>
            Move encrypted <code>.envmgr</code> bundles by hand — USB drive, external disk,
            anywhere. There is no server in the loop.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={exportAllBundles}
              disabled={!isTauri() || !unlocked || projects.length === 0 || busy}
              className="w-full sm:w-auto"
            >
              Export all bundles…
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={pickBundleForImport}
              disabled={!isTauri() || busy}
              className="w-full sm:w-auto"
            >
              Import bundle…
            </Button>
          </div>
          {!unlocked && (
            <p className="text-sm text-muted-foreground">
              Unlock encryption to export bundles. Importing an encrypted bundle routes to its
              project, where you can enter the bundle passphrase.
            </p>
          )}
          {importError !== '' && pendingImport === null && (
            <p role="alert" className="text-sm text-destructive">
              {importError}
            </p>
          )}
        </CardContent>
      </Card>

      {pendingImport !== null && (
        <Card>
          <CardHeader>
            <CardTitle>No matching project</CardTitle>
            <CardDescription>
              This bundle is for <code>{pendingImport.bundle.project.identity}</code>. Choose the
              folder for this project on this device, then import it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={addProjectForBundle} disabled={busy}>
                {busy ? 'Adding…' : 'Choose folder & add'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPendingImport(null)
                  setImportError('')
                }}
              >
                Cancel
              </Button>
            </div>
            {importError !== '' && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
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
