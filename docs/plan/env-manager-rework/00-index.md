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

- [ ] 1. Remove hosted backend + pnpm only
- [ ] 2. Portable crypto
- [ ] 3. SQLite vault + snapshots
- [ ] 4. Import/export bundles
- [ ] 5. Parent-folder scan
- [ ] 6. Screens rewiring
- [ ] 7. Dark mode
- [ ] 8. Skills + docs
- [ ] 9. Packaging + CI
- [ ] 10. Verification

## Environment notes

- Windows host. `pnpm 12.11.2` available. `gh 2.102.0` available.
- **Rust/cargo not on PATH.** Git 2.56 is installed at
  `C:\Program Files\Git\cmd\git.exe` but not on PATH in this shell — call it by full path
  or add it to PATH. Local Tauri builds need a Rust toolchain install; CI is the reliable
  path for macOS/Linux artifacts.
- macOS and Linux bundles cannot be produced from Windows. Tauri does not cross-compile.
