---
name: responsive-design
description: Build responsive Tauri + React screens that work from 360px mobile width to wide desktop windows
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  workflow: frontend-ui
---

# Responsive Design — env-manager

Tauri desktop windows resize, and users run narrow side-snapped windows. Every screen must work at
**360px** and scale up. Both **light and dark** themes are required deliverables.

## When to use me

Load this skill for any UI work in `src/` — new screens, components, CSS, layout fixes, theme tokens.

## Rules

1. **Fluid first, no fixed page widths.** No `width: 1200px` page containers. Use `max-width +
   width: 100%`, flex wrap, grid with `minmax()`.
2. **Breakpoints:** design at 360px base. Add `min-width` enhancements at `640px` and `1024px`.
   Test with a narrow Tauri window — the sidebar collapses below 768px.
3. **Typography fluid:** use `clamp()` for headings, e.g.
   `font-size: clamp(1.25rem, 2vw + 1rem, 1.75rem)`. Body 14–16px, line-height ≥ 1.5.
4. **Touch + mouse:** interactive targets ≥ **44px**. Project cards, tabs, diff checkboxes, scan
   rows, and dialog actions must be clickable without precision.
5. **Layouts:**
   - Project list → detail: single column < 768px, two-pane ≥ 768px.
   - Diff preview: side-by-side ≥ 1024px, unified stacked below.
   - Dialogs/sheets: full-width sheet on narrow, centered modal on wide.
   - Scan results: stacked cards below 720px; compact table/grid at 720px+. Keep the bulk action
     bar sticky and wrapping so it never covers the last row.
6. **No horizontal scroll.** Long env values wrap or ellipsis with a copy button + tooltip. Use
   `min-width: 0` on flex children. `overflow-x-auto` is allowed only for file-tab strips.
7. **Tauri specifics:** the window can be any size — avoid `100vh` traps; use `overflow: auto`
   panels. File picker / dialog triggers must be real `<button>` elements for keyboard + screen
   readers.

## Dark mode

- Both themes ship together; never leave one as a follow-up.
- Use the CSS variables in `src/index.css` (`--background`, `--card`, `--muted-foreground`,
  `--primary`, `--destructive`, `--success`, `--warning`, sidebar + badge tokens). Never hardcode
  hex colors or `#fff` text on light surfaces.
- Set `color-scheme` for native controls and scrollbars. The boot script adds `.dark` before first
  paint and `applyTheme` keeps the class + inline `color-scheme` in sync.
- Verify contrast ≥ 4.5:1 for text, muted text, destructive buttons/toasts, status badges, disabled
  controls, code blocks, password inputs, and dashed "add key" rows.
- Check the header blur, toast shadow, focus-visible ring, sidebar footer, and project-detail
  warning tint in both modes.

## Theme toggle

- 44×44 icon button in the header, left of Add Project. `Monitor` / `Sun` / `Moon`.
- `aria-label` and `title` describe the **next** state ("Theme: System. Switch to Light.").
- Cycles System → Light → Dark; Settings also exposes three explicit buttons with `aria-pressed`.
- Preference persists in `config.json` with a synchronous `localStorage` mirror; no flash on boot.
- Respect OS changes live when set to System.

## Checklist before done

- [ ] Resize to 360px — no overlap, no horizontal scroll, buttons reachable
- [ ] Resize to 1440px — content capped (`max-width: ~1100px` centered), not stretched edge-to-edge
- [ ] Both themes checked at 360px and 1280px
- [ ] Keyboard: Tab reaches sidebar, theme toggle, Add Project, list actions, and dialog actions
- [ ] Theme toggle target stays 44×44 and Add Project never wraps off-screen
- [ ] `pnpm test` and `pnpm build` pass

## Anti-patterns

- Fixed-pixel grids (`grid-template-columns: 300px 300px 300px`)
- `position: fixed` toolbars that cover content on small windows
- Tiny 28px icon-only actions with no label or tooltip
- Secret values truncated with no way to reveal/copy
- Dark mode implemented with inverted or hardcoded colors instead of the theme tokens
