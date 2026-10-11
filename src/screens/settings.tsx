import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SettingsScreen(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[clamp(1.25rem,2vw+1rem,1.75rem)] font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Export / Remove</CardTitle>
          <CardDescription>
            Export gives you plaintext backups per project. Remove unlinks the app — your{' '}
            <code>.env</code> files stay intact.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled title="Lands with the P1 vault">
            Export backup (P1)
          </Button>
          <Button type="button" variant="outline" disabled title="Lands with the P1 vault">
            Remove project (P1)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
