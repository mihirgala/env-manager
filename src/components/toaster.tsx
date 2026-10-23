import * as React from 'react'
import { cn } from '@/lib/utils'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

const ToastContext = React.createContext<(message: string, kind?: Toast['kind']) => void>(() => {})

export function useToast(): (message: string, kind?: Toast['kind']) => void {
  return React.useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const idRef = React.useRef(0)

  const push = React.useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto w-full max-w-md rounded-md border px-4 py-3 text-sm shadow-lg dark:shadow-black/60',
              t.kind === 'error'
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'bg-card text-card-foreground',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
