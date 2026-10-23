# env-manager rework — index

Working plan for removing the hosted backend, moving to a local encrypted SQLite vault,
adding manual-key unlock, bundle import/export, parent-folder scanning, dark mode, and
cross-platform packaging.

Repo: `C:\Users\mihir\projects\personal\env-manager`
Plan location: `docs/plan/env-manager-rework/` (in-repo, versioned with the code)
Target version: **0.1.0** (first distributable build)

## How to use these docs (context-budget protocol)

1. Read **this file only** to pick the next step.
2. Open **one** step doc, implement it, run its verification block.
3. Tick the box here and add a one-line note (date + what changed).
4. Never load all docs at once. Each step doc is self-contained: files, symbols,
   commands, acceptance criteria. Verification greps exclude `docs/plan` because these
   docs necessarily mention the names being removed (supabase, keychain, npm, …).
5. Skills to load before coding: `.opencode/skills/repo-rules/SKILL.md` for any
   crypto/vault/sync/Rust change, `.opencode/skills/responsive-design/SKILL.md` for UI.

## Current → target (one screen)

| Area | Now | Target |
|---|---|---|
| Backend | Optional Supabase (Postgres + Auth + RLS) | **None.** SQLite `~/.env-manager/vault.db` only |
| What SQLite holds | projects + `env_sets.sha256` | projects + append-only `snapshots` (ciphertext envelopes + local sha) |
| Cross-machine sync | encrypted push/pull to Supabase | **Manual**: encrypted `.envmgr` bundles + plaintext export/import |
| Key | passphrase → Argon2id, master key held in memory; OS keychain helpers exist | same KDF, entered at every launch, **no keychain**, no persistence |
| Per-project key | keyed by local project UUID (not portable) | keyed by `identity + fileName` (**portable**) |
| Accounts/auth | GitHub OAuth, email OTP | none |
| Project onboarding | one folder at a time | one folder **or scan a parent folder** (repos + monorepo subfolders) |
| `local-only` flag | skips cloud | removed |
| Theme | `.dark` palette defined, never applied | System/Light/Dark toggle, persisted, no flash |
| Package manager | npm scripts, both lockfiles | **pnpm only** |
| Build output | dev only | Windows `.msi`/`.exe`, macOS universal `.dmg`/`.app`, Linux `.AppImage`/`.deb`/`.rpm` via CI |

## Decisions (locked)

See [11-decisions-log.md](11-decisions-log.md) for rationale and open items.

- Passphrase → Argon2id, typed manually each session.
- Auto-snapshot on every save + manual "Back up now".
- Import/export: encrypted project bundle (default) **and** plaintext escape hatch.
- Remove per-project `local-only` and the Devices card.
- pnpm only; delete `package-lock.json`.
- Scan includes monorepo subfolders (`identity::subpath`) and all `.env.*` except templates.
- Non-git folders: optional toggle in the scan screen.
- Unsigned artifacts now, signing hooks wired for later; macOS universal.
- Version stays `0.1.0`.

## Execution order

| # | Step | Doc | Exit criteria |
|---|---|---|---|
| 1 | Strip hosted backend + pnpm only | [01-remove-hosted-backend.md](01-remove-hosted-backend.md) | `pnpm install` clean, no `@supabase/*`, `.env.example` gone, no cloud/auth/keychain symbols |
| 2 | Portable crypto | [02-portable-crypto.md](02-portable-crypto.md) | same passphrase + identity decrypts on a simulated second machine |
| 3 | SQLite vault + snapshots | [03-sqlite-vault.md](03-sqlite-vault.md) | save → encrypted snapshot; restore diff works; ciphertext only in `vault.db` |
| 4 | Import/export | [04-import-export-bundles.md](04-import-export-bundles.md) | bundle round-trip across two vaults; plaintext import backs up first |
| 5 | Parent-folder scan | [05-scan-parent-folder.md](05-scan-parent-folder.md) | scan `~/projects` → bulk add repos + monorepo subfolders, examples ignored |
| 6 | Screens rewiring | [07-ui-screens.md](07-ui-screens.md) | no cloud/auth controls remain; status badges reflect vault state |
| 7 | Dark mode | [06-dark-mode.md](06-dark-mode.md) | System/Light/Dark works, persists, no flash, both themes at 360px |
| 8 | Skills + docs | [08-skills-and-docs.md](08-skills-and-docs.md) | docs describe SQLite-only reality; skills enforce it |
| 9 | Packaging + CI | [09-packaging-release.md](09-packaging-release.md) | Windows bundle locally (if Rust), CI produces all three |
| 10 | Verification | [10-testing-and-acceptance.md](10-testing-and-acceptance.md) | `pnpm test` + `pnpm build` green, QA matrix signed off |

## Global guardrails (apply to every step)

- `.env` on disk stays the source of truth. Never write app files into target repos.
- No plaintext secret ever lands in `vault.db`, bundles, logs, or docs. Ciphertext only.
- No network calls at all in the shipping app (no Supabase, no telemetry, no updater).
- Rust stays thin: FS, git remote, SQLite opaque rows, dialogs. No crypto/parsing/sync logic.
- Lossless dotenv is untouchable: comments, order, quoting, blank lines preserved.
- Never silent overwrite: diff preview + `.env.backup-<ts>` before any write.
- Responsive: 360px min, 44px targets, no fixed page widths.
- Do not commit `.env*`, `vault.db`, `*.envmgr`, `*.backup-*`, `src-tauri/target/`.

## Status

- [x] 1. Remove hosted backend + pnpm only
- [x] 2. Portable crypto
- [x] 3. SQLite vault + snapshots
- [x] 4. Import/export bundles
- [x] 5. Parent-folder scan
- [x] 6. Screens rewiring
- [x] 7. Dark mode
- [x] 8. Skills + docs
- [x] 9. Packaging + CI
- [ ] 10. Verification

