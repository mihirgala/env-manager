import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  storePreference,
  watchSystemTheme,
} from './theme'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeDocument(): { classes: Set<string>; document: Document } {
  const classes = new Set<string>()
  const classList = {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
    contains: (name: string) => classes.has(name),
    toggle: (name: string, force?: boolean) => {
      if (force === undefined) {
        if (classes.has(name)) classes.delete(name)
        else classes.add(name)
      } else if (force) {
        classes.add(name)
      } else {
        classes.delete(name)
      }
      return classes.has(name)
    },
  }
  return {
    classes,
    document: { documentElement: { classList, style: {} } } as unknown as Document,
  }
}

describe('theme', () => {
  it('resolves system, light and dark preferences', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('reads a valid mirror and falls back to system for invalid values', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'dark' })
    expect(readStoredPreference()).toBe('dark')

    vi.stubGlobal('localStorage', { getItem: () => 'sepia' })
    expect(readStoredPreference()).toBe('system')

    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(readStoredPreference()).toBe('system')
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
    })
    expect(readStoredPreference()).toBe('system')
    expect(() => storePreference('dark')).not.toThrow()
  })

  it('stores the mirror preference', () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(() => null) }
    vi.stubGlobal('localStorage', storage)
    storePreference('dark')
    expect(storage.setItem).toHaveBeenCalledWith('env-manager.theme', 'dark')
  })

  it('toggles the dark class on the document element', () => {
    const fake = fakeDocument()
    vi.stubGlobal('document', fake.document)

    applyTheme('dark')
    expect(fake.classes.has('dark')).toBe(true)
    expect((fake.document.documentElement.style as CSSStyleDeclaration).colorScheme).toBe('dark')
    applyTheme('light')
    expect(fake.classes.has('dark')).toBe(false)
    expect((fake.document.documentElement.style as CSSStyleDeclaration).colorScheme).toBe('light')
  })

  it('subscribes to OS theme changes and unsubscribes', () => {
    let handler: ((event: { matches: boolean }) => void) | undefined
    const remove = vi.fn()
    const query = {
      matches: false,
      addEventListener: (_type: string, next: (event: { matches: boolean }) => void) => {
        handler = next
      },
      removeEventListener: remove,
    }
    vi.stubGlobal('window', { matchMedia: vi.fn(() => query) })

    const cb = vi.fn()
    const stop = watchSystemTheme(cb)
    handler?.({ matches: true })
    expect(cb).toHaveBeenCalledWith(true)
    stop()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('returns a no-op when matchMedia is unavailable', () => {
    vi.stubGlobal('window', {})
    const stop = watchSystemTheme(() => {})
    expect(() => stop()).not.toThrow()
  })
})
