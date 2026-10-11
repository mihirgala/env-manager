import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { detectIdentity, type ProjectIdentity } from '@/lib/identity'
import { pickProjectFolder } from '@/lib/tauri'

export function AddProjectScreen(): React.JSX.Element {
  const [folder, setFolder] = useState<string>('')
  const [remote, setRemote] = useState<string>('')
  const [result, setResult] = useState<ProjectIdentity | null>(null)
  const [error, setError] = useState<string>('')

  async function handlePick(): Promise<void> {
    setError('')
    try {
      const picked = await pickProjectFolder()
      if (picked) setFolder(picked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder picker failed')
    }
  }

  function handleDetect(): void {
    setError('')
    try {
      setResult(detectIdentity({ folderPath: folder, gitRemoteUrl: remote || undefined }))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Could not detect identity')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Add Project</h1>
      <Card>
        <CardHeader>
          <CardTitle>Pick a project folder</CardTitle>
          <CardDescription>
            P0 skeleton: shows detected identity. Nothing is saved yet (vault lands in P1).
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
            placeholder="git remote origin (optional for now)"
            aria-label="Git remote origin"
          />
          <div>
            <Button type="button" onClick={handleDetect} disabled={folder.trim().length === 0}>
              Detect identity
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
                  Detected remote identity: <code>{result.identity}</code> from{' '}
                  <code>{result.remoteUrl}</code>
                </p>
              ) : (
                <p>
                  No git remote — manual link id: <code>{result.id}</code> (stored in{' '}
                  <code>~/.env-manager/links.json</code> in P1, never in your repo).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
