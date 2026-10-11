import { useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ProjectDetailScreen(): React.JSX.Element {
  const { id } = useParams()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto min-w-0 truncate text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">
          Project {id ?? ''}
        </h1>
        <Badge variant="secondary">local-only</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Lossless .env editor</CardTitle>
          <CardDescription>P1 delivers the full editor. P0 is the shell + routing.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Comments, order, quoting and blank lines will be preserved on every save.
        </CardContent>
      </Card>
    </div>
  )
}
