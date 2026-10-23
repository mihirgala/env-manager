import { Archive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toaster'
import { backupAllProjects, describeBackupResult } from '@/lib/backup-all'
import { isUnlocked } from '@/lib/crypto'
import { trackableEnvFiles } from '@/lib/env-files'
import { joinPath } from '@/lib/paths'
import { createTauriStore } from '@/lib/store'
import { backupToVault, projectStatus, type SyncContext, type VaultStatus } from '@/lib/sync'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import { backupEnvFile, isTauri, listEnvFiles, readEnvFile, writeEnvFile } from '@/lib/tauri'
import * as React from 'react'

const statusVariant: Record<VaultStatus, 'success' | 'warning' | 'outline' | 'destructive'> = {
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

export function ProjectsScreen(): React.JSX.Element {
  const toast = useToast()
  const vault = React.useMemo(() => new Vault(createTauriDriver()), [])
  const ctx = React.useMemo<SyncContext>(
    () => ({
      store: createTauriStore(),
      io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
    }),
    [],
  )
  const [projects, setProjects] = React.useState<ProjectRecord[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [statuses, setStatuses] = React.useState<Record<string, VaultStatus>>({})
  const [backingUp, setBackingUp] = React.useState(false)

  const loadProjects = React.useCallback(async (): Promise<void> => {
    if (!isTauri()) {
      setProjects([])
      return
    }
    const rows = await vault.listProjects()
    // Vault status over the first trackable file: `.env` when present,
    // otherwise the first `.env.*` (the detail screen picks the rest).
    const withStatus = await Promise.all(
      rows.map(async (p) => {
        const found = trackableEnvFiles(
          await listEnvFiles(p.folderPath).catch(() => ['.env'] as string[]),
        )
        const names = found.length > 0 ? found : ['.env']
        const fileName = names.includes('.env') ? '.env' : (names[0] ?? '.env')
        const filePath = joinPath(p.folderPath, fileName)
        try {
          const status = await projectStatus(ctx, {
            projectId: p.id,
            identity: p.identity,
            filePath,
            fileName,
          })
          return { p, status }
        } catch {
          return { p, status: 'not-backed-up' as VaultStatus }
        }
      }),
    )
    setProjects(withStatus.map((x) => x.p))
    setStatuses(Object.fromEntries(withStatus.map((x) => [x.p.id, x.status])))
  }, [ctx, vault])

  React.useEffect(() => {
    if (!isTauri()) {
      setProjects([])
      return
    }
    let cancelled = false
    loadProjects().catch((err: unknown) => {
      if (!cancelled) {
        setFailed(true)
        toast(err instanceof Error ? err.message : 'Could not load projects', 'error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [loadProjects, toast])

  async function runBackupAll(): Promise<void> {
    if (!isTauri()) return
    if (!isUnlocked()) {
      toast('Unlock encryption first — backups are encrypted with your passphrase.', 'error')
      return
    }
    setBackingUp(true)
    try {
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
      toast(describeBackupResult(result), result.failed > 0 ? 'error' : 'info')
      await loadProjects()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Back up all failed', 'error')
    } finally {
      setBackingUp(false)
    }
  }

  if (!isTauri()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Projects</h1>
        <Card>
          <CardHeader>
            <CardTitle>Desktop app required</CardTitle>
            <CardDescription>
              The project vault lives in the Tauri backend. Run <code>pnpm tauri dev</code> to
              open the desktop app.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const hasProjects = projects !== null && projects.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">
          Projects
        </h1>
        <Button
          type="button"
          variant="outline"
          onClick={runBackupAll}
          disabled={!hasProjects || backingUp}
          title={
            hasProjects
              ? 'Write encrypted snapshots for every env file in every project'
              : 'Add a project first'
          }
        >
          <Archive aria-hidden />
          {backingUp ? 'Backing up…' : 'Back up all'}
        </Button>
        <Link
          to="/add?tab=scan"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          Scan folder
        </Link>
        <Link
          to="/add"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Add Project
        </Link>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the vault. Is the desktop backend reachable?
        </p>
      )}

      {projects !== null && projects.length === 0 && !failed && (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Add one folder or scan a parent folder to find repos and monorepo subfolders. Nothing
              is written into your repos — <code>.env</code> stays the source of truth.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">no account needed</Badge>
          </CardContent>
        </Card>
      )}

      <ul className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
        {(projects ?? []).map((p) => (
          <li key={p.id}>
            <Link
              to={`/project/${encodeURIComponent(p.id)}`}
              title={p.folderPath}
              className="block min-h-[44px] rounded-[var(--radius)] border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="mr-auto min-w-0 truncate font-medium">{p.displayName}</span>
                <Badge variant={statusVariant[statuses[p.id] ?? 'not-backed-up']}>
                  {statusLabel[statuses[p.id] ?? 'not-backed-up']}
                </Badge>
              </span>
              <span className="mt-1 block min-w-0 truncate text-sm text-muted-foreground">
                <code>{p.identity}</code>
              </span>
              <span className="mt-1 block min-w-0 truncate text-sm text-muted-foreground">
                {p.folderPath}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
