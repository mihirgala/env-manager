import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'
import type { ThemePreference } from '@/lib/theme'

const order: ThemePreference[] = ['system', 'light', 'dark']

const iconFor: Record<ThemePreference, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const nextFor: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const labelFor: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export function ThemeToggle(): React.JSX.Element {
  const { preference, setPreference } = useTheme()
  const next = nextFor[preference]
  const Icon = iconFor[preference]

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${labelFor[preference]}. Switch to ${labelFor[next]}.`}
      title={`Theme: ${labelFor[preference]} — click for ${labelFor[next]}`}
      onClick={() => {
        const index = order.indexOf(preference)
        setPreference(order[(index + 1) % order.length] ?? 'system')
      }}
    >
      <Icon aria-hidden />
    </Button>
  )
}
