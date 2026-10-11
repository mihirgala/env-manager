import * as React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { isTauri, configRead, configWrite, readEnvFile } from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'

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

  React.useEffect(() => {
    if (!isTauri()) return
    configRead()
      .then((cfg) => {
        if (typeof cfg['deviceName'] === 'string') setDeviceName(cfg['deviceName'])
      })
      .catch(() => {})
    vault
      .listProjects()
      .then(setProjects)
      .catch(() => {})
  }, [vault])

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
    // Plaintext backup per project. Export never touches cloud state.
    try {
      for (const p of projects) {
        const sep = p.folderPath.includes('/') ? '/' : '\\'
        try {
          const content = await readEnvFile(`${p.folderPath.replace(/[\\/]+$/, '')}${sep}.env`)
          downloadFile(`${p.displayName}.env.export`, content)
        } catch {
          toast(`Skipped ${p.displayName} — .env not readable.`, 'error')
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
