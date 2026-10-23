import { PanelLeft } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  state: SidebarState
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggle: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (ctx === null) throw new Error('useSidebar must be used within a SidebarProvider')
  return ctx
}

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.innerWidth < breakpoint,
  )
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (): void => setIsMobile(window.innerWidth < breakpoint)
    onChange()
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [breakpoint])
  return isMobile
}

export interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  children,
  ...props
}: SidebarProviderProps): React.JSX.Element {
  const isMobile = useIsMobile()
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [openMobile, setOpenMobile] = React.useState(false)

  const open = openProp ?? internalOpen
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (openProp === undefined) setInternalOpen(value)
      onOpenChange?.(value)
    },
    [openProp, onOpenChange],
  )

  const toggle = React.useCallback(() => {
    if (isMobile) setOpenMobile((v) => !v)
    else setOpen(!open)
  }, [isMobile, open, setOpen])

  // Close the mobile drawer on resize up to desktop.
  React.useEffect(() => {
    if (!isMobile) setOpenMobile(false)
  }, [isMobile])

  // `b` toggles the sidebar (shadcn parity), ignored inside inputs.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (e.key === 'b' && (e.metaKey || e.ctrlKey) && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const state: SidebarState = open ? 'expanded' : 'collapsed'

  return (
    <SidebarContext.Provider value={{ state, open, setOpen, openMobile, setOpenMobile, isMobile, toggle }}>
      <div
        data-slot="sidebar-wrapper"
        data-state={state}
        className={cn('flex min-h-dvh w-full bg-sidebar text-sidebar-foreground', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
}

export function Sidebar({
  variant = 'inset',
  collapsible = 'icon',
  className,
  children,
  ...props
}: SidebarProps): React.JSX.Element {
  const { state, openMobile, setOpenMobile } = useSidebar()
  const collapsed = state === 'collapsed' && collapsible === 'icon'

  return (
    <>
      {/* Desktop rail / panel */}
      <div
        data-slot="sidebar"
        data-variant={variant}
        data-state={state}
        data-collapsible={collapsible}
        className="sticky top-0 hidden h-dvh shrink-0 bg-transparent transition-[width] duration-200 ease-out md:block"
        style={{ width: collapsed ? 'var(--sidebar-width-icon)' : 'var(--sidebar-width)' }}
      >
        <div className="h-full w-full p-2">
          <aside
            className={cn(
              'flex h-full w-full min-w-0 flex-col overflow-hidden bg-transparent',
              className,
            )}
            {...props}
          >
            {children}
          </aside>
        </div>
      </div>

      {/* Mobile drawer */}
      {openMobile && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setOpenMobile(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 w-[calc(var(--sidebar-width))] max-w-[85vw] p-2">
            <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-sidebar-border bg-sidebar shadow-xl">
              {children}
            </aside>
          </div>
        </div>
      )}
    </>
  )
}

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0', className)}
      {...props}
    />
  )
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div data-slot="sidebar-footer" className={cn('flex flex-col gap-1 p-2', className)} {...props} />
}

export function SidebarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  if (collapsed) return <div aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'truncate px-2 pt-2 text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function SidebarGroupContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div data-slot="sidebar-group-content" className={cn('flex flex-col gap-0.5', className)} {...props} />
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLUListElement>): React.JSX.Element {
  return <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-0.5', className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: React.HTMLAttributes<HTMLLIElement>): React.JSX.Element {
  return <li data-slot="sidebar-menu-item" className={cn('min-w-0', className)} {...props} />
}

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean
  tooltip?: string
}

export function sidebarMenuButtonClass(options?: {
  isActive?: boolean
  collapsed?: boolean
  className?: string
}): string {
  return cn(
    'flex min-h-[44px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    'focus-visible:outline-2 focus-visible:outline-sidebar-ring',
    options?.isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
    options?.collapsed && 'justify-center px-0',
    options?.className,
  )
}

export function SidebarMenuButton({
  className,
  isActive,
  tooltip,
  children,
  onClick,
  ...props
}: SidebarMenuButtonProps): React.JSX.Element {
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  return (
    <button
      type="button"
      title={tooltip}
      data-active={isActive}
      className={sidebarMenuButtonClass({ isActive, collapsed, className })}
      onClick={(e) => {
        if (isMobile) setOpenMobile(false)
        onClick?.(e)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

export function SidebarMenuBadge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        'ml-auto inline-flex shrink-0 items-center rounded-full bg-sidebar-accent px-2 py-0.5 text-xs font-medium text-sidebar-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function SidebarInset({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
        // Inset card on desktop, full-bleed on narrow windows.
        'md:m-2 md:ml-0 md:rounded-xl md:border md:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function SidebarTrigger({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const { toggle } = useSidebar()
  return (
    <button
      type="button"
      aria-label="Toggle sidebar"
      onClick={toggle}
      className={cn(
        'inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:outline-2',
        className,
      )}
      {...props}
    >
      <PanelLeft aria-hidden size={20} />
    </button>
  )
}
