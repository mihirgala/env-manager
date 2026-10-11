import { FolderPlus, Home, Settings as SettingsIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/', label: 'Projects', icon: Home, end: true },
  { to: '/add', label: 'Add Project', icon: FolderPlus, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export function Layout(): React.JSX.Element {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <span className="truncate text-[clamp(1.1rem,2vw+0.9rem,1.4rem)] font-semibold tracking-tight">
            env-manager
          </span>
          <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground sm:inline">
            v0.1 P0
          </span>
        </div>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-medium',
                  isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon aria-hidden size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6">
        <Outlet />
      </main>
    </div>
  )
}
