import { FolderOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// P0 placeholder — real project list lands in P1 with the SQLite vault.
export function ProjectsScreen(): React.JSX.Element {
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
          <Badge variant="outline">P0 scaffold</Badge>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen aria-hidden size={18} /> How it works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Pick a folder → we detect its <code>git remote origin</code> for identity → you edit{' '}
          <code>.env</code> values in place.
        </CardContent>
      </Card>
    </div>
  )
}
