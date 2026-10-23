import { FolderKanban, FolderPlus, KeyRound, Settings as SettingsIcon } from 'lucide-react'
import * as React from 'react'
import { NavLink } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  sidebarMenuButtonClass,
  useSidebar,
} from '@/components/ui/sidebar'
import { isTauri } from '@/lib/tauri'
import { Vault, createTauriDriver, type ProjectRecord } from '@/lib/vault'

const mainNav = [
  { to: '/', label: 'Projects', icon: FolderKanban, end: true, tooltip: 'Projects (all)' },
  { to: '/add', label: 'Add Project', icon: FolderPlus, end: false, tooltip: 'Add a project folder' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false, tooltip: 'Device, encryption, export' },
]

function useCollapsed(): boolean {
  const { state, isMobile } = useSidebar()
  return state === 'collapsed' && !isMobile
}

function useCloseDrawer(): () => void {
  const { isMobile, setOpenMobile } = useSidebar()
  return React.useCallback(() => {
    if (isMobile) setOpenMobile(false)
  }, [isMobile, setOpenMobile])
}

function Brand(): React.JSX.Element {
  const collapsed = useCollapsed()
  const closeDrawer = useCloseDrawer()
  return (
    <NavLink
      to="/"
      onClick={closeDrawer}
      aria-label="env-manager home"
      title="env-manager"
      className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <KeyRound aria-hidden size={18} />
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold tracking-tight">env-manager</span>
          <span className="text-xs text-sidebar-foreground/60">local-first · v0.1</span>
        </span>
      )}
    </NavLink>
  )
}

function ProjectShortcuts(): React.JSX.Element {
  const collapsed = useCollapsed()
  const closeDrawer = useCloseDrawer()
  const [projects, setProjects] = React.useState<ProjectRecord[] | null>(null)

  React.useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    new Vault(createTauriDriver())
      .listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows.slice(0, 12))
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (collapsed) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {(projects ?? []).slice(0, 8).map((p) => (
              <SidebarMenuItem key={p.id}>
                <NavLink
                  to={`/project/${encodeURIComponent(p.id)}`}
                  onClick={closeDrawer}
                  aria-label={p.displayName}
                  title={p.displayName}
                  className={({ isActive }) =>
                    sidebarMenuButtonClass({ isActive, collapsed })
                  }
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
                  >
                    {p.displayName.slice(0, 1).toUpperCase()}
                  </span>
                </NavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent projects</SidebarGroupLabel>
      <SidebarGroupContent>
        {projects === null ? (
          <p className="px-2 py-1 text-xs text-sidebar-foreground/60">
            {isTauri() ? 'Loading…' : 'Open the desktop app to list projects.'}
          </p>
        ) : projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-sidebar-foreground/60">
            No projects yet —{' '}
            <NavLink to="/add" onClick={closeDrawer} className="underline underline-offset-4">
              add one
            </NavLink>
            .
          </p>
        ) : (
          <SidebarMenu>
            {projects.map((p) => (
              <SidebarMenuItem key={p.id}>
                <NavLink
                  to={`/project/${encodeURIComponent(p.id)}`}
                  onClick={closeDrawer}
                  title={p.folderPath}
                  className={({ isActive }) => sidebarMenuButtonClass({ isActive })}
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
                  >
                    {p.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                </NavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar(): React.JSX.Element {
  const collapsed = useCollapsed()
  const closeDrawer = useCloseDrawer()

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map(({ to, label, icon: Icon, end, tooltip }) => (
                <SidebarMenuItem key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={closeDrawer}
                    title={tooltip}
                    className={({ isActive }) => sidebarMenuButtonClass({ isActive, collapsed })}
                  >
                    <Icon aria-hidden size={18} className="shrink-0" />
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <ProjectShortcuts />
      </SidebarContent>
      <SidebarFooter>
        {!collapsed && (
          <p className="rounded-lg bg-sidebar-accent/50 px-3 py-2 text-xs leading-relaxed text-sidebar-foreground/70">
            Sidecar mode — <code>.env</code> stays the source of truth. Nothing is written into your repos.
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
