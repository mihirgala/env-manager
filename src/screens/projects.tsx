import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toaster'
import { createTauriStore } from '@/lib/store'
import { projectStatus, type SyncContext, type VaultStatus } from '@/lib/sync'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'
import { backupEnvFile, isTauri, listEnvFiles, readEnvFile, writeEnvFile } from '@/lib/tauri'
import { loadConfig, saveConfig } from '@/lib/config'
import * as React from 'react'

const statusVariant: Record<VaultStatus, 'success' | 'warning' | 'outline' | 'destructive'> = {
  'backed-up': 'success',
  changed: 'warning',
  'not-backed-up': 'outline',
  locked: 'outline',
}

export function ProjectsScreen(): React.JSX.Element {
  const toast = useToast()
  const [projects, setProjects] = React.useState<ProjectRecord[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const [statuses, setStatuses] = React.useState<Record<string, VaultStatus>>({})

  React.useEffect(() => {
    let cancelled = false
    const vault = new Vault(createTauriDriver())
    vault
      .listProjects()
      .then(async (rows) => {
        if (cancelled) return
        // Vault status over the first trackable file: `.env` when present,
        // otherwise the first `.env.*` (the detail screen picks the rest).
        const ctx: SyncContext = {
          store: createTauriStore(),
          io: { readFile: readEnvFile, writeFile: writeEnvFile, backupFile: backupEnvFile },
        }
        const withStatus = await Promise.all(
          rows.map(async (p) => {
            const found = await listEnvFiles(p.folderPath).catch(() => ['.env'] as string[])
            const names = found.length > 0 ? found : ['.env']
            const fileName = names.includes('.env') ? '.env' : (names[0] ?? '.env')
            const sep = p.folderPath.includes('/') ? '/' : '\\'
            const filePath = `${p.folderPath.replace(/[\\/]+$/, '')}${sep}${fileName}`
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
        if (!cancelled) {
          setProjects(withStatus.map((x) => x.p))
          setStatuses(Object.fromEntries(withStatus.map((x) => [x.p.id, x.status])))
          if (withStatus.length === 0) {
            loadConfig()
              .then((cfg) => {
                if (!cancelled && cfg.seenOnboarding !== true) {
                  setShowOnboarding(true)
                }
              })
              .catch(() => {})
          }
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

      {showOnboarding && (
        <Card>
          <CardHeader>
            <CardTitle>Welcome — local-first, no lock-in</CardTitle>
            <CardDescription>
              This app is a sidecar: your <code>.env</code> files stay the source of truth, nothing
              is added to your repos, and no account is needed. Add a folder and edit values in
              place — encrypted backups stay on this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              onClick={() => {
                setShowOnboarding(false)
                saveConfig({ seenOnboarding: true }).catch(() => {})
              }}
              className="inline-flex min-h-[44px] items-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground"
            >
              Got it
            </button>
          </CardContent>
        </Card>
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
            <Badge variant="secondary">no account needed</Badge>
          </CardContent>
        </Card>
      )}

      <ul className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
        {(projects ?? []).map((p) => (
          <li key={p.id}>
            <Link
              to={`/project/${encodeURIComponent(p.id)}`}
              className="block min-h-[44px] rounded-[var(--radius)] border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="mr-auto min-w-0 truncate font-medium">{p.displayName}</span>
                <Badge variant={statusVariant[statuses[p.id] ?? 'not-backed-up']}>
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
