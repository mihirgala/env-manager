import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toaster'
import { sha256Hex } from '@/lib/hash'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import { backupEnvFile, isTauri, readEnvFile, writeEnvFile } from '@/lib/tauri'
import { isUnlocked } from '@/lib/crypto'
import { isCloudConfigured, lastSyncedKey, loadConfig, makeCloudClient } from '@/lib/cloud-config'
import { projectStatus, type SyncStatus } from '@/lib/sync'
import * as React from 'react'

type RowStatus = SyncStatus | 'unknown'

const statusVariant: Record<RowStatus, 'secondary' | 'success' | 'warning' | 'outline' | 'destructive'> = {
  'local-only': 'secondary',
  clean: 'success',
  behind: 'warning',
  ahead: 'warning',
  diverged: 'destructive',
  unknown: 'outline',
}

export function ProjectsScreen(): React.JSX.Element {
  const toast = useToast()
  const [projects, setProjects] = React.useState<ProjectRecord[] | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const vault = new Vault(createTauriDriver())
    vault
      .listProjects()
      .then(async (rows) => {
        if (cancelled) return
        // Status: local-only flag wins; cloud behind/ahead when configured +
        // unlocked; otherwise local clean/diverged from stored vs on-disk sha.
        const cfg = await loadConfig().catch(() => null)
        const withStatus = await Promise.all(
          rows.map(async (p) => {
            if (p.localOnly) return { p, status: 'local-only' as RowStatus }
            const sep = p.folderPath.includes('/') ? '/' : '\\'
            const file = `${p.folderPath.replace(/[\\/]+$/, '')}${sep}.env`
            if (cfg !== null && isCloudConfigured(cfg) && isUnlocked()) {
              try {
                const key = lastSyncedKey(p.id, '.env')
                const st = await projectStatus(
                  {
                    cloud: makeCloudClient(cfg),
                    io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
                    lastSyncedSha: cfg.lastSynced?.[key] ?? null,
                  },
                  { identity: p.identity, filePath: file, localOnly: false },
                )
                return { p, status: st as RowStatus }
              } catch {
                // fall through to local compare
              }
            }
            try {
              const sets = await vault.listEnvSets(p.id)
              const main = sets.find((s) => s.fileName === '.env') ?? sets[0]
              const content = await readEnvFile(file)
              const sha = await sha256Hex(content)
              return { p, status: (main !== undefined && main.sha256 !== '' && main.sha256 !== sha ? 'diverged' : 'clean') as RowStatus }
            } catch {
              return { p, status: 'unknown' as RowStatus }
            }
          }),
        )
        if (!cancelled) {
          setProjects(withStatus.map((x) => x.p))
          setStatuses(Object.fromEntries(withStatus.map((x) => [x.p.id, x.status])))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFailed(true)
          toast(err instanceof Error ? err.message : 'Could not load projects', 'error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const [statuses, setStatuses] = React.useState<Record<string, RowStatus>>({})

  if (!isTauri()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Projects</h1>
        <Card>
          <CardHeader>
            <CardTitle>Desktop app required</CardTitle>
            <CardDescription>
              The project vault lives in the Tauri backend. Run <code>npm run tauri dev</code> to
              open the desktop app.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">
          Projects
        </h1>
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
              Add a project folder to get started. Nothing is written into your repos —{' '}
              <code>.env</code> stays the source of truth.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">local-only default</Badge>
          </CardContent>
        </Card>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(projects ?? []).map((p) => (
          <li key={p.id}>
            <Link
              to={`/project/${encodeURIComponent(p.id)}`}
              className="block min-h-[44px] rounded-[var(--radius)] border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="mr-auto min-w-0 truncate font-medium">{p.displayName}</span>
                <Badge variant={statusVariant[statuses[p.id] ?? 'unknown']}>
                  {statuses[p.id] ?? '…'}
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