## Progress log

- **2026-10-23 — step 1 done.** Supabase/auth/keychain/plugin-fs removed (TS + Rust +
  `supabase/`), `src/lib/cloud-config.ts` → `config.ts`, all `npm` → `pnpm`, pnpm-only
  lockfile. Added `.gitattributes` (`*.env -text`) so Windows `core.autocrlf` can't corrupt
  the lossless fixture round-trip tests. `pnpm test` (33) + `pnpm build` green.
- **2026-10-23 — step 2 done.** Crypto now keys off `identity:fileName` (BLAKE2b DEK,
  fileName as AEAD AAD), envelope `v: 2`, recovery blob stays `v: 1`. Added
  `encryptFile` / `decryptFile` / `decryptFileWithPassphrase`; removed project-id keying.
  `pnpm test src/lib/crypto.test.ts` (12) + `pnpm build` green.
- **2026-10-23 — step 3 done.** Vault schema v1 (`PRAGMA user_version`) replaces `env_sets`
  with append-only `snapshots` (envelope text + local sha, 20-row retention) and drops
  `local_only`; added `snapshot_put/latest/list/delete`, `src/lib/store.ts`, rewrote
  `sync.ts` around `backupToVault` / `planRestore` / `applyRestore` with four statuses, and
  auto-backup after save when unlocked. `pnpm test` (41) + `pnpm build` green; Rust not
  compiled locally (cargo absent) — CI validates the Tauri build.
- **2026-10-23 — step 4 done.** Added `bundle.ts` (strict parse, encrypted `.envmgr`
  build/serialize/decrypt, no plaintext or sha), `env-files.ts` policy, save/open dialog
  adapters + `dialog:allow-save`, and `applyImportedText` so plaintext/bundle imports back
  up before writing with `source: 'import'`. `pnpm test` (51) + `pnpm build` green.
- **2026-10-23 — step 5 done.** Rust `scan_env_projects` + `scan_cancel` walk a parent folder
  read-only (depth 3, 20k cap, skip list, no symlinks, progress + cancel), and `scan.ts`
  turns rows into portable `identity::subpath` candidates with duplicate/template filtering.
  Rebuilt Add Project with folder/scan tabs, 360px-safe result cards, bulk add + optional
  backups. `pnpm test` (61) + `pnpm build` green; Rust not compiled locally (cargo absent) —
  CI validates the scan commands.
- **2026-10-23 — step 6 done.** Project detail now shows vault status and supports Back up now,
  Restore diff → backup + apply, encrypted bundle export/import (with bundle passphrase),
  plaintext export/import with diff + automatic `.env.backup-<ts>`, plus Escape-to-close
  previews. Settings gained vault stats, export-all bundles, bundle import routing/adding, and
  the no-keychain copy; Projects gained Scan folder + clearer badges; Add Project reports
  duplicate identities with a link. Shared `paths.ts`. `pnpm test` (63) + `pnpm build` green.
  Appearance selector is intentionally left for step 7 (dark mode).
- **2026-10-23 — step 7 done.** Added the Tailwind class-based `dark` variant, success/warning
  palette tokens + stronger dark destructive contrast, `theme.ts` (mirror, resolve, apply,
  matchMedia watcher), `ThemeProvider` (config ↔ mirror reconcile, live OS follow, native
  `setTheme`), header cycle toggle, Settings Appearance card, and the inline no-flash boot
  script + `color-scheme` meta. `core:window:allow-set-theme` granted. `pnpm test` (70) +
  `pnpm build` green; native title-bar + 360px visual checks remain manual/CI (no desktop
  browser or cargo here).
- **2026-10-23 — step 8 done.** Rewrote `AGENTS.md`, README, CONTRIBUTING, ARCHITECTURE,
  ROADMAP, repo-rules + responsive-design skills, and the PR/issue templates for the SQLite-only
  app, pnpm, bundles, scan, and dark mode. Added `docs/DISTRIBUTION.md` (artifacts, unsigned
  installs, signing vars, checksums, release checklist, CI outline). Doc grep for
  supabase/rls/keychain/npm run/npx vitest/template env files is zero; `pnpm test` (70) +
  `pnpm build` green.
- **2026-10-23 — step 9 done.** `tauri.conf.json` now pins `msi, nsis, dmg, app, appimage, deb,
  rpm`, DeveloperTool metadata, macOS 10.15, Linux deb deps, per-user NSIS, and
  `createUpdaterArtifacts: false`; removed unused `withGlobalTauri`. Replaced the placeholder
  icons with the real logo (sanitized SVG + padding, generated with `pnpm tauri icon
  public/favicon.svg --fit contain`). Added `.github/workflows/release.yml` (tag + manual
  dispatch, Windows/macOS universal/Ubuntu matrix, tests, draft release, artifact fallback,
  secret-gated signing hooks), updated `docs/DISTRIBUTION.md` and `.gitignore`. Workflow YAML
  parses; `pnpm test` (70) + `pnpm build` green. Local `pnpm tauri build` could not run
  (rustc/cargo + MSVC build tools absent), so installer smoke-testing remains CI/manual.

## Environment notes

- Windows host. `pnpm 12.11.2` available. `gh 2.102.0` available.
- **Rust/cargo not on PATH.** Git 2.56 is installed at
  `C:\Program Files\Git\cmd\git.exe` but not on PATH in this shell — call it by full path
  or add it to PATH. Local Tauri builds need a Rust toolchain install; CI is the reliable
  path for macOS/Linux artifacts.
- macOS and Linux bundles cannot be produced from Windows. Tauri does not cross-compile.
