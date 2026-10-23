# Step 6 — dark mode

Goal: System / Light / Dark, persisted locally, applied before first paint, native window
chrome matched where possible, both themes usable at 360px.

The `.dark` oklch palette already exists in `src/index.css`; nothing ever applies it, and
Tailwind v4 needs an explicit class-based variant.

## 6.1 CSS

`src/index.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root { color-scheme: light dark; }   /* native controls, scrollbars */
.dark { color-scheme: dark; }
```

- Keep existing `@theme inline` mapping and both palettes. Add a dark-appropriate
  `--warning` / `--success` pair if badges currently hardcode colors; audit
  `src/components/ui/badge.tsx`, `src/components/ui/sidebar.tsx`, `src/components/toaster.tsx`.
- Check focus ring, dashed borders, `bg-muted`, `bg-card/95` header blur (dark needs a
  slightly higher-opacity background), toast shadow.

## 6.2 Theme module (`src/lib/theme.ts`, new, pure)

```ts
export type ThemePreference = 'system' | 'light' | 'dark'
export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark'
export function applyTheme(resolved: 'light' | 'dark'): void   // toggles .dark on <html>
export function readStoredPreference(): ThemePreference        // localStorage mirror
export function storePreference(pref: ThemePreference): void
export function watchSystemTheme(cb: (dark: boolean) => void): () => void
```

Persistence: source of truth is `config.json` (`theme` field via `src/lib/config.ts`);
`localStorage['env-manager.theme']` is a mirror so the boot script can run synchronously.
Storage failures (privacy mode) must never throw — fall back to `system`.

## 6.3 Provider + toggle

- `src/components/theme-provider.tsx`: `ThemeProvider` (context with `preference`,
  `resolved`, `setPreference`), `useTheme()`. On mount: read mirror → apply → load config →
  reconcile → subscribe to `matchMedia('(prefers-color-scheme: dark)')`. Persist on change
  (config write best-effort, mirror always).
- `src/components/theme-toggle.tsx`: 44×44 icon button in the header (`layout.tsx`), cycling
  System → Light → Dark with `Monitor` / `Sun` / `Moon`, `aria-label` describing the next
  state, `title` tooltip. Place left of the Add Project button; hide the text at small widths,
  never the target size.
- Settings → **Appearance** card: three explicit buttons (System / Light / Dark) with the
  active one `aria-pressed`, plus a line "Follows your OS theme when set to System".
- Wrap the app in `main.tsx`: `ToastProvider > ThemeProvider > AuthGate > RouterProvider`
  (provider outside the gate so the unlock screen is themed too).

## 6.4 No flash on boot

`index.html` `<head>`:

```html
<meta name="color-scheme" content="light dark" />
<script>
  (function () {
    try {
      var p = localStorage.getItem('env-manager.theme') || 'system'
      var dark = p === 'dark' || (p === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      if (dark) document.documentElement.classList.add('dark')
    } catch (e) {}
  })()
</script>
```

Also fix `<title>tmp-vite</title>` → `env-manager` and point the favicon at the real icon.

## 6.5 Native window theme

In the provider, when `isTauri()`:

```ts
const { getCurrentWindow } = await import('@tauri-apps/api/window')
await getCurrentWindow().setTheme(resolved) // 'light' | 'dark'
```

- Add `core:window:allow-set-theme` to `src-tauri/capabilities/default.json`.
- Guard with `.catch(() => {})` — the browser preview must not break.
- Result: Windows title bar / macOS traffic-light area match the app.

## 6.6 Contrast + responsive checks

- Every surface pair checked in both themes: `background/foreground`, `card`,
  `muted-foreground`, `primary`, `destructive`, `sidebar`, badge variants
  (`success`, `warning`, `secondary`, `destructive`), disabled buttons, code blocks,
  password inputs, dashed "add key" row, toasts.
- At 360px: header toggle doesn't wrap the Add Project button; Settings Appearance buttons
  wrap into a column; scan results and bundle dialogs readable.
- Focus-visible ring visible on dark (current `--primary` is near-white; verify offset).

## 6.7 Tests

`src/lib/theme.test.ts`: resolve matrix (`system`+OS dark → dark, explicit light wins),
invalid stored value → `system`, `applyTheme` adds/removes `class="dark"` on a jsdom element,
storage throw path falls back to `system`.

## Verification

- Toggle System/Light/Dark, reload: no white flash, preference restored.
- Change OS theme while set to System: app follows live.
- Set Dark, restart the app: dark on first paint, title bar dark.
- Screenshot every screen at 360px and 1280px in both themes (manual acceptance in step 10).
```