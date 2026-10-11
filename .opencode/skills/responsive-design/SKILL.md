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

Tauri desktop window resizes. Users also run narrow side-snapped windows. Every screen must work at **360px** and scale up.

## When to use me

Load this skill for any UI work in `src/` — new screens, components, CSS, layout fixes.

## Rules

1. **Fluid first, no fixed page widths.** No `width: 1200px` page containers. Use `max-width + width: 100%`, flex wrap, grid with `minmax()`.
2. **Breakpoints:** design at 360px base. Add `min-width` enhancements at `640px`, `1024px`. Test with narrow Tauri window — sidebar collapses below 768px.
3. **Typography fluid:** use `clamp()` for headings, e.g. `font-size: clamp(1.25rem, 2vw + 1rem, 1.75rem)`. Body 14–16px, line-height ≥ 1.5.
4. **Touch + mouse:** interactive targets ≥ **44px**. Diff rows, Push/Pull buttons, project cards must be clickable without precision.
5. **Layouts:**
   - Project list → detail: single column < 768px, two-pane ≥ 768px.
   - Diff preview: side-by-side ≥ 1024px, unified stacked below.
   - Dialogs/sheets: full-width sheet on narrow, centered modal on wide.
6. **No horizontal scroll.** Long env values wrap or ellipsis with copy button + tooltip. Use `min-width: 0` on flex children to allow shrink.
7. **Dark-mode safe:** use CSS vars for surfaces/text, contrast ratio ≥ 4.5:1 both modes. Never hardcode `#fff` text on light bg.
8. **Tauri specifics:** window can be any size — avoid `100vh` traps, use `overflow: auto` panels. File picker / dialog triggers must be real `<button>`s for keyboard + screen reader.

## Checklist before done

- [ ] Resize to 360px wide — no overlap, no h-scroll, buttons reachable
- [ ] Resize to 1440px — content capped (`max-width: ~1100px` centered), not stretched edge-to-edge
- [ ] Keyboard: Tab reaches Add Project → list → Push/Pull → Settings
- [ ] `npm run build` passes

## Anti-patterns

- Fixed-pixel grids (`grid-template-columns: 300px 300px 300px`)
- `position: fixed` toolbars that cover content on small windows
- Tiny 28px icon-only Push/Pull with no label / tooltip
- Env secret values truncated with no way to reveal/copy
