import { Check, Copy, Eye, EyeOff, Plus, Trash2, CloudUpload, CloudDownload } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { effectiveValue, getValue, parse, serialize, setValue, type DotenvDocument } from '@/lib/dotenv'
import { sha256Hex } from '@/lib/hash'
import { isTauri, backupEnvFile, fileStat, listEnvFiles, readEnvFile, writeEnvFile } from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import { isUnlocked } from '@/lib/crypto'
import { isCloudConfigured, lastSyncedKey, loadConfig, makeCloudClient, saveConfig } from '@/lib/cloud-config'
import {
  applyPull,
  planPull,
  projectStatus,
  pushProject,
  type PullPlan,
  type SyncContext,
  type SyncStatus,
} from '@/lib/sync'
import { cn } from '@/lib/utils'

function joinPath(folder: string, file: string): string {
  const sep = folder.includes('/') ? '/' : '\\'
  return `${folder.replace(/[\\/]+$/, '')}${sep}${file}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ProjectDetailScreen(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const vault = React.useMemo(() => new Vault(createTauriDriver()), [])

  const [project, setProject] = React.useState<ProjectRecord | null>(null)
  const [files, setFiles] = React.useState<string[]>([])
  const [file, setFile] = React.useState('.env')
  const [doc, setDoc] = React.useState<DotenvDocument | null>(null)
  const [savedText, setSavedText] = React.useState('')
  const [diskText, setDiskText] = React.useState<string | null>(null)
  const [changedOnDisk, setChangedOnDisk] = React.useState(false)
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({})
  const [newKey, setNewKey] = React.useState('')
  const [newValue, setNewValue] = React.useState('')
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus | null>(null)
  const [syncBusy, setSyncBusy] = React.useState(false)
  const [pullPlan, setPullPlan] = React.useState<PullPlan | null>(null)

  const loadFile = React.useCallback(
    async (p: ProjectRecord, fileName: string) => {
      const content = await readEnvFile(joinPath(p.folderPath, fileName))
      setDoc(parse(content))
      setSavedText(content)
      setDiskText(content)
      setChangedOnDisk(false)
      await vault.recordEnvSet(p.id, fileName, await sha256Hex(content))
    },
    [vault],
  )

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (id === undefined) throw new Error('Missing project id')
        const p = await vault.getProject(decodeURIComponent(id))
        if (cancelled) return
        if (p === null) {
          setError('Project not found in the vault.')
          return
        }
        setProject(p)
        const found = await listEnvFiles(p.folderPath).catch(() => ['.env'] as string[])
        if (cancelled) return
        const list = found.length > 0 ? found : ['.env']
        setFiles(list)
        setFile(list[0] ?? '.env')
        await loadFile(p, list[0] ?? '.env').catch((err: unknown) => {
          // Folder may not have a .env yet — start from an empty document.
          if (!cancelled) {
            setDoc(parse(''))
            setSavedText('')
            setDiskText(null)
            setError(err instanceof Error ? err.message : 'Could not read .env file')
          }
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load project')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, vault, loadFile])

  // Watcher poll: compare mtime/size; flag when the file changed outside the app.
  React.useEffect(() => {
    if (project === null || diskText === null) return
    let cancelled = false
    const path = joinPath(project.folderPath, file)
    const tick = async (): Promise<void> => {
      try {
        const st = await fileStat(path)
        if (cancelled || st === null) return
        const content = await readEnvFile(path)
        if (!cancelled && content !== diskText) {
          setDiskText(content)
          setChangedOnDisk(true)
        }
      } catch {
        // Best effort — the toast/error surface stays for explicit actions.
      }
    }
    const timer = window.setInterval(tick, 2500)
    window.addEventListener('focus', tick)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [project, file, diskText])

  if (!isTauri()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Project</h1>
        <Card>
          <CardHeader>
            <CardTitle>Desktop app required</CardTitle>
            <CardDescription>
              The editor reads real <code>.env</code> files via Tauri. Run{' '}
              <code>npm run tauri dev</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const currentText = doc !== null ? serialize(doc) : ''
  const dirty = doc !== null && currentText !== savedText
  const pairs = doc !== null ? doc.entries.filter((e) => e.type === 'pair') : []

  async function handleSave(): Promise<void> {
    if (project === null || doc === null) return
    setSaving(true)
    setError('')
    try {
      const text = serialize(doc)
      await writeEnvFile(joinPath(project.folderPath, file), text)
      setSavedText(text)
      setDiskText(text)
      setChangedOnDisk(false)
      await vault.recordEnvSet(project.id, file, await sha256Hex(text))
      toast('Saved — file on disk updated losslessly.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleReload(): Promise<void> {
    if (project === null) return
    try {
      await loadFile(project, file)
      toast('Reloaded from disk.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reload failed')
    }
  }

  async function handleBackup(): Promise<void> {
    if (project === null) return
    try {
      const backup = await backupEnvFile(joinPath(project.folderPath, file))
      toast(`Backup written: ${backup}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backup failed', 'error')
    }
  }

  async function handleToggleLocalOnly(): Promise<void> {
    if (project === null) return
    try {
      const updated = await vault.setLocalOnly(project.id, !project.localOnly)
      if (updated !== null) setProject(updated)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Toggle failed', 'error')
    }
  }

  async function handleRemove(): Promise<void> {
    if (project === null) return
    if (!window.confirm(`Unlink "${project.displayName}"? Your .env files stay on disk.`)) return
    try {
      await vault.removeProject(project.id)
      toast('Project unlinked — .env files left intact.')
      navigate('/')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Remove failed', 'error')
    }
  }

  function downloadExport(): void {
    const blob = new Blob([currentText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.displayName ?? 'project'}.${file}.export`
    a.click()
    URL.revokeObjectURL(url)
    toast('Export downloaded.')
  }

  async function syncContext(): Promise<SyncContext | null> {
    if (project === null) return null
    const cfg = await loadConfig()
    if (!isCloudConfigured(cfg)) {
      toast('Cloud not configured — add Supabase URL + key in Settings.', 'error')
      return null
    }
    if (!isUnlocked()) {
      toast('Locked — unlock first.', 'error')
      return null
    }
    const key = lastSyncedKey(project.id, file)
    return {
      cloud: makeCloudClient(cfg),
      io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
      lastSyncedSha: cfg.lastSynced?.[key] ?? null,
    }
  }

  async function refreshStatus(): Promise<void> {
    if (project === null) return
    try {
      const cfg = await loadConfig()
      if (!isCloudConfigured(cfg) || !isUnlocked() || project.localOnly) {
        setSyncStatus(project.localOnly ? 'local-only' : dirty ? 'diverged' : 'clean')
        return
      }
      const ctx = await syncContext()
      if (ctx === null) return
      setSyncStatus(
        await projectStatus(ctx, {
          identity: project.identity,
          filePath: joinPath(project.folderPath, file),
          localOnly: false,
        }),
      )
    } catch {
      // Status is advisory; explicit actions surface errors.
    }
  }

  async function handlePush(): Promise<void> {
    if (project === null) return
    setSyncBusy(true)
    try {
      const ctx = await syncContext()
      if (ctx === null) return
      const cfg = await loadConfig()
      const { sha256 } = await pushProject(ctx, {
        identity: project.identity,
        displayName: project.displayName,
        projectId: project.id,
        filePath: joinPath(project.folderPath, file),
        deviceName: (cfg.deviceName as string | undefined) ?? 'unknown-device',
      })
      const seen = [...(cfg.devices ?? [])]
      const deviceName = (cfg.deviceName as string | undefined) ?? 'unknown-device'
      const at = new Date().toISOString()
      const i = seen.findIndex((d) => d.name === deviceName)
      if (i === -1) seen.push({ name: deviceName, lastSeen: at })
      else seen[i] = { name: deviceName, lastSeen: at }
      await saveConfig({ lastSynced: { ...(cfg.lastSynced ?? {}), [lastSyncedKey(project.id, file)]: sha256 }, devices: seen })
      setPullPlan(null)
      await refreshStatus()
      toast('Pushed — server saw ciphertext only.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Push failed', 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  async function handlePlanPull(): Promise<void> {
    if (project === null) return
    setSyncBusy(true)
    try {
      const ctx = await syncContext()
      if (ctx === null) return
      const plan = await planPull(ctx, {
        identity: project.identity,
        projectId: project.id,
        filePath: joinPath(project.folderPath, file),
      })
      if (plan === null) {
        toast('No cloud snapshot for this project yet — push first.')
        return
      }
      setPullPlan(plan)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Pull failed', 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleApplyPull(): Promise<void> {
    if (project === null || pullPlan === null) return
    setSyncBusy(true)
    try {
      const ctx = await syncContext()
      if (ctx === null) return
      const { backupPath, sha256 } = await applyPull(ctx, {
        identity: project.identity,
        projectId: project.id,
        filePath: joinPath(project.folderPath, file),
      })
      const cfg = await loadConfig()
      await saveConfig({ lastSynced: { ...(cfg.lastSynced ?? {}), [lastSyncedKey(project.id, file)]: sha256 } })
      await loadFile(project, file)
      setPullPlan(null)
      await refreshStatus()
      toast(backupPath !== null ? `Pulled. Local backup: ${backupPath}` : 'Pulled.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  React.useEffect(() => {
    if (project !== null && doc !== null) void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, file, savedText])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto min-w-0 truncate text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">
          {project?.displayName ?? 'Project'}
        </h1>
        {project?.localOnly === true && <Badge variant="secondary">local-only</Badge>}
        {syncStatus !== null && syncStatus !== 'local-only' && (
          <Badge variant={syncStatus === 'clean' ? 'success' : syncStatus === 'diverged' ? 'destructive' : 'warning'}>
            {syncStatus}
          </Badge>
        )}
        {dirty && <Badge variant="warning">unsaved changes</Badge>}
        {changedOnDisk && <Badge variant="destructive">changed on disk</Badge>}
      </div>

      {project !== null && (
        <p className="min-w-0 truncate text-sm text-muted-foreground">
          <code>{project.identity}</code> · {project.folderPath}
        </p>
      )}

      {error !== '' && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {changedOnDisk && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 pt-4">
            <p className="mr-auto text-sm">
              This file changed outside the app. Reloading discards your unsaved edits.
            </p>
            <Button type="button" variant="secondary" onClick={handleReload}>
              Reload from disk
            </Button>
          </CardContent>
        </Card>
      )}

      {files.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Env files">
          {files.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={f === file}
              type="button"
              onClick={() => {
                if (project !== null) {
                  setFile(f)
                  loadFile(project, f).catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : 'Could not read file'),
                  )
                }
              }}
              className={cn(
                'inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium',
                f === file ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{file}</CardTitle>
          <CardDescription>
            Only values change on save — comments, order, quoting and blank lines are preserved.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {pairs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No key/value pairs yet. Add one below, or edit the file externally and reload.
            </p>
          )}
          {pairs.map((e) => {
            if (e.type !== 'pair') return null
            const shown = revealed[e.key] === true
            const val = getValue({ entries: [e] }, e.key) ?? ''
            return (
              <div key={e.key} className="flex min-w-0 flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-2">
                <code className="min-w-0 shrink-0 truncate text-sm font-medium sm:w-48">{e.key}</code>
                <Input
                  type={shown ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Value for ${e.key}`}
                  value={effectiveValue(e)}
                  onChange={(ev) => {
                    if (doc === null) return
                    const next = doc.entries.map((x) =>
                      x.type === 'pair' && x.key === e.key
                        ? { ...x, value: x.quote !== null ? `${x.quote}${ev.target.value}${x.quote}` : ev.target.value }
                        : x,
                    )
                    setDoc({ entries: next })
                  }}
                  className="min-w-0 flex-1 font-mono"
                />
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={shown ? `Hide ${e.key}` : `Reveal ${e.key}`}
                    aria-label={shown ? `Hide ${e.key}` : `Reveal ${e.key}`}
                    onClick={() => setRevealed((r) => ({ ...r, [e.key]: !shown }))}
                  >
                    {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={`Copy ${e.key}`}
                    aria-label={`Copy value of ${e.key}`}
                    onClick={() => {
                      copyText(val).then((ok) => toast(ok ? 'Copied.' : 'Copy failed — reveal the value first.', ok ? 'info' : 'error'))
                    }}
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              </div>
            )
          })}

          <div className="mt-2 flex min-w-0 flex-col gap-2 rounded-md border border-dashed p-3 sm:flex-row">
            <Input
              aria-label="New key"
              placeholder="NEW_KEY"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              className="min-w-0 font-mono sm:w-48 sm:shrink-0"
            />
            <Input
              aria-label="New value"
              placeholder="value"
              autoComplete="off"
              spellCheck={false}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={newKey.trim() === '' || doc === null}
              onClick={() => {
                if (doc === null) return
                setDoc(setValue(doc, newKey.trim(), newValue))
                setNewKey('')
                setNewValue('')
              }}
            >
              <Plus aria-hidden /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSave} disabled={!dirty || saving}>
          <Check aria-hidden /> {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={handlePush} disabled={syncBusy || project?.localOnly === true}>
          <CloudUpload aria-hidden /> Push
        </Button>
        <Button type="button" variant="secondary" onClick={handlePlanPull} disabled={syncBusy || project?.localOnly === true}>
          <CloudDownload aria-hidden /> Pull…
        </Button>
        <Button type="button" variant="outline" onClick={handleBackup}>
          Backup now
        </Button>
        <Button type="button" variant="outline" onClick={downloadExport}>
          Export
        </Button>
        <Button type="button" variant="outline" onClick={handleToggleLocalOnly}>
          {project?.localOnly === true ? 'Allow cloud' : 'Mark local-only'}
        </Button>
        <Button type="button" variant="destructive" onClick={handleRemove}>
          <Trash2 aria-hidden /> Unlink
        </Button>
      </div>

      {pullPlan !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Pull preview</CardTitle>
            <CardDescription>
              {pullPlan.conflict
                ? 'Conflict: you have local edits the cloud does not know about. Applying backs up your file first — never a silent overwrite.'
                : 'Changes from the cloud. Applying backs up your file first.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {pullPlan.diff.added.length === 0 &&
              pullPlan.diff.removed.length === 0 &&
              pullPlan.diff.changed.length === 0 && <p>Already in sync — nothing to apply.</p>}
            {pullPlan.diff.added.length > 0 && (
              <p>
                <Badge variant="success">added</Badge>{' '}
                {pullPlan.diff.added.map((k) => (
                  <code key={k} className="mr-1">{k}</code>
                ))}
              </p>
            )}
            {pullPlan.diff.changed.length > 0 && (
              <p>
                <Badge variant="warning">changed</Badge>{' '}
                {pullPlan.diff.changed.map((k) => (
                  <code key={k} className="mr-1">{k}</code>
                ))}
              </p>
            )}
            {pullPlan.diff.removed.length > 0 && (
              <p>
                <Badge variant="destructive">removed</Badge>{' '}
                {pullPlan.diff.removed.map((k) => (
                  <code key={k} className="mr-1">{k}</code>
                ))}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleApplyPull} disabled={syncBusy}>
                {syncBusy ? 'Applying…' : 'Backup + apply'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPullPlan(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
