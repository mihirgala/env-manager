import { Check, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { isUnlocked } from '@/lib/crypto'
import { effectiveValue, getValue, parse, serialize, setValue, type DotenvDocument } from '@/lib/dotenv'
import { isTrackableEnvFile, trackableEnvFiles } from '@/lib/env-files'
import { joinPath } from '@/lib/paths'
import { createTauriStore } from '@/lib/store'
import {
  applyImportedText,
  applyRestore,
  backupToVault,
  fileNameOf,
  planRestore,
  previewDiff,
  projectStatus,
  type DiffPreview,
  type FileTarget,
  type RestorePlan,
  type SyncContext,
  type VaultStatus,
} from '@/lib/sync'
import {
  backupEnvFile,
  fileStat,
  isTauri,
  listEnvFiles,
  pickOpenFile,
  pickSaveFile,
  readEnvFile,
  writeEnvFile,
} from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import { cn } from '@/lib/utils'

const statusVariant: Record<VaultStatus, 'success' | 'warning' | 'outline'> = {
  'backed-up': 'success',
  changed: 'warning',
  'not-backed-up': 'outline',
  locked: 'outline',
}

const statusLabel: Record<VaultStatus, string> = {
  'backed-up': 'backed up',
  changed: 'changed',
  'not-backed-up': 'not backed up',
  locked: 'locked',
}

function cleanDiff(diff: DiffPreview): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}

