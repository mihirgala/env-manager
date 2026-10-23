import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { detectIdentity, normalizeGitRemote, type ProjectIdentity } from '@/lib/identity'
import {
  getGitRemote,
  isTauri,
  linksRead,
  linksWrite,
  pickProjectFolder,
} from '@/lib/tauri'
import { Vault, createMemoryDriver, createTauriDriver } from '@/lib/vault'

export function AddProjectScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const [folder, setFolder] = useState<string>('')
  const [remote, setRemote] = useState<string>('')
  const [result, setResult] = useState<ProjectIdentity | null>(null)
  const [error, setError] = useState<string>('')
  const [saving, setSaving] = useState(false)

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
        // Folder → identity mapping lives in ~/.env-manager/links.json (P1),
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Add Project</h1>
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
                  Detected remote identity: <code>{normalizeGitRemote(result.remoteUrl)}</code> from{' '}
                  <code>{result.remoteUrl}</code>
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
    </div>
  )
}
