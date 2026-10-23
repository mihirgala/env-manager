import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { isUnlocked } from '@/lib/crypto'
import { detectIdentity, normalizeGitRemote, type ProjectIdentity } from '@/lib/identity'
import { DEFAULT_SKIP_DIRS, buildScanCandidates, type ScanCandidate } from '@/lib/scan'
import { createTauriStore } from '@/lib/store'
import { backupToVault, type SyncContext } from '@/lib/sync'
import {
  backupEnvFile,
  cancelScan,
  getGitRemote,
  isTauri,
  linksRead,
  linksWrite,
  listenScanProgress,
  pickProjectFolder,
  readEnvFile,
  scanEnvProjects,
  writeEnvFile,
  type ScanProgress,
} from '@/lib/tauri'
import { cn } from '@/lib/utils'
import { Vault, createMemoryDriver, createTauriDriver } from '@/lib/vault'
import * as React from 'react'

function joinPath(folder: string, file: string): string {
  const sep = folder.includes('/') ? '/' : '\\'
  return `${folder.replace(/[\\/]+$/, '')}${sep}${file}`
}

function isDuplicate(candidate: ScanCandidate): boolean {
  return candidate.duplicateOf !== undefined || candidate.duplicateInScan === true
}

export function AddProjectScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab: 'folder' | 'scan' = params.get('tab') === 'scan' ? 'scan' : 'folder'

  // --- Add one folder -----------------------------------------------------
  const [folder, setFolder] = useState<string>('')
  const [remote, setRemote] = useState<string>('')
  const [result, setResult] = useState<ProjectIdentity | null>(null)
  const [error, setError] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // --- Scan a parent folder ----------------------------------------------
  const [parent, setParent] = useState<string>('')
  const [depth, setDepth] = useState<2 | 3 | 4>(3)
  const [includeNonGit, setIncludeNonGit] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [candidates, setCandidates] = useState<ScanCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanFilter, setScanFilter] = useState('')
  const [scanError, setScanError] = useState('')
  const [adding, setAdding] = useState(false)
  const [backupAfter, setBackupAfter] = useState(false)
  const unlistenRef = React.useRef<(() => void) | null>(null)

  const unlocked = isUnlocked()
  const sync = React.useMemo<SyncContext>(
    () => ({
      store: createTauriStore(),
      io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
    }),
    [],
  )

  React.useEffect(() => {
    return () => {
      unlistenRef.current?.()
      unlistenRef.current = null
      if (isTauri()) void cancelScan().catch(() => {})
    }
  }, [])

  function selectTab(next: 'folder' | 'scan'): void {
    setParams(next === 'scan' ? { tab: 'scan' } : {})
  }

  async function handlePick(): Promise<void> {
    setError('')
    try {
      const picked = await pickProjectFolder()
      if (picked) {
        setFolder(picked)
        // Auto-detect the git remote when running in the desktop app.
        if (isTauri()) {
          const detected = await getGitRemote(picked).catch(() => null)
          if (detected) setRemote(detected)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder picker failed')
    }
  }

  function handleDetect(): void {
    setError('')
    try {
      const id = detectIdentity({ folderPath: folder, gitRemoteUrl: remote || undefined })
      setResult(id)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Could not detect identity')
    }
  }

  async function handleSave(): Promise<void> {
    if (result === null) return
    setSaving(true)
    setError('')
    try {
      const identity = result.kind === 'git' ? result.identity : result.id
      const displayName =
        result.kind === 'git'
          ? (result.identity.split('/').pop() ?? folder)
          : folder.split(/[\\/]/).pop() || folder
      const vault = new Vault(isTauri() ? createTauriDriver() : createMemoryDriver())
      const row = await vault.addProject({ identity, displayName, folderPath: folder })
      if (isTauri()) {
        // Folder → identity mapping lives in ~/.env-manager/links.json,
        // never inside the target repo.
        const links = await linksRead().catch((): Record<string, string> => ({}))
        links[folder] = identity
        await linksWrite(links)
      }
      toast(`Added "${displayName}".`)
      navigate(`/project/${encodeURIComponent(row.id)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save project')
    } finally {
      setSaving(false)
    }
  }

  async function handlePickParent(): Promise<void> {
    setScanError('')
    try {
      const picked = await pickProjectFolder()
      if (picked) setParent(picked)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Folder picker failed')
    }
  }

  async function handleScan(): Promise<void> {
    if (parent.trim() === '') {
      setScanError('Pick a parent folder to scan.')
      return
    }
    setScanError('')
    setScanning(true)
    setCandidates(null)
    setSelected(new Set())
    setProgress({ scanned: 0, found: 0 })
    try {
      unlistenRef.current = await listenScanProgress(setProgress)
      const rows = await scanEnvProjects({
        root: parent.trim(),
        maxDepth: depth,
        skipDirs: [...DEFAULT_SKIP_DIRS],
      })
      const existing = await new Vault(createTauriDriver()).listProjects()
      const next = buildScanCandidates(rows, existing, { includeNonGit })
      setCandidates(next)
      setSelected(new Set(next.filter((c) => !isDuplicate(c)).map((c) => c.identity)))
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      unlistenRef.current?.()
      unlistenRef.current = null
      setScanning(false)
    }
  }

  async function handleCancelScan(): Promise<void> {
    try {
      await cancelScan()
    } catch {
      // The scan will resolve on its own; cancel is best effort.
    }
  }

  function toggle(identity: string): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(identity)) next.delete(identity)
      else next.add(identity)
      return next
    })
  }

  const visible = React.useMemo(() => {
    const all = candidates ?? []
    const needle = scanFilter.trim().toLowerCase()
    if (needle === '') return all
    return all.filter((c) =>
      `${c.displayName} ${c.identity} ${c.folderPath}`.toLowerCase().includes(needle),
    )
  }, [candidates, scanFilter])

  const duplicateCount = (candidates ?? []).filter(isDuplicate).length
  const freshCount = (candidates ?? []).length - duplicateCount
  const selectedAddable = (candidates ?? []).filter(
    (c) => selected.has(c.identity) && !isDuplicate(c),
  )

  async function handleAddScanned(): Promise<void> {
    if (candidates === null || adding || selectedAddable.length === 0) return
    setAdding(true)
    setScanError('')
    const vault = new Vault(createTauriDriver())
    let links: Record<string, string> = {}
    if (isTauri()) links = await linksRead().catch((): Record<string, string> => ({}))

    let added = 0
    let skipped = 0
    let backedUp = 0
    let failed = 0
    for (const candidate of selectedAddable) {
      try {
        const row = await vault.addProject({
          identity: candidate.identity,
          displayName: candidate.displayName,
          folderPath: candidate.folderPath,
        })
        if (row.folderPath !== candidate.folderPath) {
          skipped += 1
          continue
        }
        added += 1
        links[candidate.folderPath] = candidate.identity
        if (backupAfter && unlocked) {
          for (const fileName of candidate.envFiles) {
            try {
              await backupToVault(sync, {
                projectId: row.id,
                identity: candidate.identity,
                filePath: joinPath(candidate.folderPath, fileName),
                fileName,
              })
              backedUp += 1
            } catch {
              failed += 1
            }
          }
        }
      } catch {
        failed += 1
      }
    }

    if (isTauri()) await linksWrite(links).catch(() => {})
    const parts = [`Added ${added}`, `skipped ${skipped}`]
    if (backupAfter) parts.push(`backed up ${backedUp}`)
    if (failed > 0) parts.push(`failed ${failed}`)
    toast(parts.join(' · '), failed > 0 ? 'error' : 'info')
    setAdding(false)
    navigate('/')
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Add Project</h1>

      <div
        role="tablist"
        aria-label="Add project mode"
        className="grid grid-cols-1 gap-1 rounded-lg border p-1 min-[420px]:grid-cols-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'folder'}
          onClick={() => selectTab('folder')}
          className={cn(
            'inline-flex min-h-[44px] items-center justify-center rounded-md px-3 text-sm font-medium',
            tab === 'folder' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent',
          )}
        >
          Add one folder
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scan'}
          onClick={() => selectTab('scan')}
          className={cn(
            'inline-flex min-h-[44px] items-center justify-center rounded-md px-3 text-sm font-medium',
            tab === 'scan' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent',
          )}
        >
          Scan a parent folder
        </button>
      </div>

      {tab === 'folder' ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick a project folder</CardTitle>
            <CardDescription>
              We detect its <code>git remote origin</code> for identity. Nothing is saved into your
              repo — the mapping lives in <code>~/.env-manager/</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/path/to/your/project"
                aria-label="Project folder"
                className="min-w-0 flex-1"
              />
              <Button type="button" variant="secondary" onClick={handlePick}>
                Browse…
              </Button>
            </div>
            <Input
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              placeholder="git remote origin (optional — auto-detected in the desktop app)"
              aria-label="Git remote origin"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={handleDetect} disabled={folder.trim().length === 0}>
                Detect identity
              </Button>
              <Button type="button" onClick={handleSave} disabled={result === null || saving}>
                {saving ? 'Adding…' : 'Add project'}
              </Button>
            </div>
            {error !== '' && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {result !== null && (
              <div className="rounded-md border bg-muted p-3 text-sm" aria-live="polite">
                {result.kind === 'git' ? (
                  <p>
                    Detected remote identity: <code>{normalizeGitRemote(result.remoteUrl)}</code>{' '}
                    from <code>{result.remoteUrl}</code>
                  </p>
                ) : (
                  <p>
                    No git remote — manual link id: <code>{result.id}</code> (stored in{' '}
                    <code>~/.env-manager/links.json</code>, never in your repo).
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Scan a parent folder</CardTitle>
              <CardDescription>
                Finds repos and monorepo subfolders with real env files. Read-only: names and git
                remotes only — file contents are never read and nothing is written.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  placeholder="/path/to/your/projects"
                  aria-label="Parent folder to scan"
                  className="min-w-0 flex-1"
                />
                <Button type="button" variant="secondary" onClick={handlePickParent}>
                  Browse…
                </Button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Depth</span>
                  <select
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value) as 2 | 3 | 4)}
                    className="min-h-[44px] w-full rounded-md border bg-background px-3 text-sm sm:w-32"
                    aria-label="Scan depth"
                  >
                    <option value={2}>2 levels</option>
                    <option value={3}>3 levels</option>
                    <option value={4}>4 levels</option>
                  </select>
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={includeNonGit}
                    onChange={(e) => setIncludeNonGit(e.target.checked)}
                  />
                  Include folders without git
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleScan} disabled={scanning || parent.trim() === ''}>
                  {scanning ? 'Scanning…' : 'Scan'}
                </Button>
                {scanning && (
                  <Button type="button" variant="outline" onClick={handleCancelScan}>
                    Cancel
                  </Button>
                )}
              </div>

              {!isTauri() && (
                <p className="text-sm text-muted-foreground">
                  The scan runs in the desktop app. Run <code>pnpm tauri dev</code>.
                </p>
              )}

              {scanning && (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Scanning… {(progress?.scanned ?? 0).toLocaleString()} folders ·{' '}
                  {progress?.found ?? 0} found
                </p>
              )}

              {scanError !== '' && (
                <p role="alert" className="text-sm text-destructive">
                  {scanError}
                </p>
              )}

              {candidates !== null && candidates.length === 0 && !scanning && (
                <p className="rounded-md border bg-muted p-3 text-sm">
                  No projects with env files found under <code>{parent}</code>. Try a deeper scan
                  or include folders without git.
                </p>
              )}
            </CardContent>
          </Card>

          {candidates !== null && candidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
                  <span>{candidates.length} found</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{freshCount} new</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{duplicateCount} already added</span>
                </CardTitle>
                <CardDescription>Select the projects to add to this vault.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Input
                  value={scanFilter}
                  onChange={(e) => setScanFilter(e.target.value)}
                  placeholder="Filter by name, identity or path"
                  aria-label="Filter scan results"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSelected((previous) => {
                        const next = new Set(previous)
                        for (const c of visible) if (!isDuplicate(c)) next.add(c.identity)
                        return next
                      })
                    }}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSelected((previous) => {
                        const next = new Set(previous)
                        for (const c of visible) next.delete(c.identity)
                        return next
                      })
                    }}
                  >
                    Select none
                  </Button>
                </div>

                <ul className="flex flex-col gap-2">
                  {visible.map((candidate) => {
                    const duplicate = isDuplicate(candidate)
                    const checked = !duplicate && selected.has(candidate.identity)
                    return (
                      <li
                        key={`${candidate.folderPath}:${candidate.identity}`}
                        className="rounded-[var(--radius)] border p-3"
                      >
                        <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-5 w-5 shrink-0"
                            checked={checked}
                            disabled={duplicate}
                            onChange={() => toggle(candidate.identity)}
                            aria-label={`Select ${candidate.displayName}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 truncate font-medium">
                                {candidate.displayName}
                              </span>
                              {duplicate && (
                                <Badge variant="outline">
                                  {candidate.duplicateOf !== undefined ? 'already added' : 'duplicate'}
                                </Badge>
                              )}
                              {!candidate.isGit && <Badge variant="secondary">non-git</Badge>}
                              {candidate.isGit && candidate.gitRemote === null && (
                                <Badge variant="warning">no git remote</Badge>
                              )}
                              {candidate.subpath !== '' && <Badge variant="outline">monorepo</Badge>}
                            </span>
                            <code className="mt-1 block min-w-0 truncate text-xs text-muted-foreground">
                              {candidate.identity}
                            </code>
                            <span className="mt-1 block break-words text-xs text-muted-foreground">
                              {candidate.folderPath}
                            </span>
                            <span className="mt-2 flex flex-wrap gap-1">
                              {candidate.envFiles.map((file) => (
                                <Badge key={file} variant="secondary">
                                  {file}
                                </Badge>
                              ))}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>

                {visible.length === 0 && (
                  <p className="text-sm text-muted-foreground">No results match that filter.</p>
                )}

                <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border bg-card/95 p-3 backdrop-blur">
                  <label
                    className={cn(
                      'flex min-h-[44px] items-center gap-2 text-sm',
                      !unlocked && 'opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={backupAfter && unlocked}
                      disabled={!unlocked}
                      onChange={(e) => setBackupAfter(e.target.checked)}
                    />
                    Back up their env files after adding
                  </label>
                  {!unlocked && (
                    <span className="text-xs text-muted-foreground">
                      Unlock encryption to enable backups.
                    </span>
                  )}
                  <Button
                    type="button"
                    className="ml-auto w-full min-[480px]:w-auto"
                    onClick={handleAddScanned}
                    disabled={adding || selectedAddable.length === 0}
                  >
                    {adding
                      ? 'Adding…'
                      : `Add ${selectedAddable.length} project${selectedAddable.length === 1 ? '' : 's'}`}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