function safeFileName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim()
  return safe === '' ? 'project' : safe
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function DiffSummary({ diff }: { diff: DiffPreview }): React.JSX.Element {
  if (cleanDiff(diff)) {
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        No key changes.
      </p>
    )
  }
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <ul className="flex flex-col gap-1">
        {diff.added.map((key) => (
          <li key={`added-${key}`} className="break-words">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">+</span>{' '}
            <code>{key}</code> <span className="text-muted-foreground">added</span>
          </li>
        ))}
        {diff.changed.map((key) => (
          <li key={`changed-${key}`} className="break-words">
            <span className="font-medium text-amber-700 dark:text-amber-400">~</span>{' '}
            <code>{key}</code> <span className="text-muted-foreground">changed</span>
          </li>
        ))}
        {diff.removed.map((key) => (
          <li key={`removed-${key}`} className="break-words">
            <span className="font-medium text-destructive">-</span> <code>{key}</code>{' '}
            <span className="text-muted-foreground">removed</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface ImportPreviewState {
  label: string
  files: Record<string, string>
  diffs: Record<string, DiffPreview>
}

function targetFor(project: ProjectRecord, fileName: string): FileTarget {
  return {
    projectId: project.id,
    identity: project.identity,
    filePath: joinPath(project.folderPath, fileName),
    fileName,
  }
}

export function ProjectDetailScreen(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const vault = React.useMemo(() => new Vault(createTauriDriver()), [])
  const sync = React.useMemo<SyncContext>(
    () => ({
      store: createTauriStore(),
      io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
    }),
    [],
  )

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
  const [actionBusy, setActionBusy] = React.useState(false)
  const [status, setStatus] = React.useState<VaultStatus>('locked')
  const [restorePlan, setRestorePlan] = React.useState<RestorePlan | null>(null)
  const [importPreview, setImportPreview] = React.useState<ImportPreviewState | null>(null)
  const [importSelected, setImportSelected] = React.useState<Set<string>>(new Set())

  const unlocked = isUnlocked()

  const loadFile = React.useCallback(
    async (p: ProjectRecord, fileName: string) => {
      const content = await readEnvFile(joinPath(p.folderPath, fileName))
      setDoc(parse(content))
      setSavedText(content)
      setDiskText(content)
      setChangedOnDisk(false)
    },
    [],
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
        const trackable = trackableEnvFiles(found)
        const list = trackable.length > 0 ? trackable : ['.env']
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

  // Vault status for the selected file.
  React.useEffect(() => {
    if (project === null) return
    let cancelled = false
    projectStatus(sync, targetFor(project, file))
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project, file, sync, unlocked])

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

  // Escape closes whichever preview card is open.
  React.useEffect(() => {
    if (restorePlan === null && importPreview === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setRestorePlan(null)
        setImportPreview(null)
        setImportSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restorePlan, importPreview])

  if (!isTauri()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Project</h1>
        <Card>
          <CardHeader>
            <CardTitle>Desktop app required</CardTitle>
            <CardDescription>
              The editor reads real <code>.env</code> files via Tauri. Run{' '}
              <code>pnpm tauri dev</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const currentText = doc !== null ? serialize(doc) : ''
  const dirty = doc !== null && currentText !== savedText
  const pairs = doc !== null ? doc.entries.filter((e) => e.type === 'pair') : []

  async function refreshStatus(): Promise<void> {
    if (project === null) return
    try {
      setStatus(await projectStatus(sync, targetFor(project, file)))
    } catch {
      // Keep the last known status; the action itself already surfaced errors.
    }
  }

  async function handleSave(): Promise<void> {
    if (project === null || doc === null) return
    setSaving(true)
    setError('')
    try {
      const text = serialize(doc)
      const path = joinPath(project.folderPath, file)
      await writeEnvFile(path, text)
      setSavedText(text)
      setDiskText(text)
      setChangedOnDisk(false)
      // Never block the disk write on crypto: save first, then back up.
      if (!isUnlocked()) {
        setStatus('locked')
        toast('Saved — unlock to back up.')
        return
      }
      try {
        await backupToVault(sync, targetFor(project, file))
        setStatus('backed-up')
        toast('Saved and backed up.')
      } catch (err) {
        await refreshStatus()
        toast(`Saved — backup failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
      }
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
      await refreshStatus()
      toast('Reloaded from disk.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reload failed')
    }
  }

  async function handleBackup(): Promise<void> {
    if (project === null) return
    if (!isUnlocked()) {
      toast('Unlock encryption to back up to the vault.', 'error')
      return
    }
    setActionBusy(true)
    try {
      await backupToVault(sync, targetFor(project, file))
      setStatus('backed-up')
      toast('Encrypted snapshot saved to the vault.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backup failed', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  async function handlePlanRestore(): Promise<void> {
    if (project === null) return
    if (!isUnlocked()) {
      toast('Unlock encryption to restore from the vault.', 'error')
      return
    }
    setActionBusy(true)
    setImportPreview(null)
    try {
      const plan = await planRestore(sync, targetFor(project, file))
      if (plan === null) {
        toast('No encrypted snapshot for this file yet — back it up first.', 'error')
        return
      }
      setRestorePlan(plan)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read snapshot', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleApplyRestore(): Promise<void> {
    if (project === null || restorePlan === null) return
    setActionBusy(true)
    try {
      const applied = await applyRestore(sync, targetFor(project, file))
      await loadFile(project, file)
      setRestorePlan(null)
      setStatus('backed-up')
      toast(
        applied.backupPath !== null
          ? `Restored from the vault. Previous file saved as ${applied.backupPath}.`
          : 'Restored from the vault.',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleExportPlaintext(): Promise<void> {
    if (project === null) return
    try {
      const path = await pickSaveFile(
        `${safeFileName(project.displayName)}.${file}.plaintext.env`,
        [{ name: 'Plaintext env file', extensions: ['env', 'txt'] }],
      )
      if (path === null) return
      await writeEnvFile(path, currentText)
      toast('Plaintext export written — this file is NOT encrypted.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Plaintext export failed', 'error')
    }
  }

  async function openImportPreview(input: {
    label: string
    files: Record<string, string>
  }): Promise<void> {
    if (project === null) return
    const diffs: Record<string, DiffPreview> = {}
    const selected = new Set<string>()
    for (const [fileName, text] of Object.entries(input.files)) {
      const local = await readEnvFile(joinPath(project.folderPath, fileName)).catch(() => '')
      const diff = previewDiff(local, text)
      diffs[fileName] = diff
      if (!cleanDiff(diff)) selected.add(fileName)
    }
    setRestorePlan(null)
    setImportPreview({ ...input, diffs })
    setImportSelected(selected)
  }

  async function handleImportPlaintext(): Promise<void> {
    if (project === null) return
    if (!isUnlocked()) {
      toast('Unlock encryption to import a plaintext file.', 'error')
      return
    }
    setActionBusy(true)
    setError('')
    setRestorePlan(null)
    try {
      const path = await pickOpenFile([])
      if (path === null) return
      const fileName = fileNameOf(path)
      if (!isTrackableEnvFile(fileName)) {
        throw new Error('Only .env files can be imported (templates and backups are ignored).')
      }
      const text = await readEnvFile(path)
      await openImportPreview({ label: fileName, files: { [fileName]: text } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plaintext import failed')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleApplyImport(): Promise<void> {
    if (project === null || importPreview === null) return
    const names = [...importSelected].filter((name) => importPreview.files[name] !== undefined)
    if (names.length === 0) return
    if (dirty && !window.confirm('Importing reloads the current file and discards unsaved edits. Continue?')) {
      return
    }
    setActionBusy(true)
    const failed: string[] = []
    let applied = 0
    for (const fileName of names) {
      const text = importPreview.files[fileName]
      if (text === undefined) continue
      try {
        await applyImportedText(sync, { ...targetFor(project, fileName), text })
        applied += 1
      } catch {
        failed.push(fileName)
      }
    }
    try {
      const found = trackableEnvFiles(await listEnvFiles(project.folderPath))
      const nextFiles = found.length > 0 ? found : files
      const view = nextFiles.includes(names[0] ?? '') ? (names[0] as string) : (nextFiles[0] ?? file)
      setFiles(nextFiles)
      setFile(view)
      await loadFile(project, view)
      setStatus(await projectStatus(sync, targetFor(project, view)))
    } catch {
      // The files that were written are still valid; keep the editor usable.
    }
    setImportPreview(null)
    setImportSelected(new Set())
    setActionBusy(false)
    const prefix = applied > 0 ? `Applied ${applied} file${applied === 1 ? '' : 's'}` : 'No files applied'
    toast(
      failed.length > 0 ? `${prefix} · ${failed.length} failed` : `${prefix} — originals backed up.`,
      failed.length > 0 ? 'error' : 'info',
    )
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

  const cryptoDisabled = !unlocked || actionBusy

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto min-w-0 truncate text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">
          {project?.displayName ?? 'Project'}
        </h1>
        <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
        {dirty && <Badge variant="warning">unsaved changes</Badge>}
        {changedOnDisk && <Badge variant="destructive">changed on disk</Badge>}
      </div>

      {project !== null && (
        <p className="min-w-0 truncate text-sm text-muted-foreground" title={project.folderPath}>
          <code>{project.identity}</code> · {project.folderPath}
        </p>
      )}

      {error !== '' && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!unlocked && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Locked — editing and saving still work. Unlock encryption to back up, restore, or import
          with a snapshot.
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
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Env files">
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
                'inline-flex min-h-[44px] shrink-0 items-center rounded-md px-3 text-sm font-medium',
                f === file ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {restorePlan !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Restore the latest snapshot?</CardTitle>
            <CardDescription>
              Snapshot from {new Date(restorePlan.snapshotAt).toLocaleString()} · source{' '}
              {restorePlan.source}
              {restorePlan.conflict ? ' · local edits differ from the snapshot' : ''}. The current
              file is backed up to <code>.env.backup-&lt;ts&gt;</code> before anything is written.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DiffSummary diff={restorePlan.diff} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleApplyRestore} disabled={actionBusy}>
                {actionBusy ? 'Applying…' : 'Backup + apply'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRestorePlan(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {importPreview !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Import {importPreview.label}</CardTitle>
            <CardDescription>
              Plaintext file. The target is backed up to .env.backup-&lt;ts&gt; before writing and
              recorded as an import snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {Object.keys(importPreview.files)
                .sort()
                .map((fileName) => {
                  const diff = importPreview.diffs[fileName] ?? { added: [], removed: [], changed: [] }
                  const clean = cleanDiff(diff)
                  return (
                    <li key={fileName} className="rounded-md border p-3">
                      <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={importSelected.has(fileName)}
                          disabled={clean || actionBusy}
                          onChange={() =>
                            setImportSelected((previous) => {
                              const next = new Set(previous)
                              if (next.has(fileName)) next.delete(fileName)
                              else next.add(fileName)
                              return next
                            })
                          }
                        />
                        <code className="min-w-0 break-words">{fileName}</code>
                        {clean && <Badge variant="outline">no changes</Badge>}
                      </label>
                      <div className="mt-2">
                        <DiffSummary diff={diff} />
                      </div>
                    </li>
                  )
                })}
            </ul>
            {dirty && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                The current editor has unsaved edits. Applying the import reloads from disk.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleApplyImport}
                disabled={actionBusy || importSelected.size === 0}
              >
                {actionBusy
                  ? 'Applying…'
                  : `Backup + apply ${importSelected.size} file${importSelected.size === 1 ? '' : 's'}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setImportPreview(null)
                  setImportSelected(new Set())
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
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
        <Button type="button" onClick={handleSave} disabled={!dirty || saving || actionBusy}>
          <Check aria-hidden /> {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={handleBackup} disabled={cryptoDisabled}>
          Back up now
        </Button>
        <Button type="button" variant="outline" onClick={handlePlanRestore} disabled={cryptoDisabled}>
          Restore…
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleExportPlaintext}
          disabled={actionBusy}
          className="border-amber-500/60 text-amber-700 dark:text-amber-400"
        >
          Export plaintext…
        </Button>
        <Button type="button" variant="outline" onClick={handleImportPlaintext} disabled={cryptoDisabled}>
          Import plaintext…
        </Button>
        <Button type="button" variant="destructive" onClick={handleRemove} className="sm:ml-auto">
          <Trash2 aria-hidden /> Unlink
        </Button>
      </div>
    </div>
  )
}
