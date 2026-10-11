import { FolderPlus } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

function Breadcrumb(): React.JSX.Element {
  const { pathname } = useLocation()
  const crumbs: { label: string; to?: string }[] = [{ label: 'env-manager', to: '/' }]
  if (pathname === '/add') crumbs.push({ label: 'Add Project' })
  else if (pathname === '/settings') crumbs.push({ label: 'Settings' })
  else if (pathname.startsWith('/project/')) crumbs.push({ label: 'Project' })
  else crumbs.push({ label: 'Projects' })

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  /
                </span>
              )}
              {c.to !== undefined && !last ? (
                <Link
                  to={c.to}
                  className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
                >
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="min-w-0 truncate font-medium">
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function Layout(): React.JSX.Element {
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex min-h-[68px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background/95 px-2 py-2 backdrop-blur sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <div className="min-w-0 flex-1">
              <Breadcrumb />
            </div>
          </div>
          <Link
            to="/add"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 sm:px-4"
            aria-label="Add project"
          >
            <FolderPlus aria-hidden size={16} />
            <span className="hidden min-[420px]:inline">Add Project</span>
          </Link>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-4 py-4 sm:px-6 sm:py-6">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
