# env-manager

A local-first, GUI-only env manager for developers with many projects across many laptops.

It keeps your `.env` files safe and portable — **without ever locking you in**. If you stop using
this app tomorrow, your projects still work exactly as before: plain `.env` files, no dependencies,
and no config committed to your repos.

## Why

- You switch laptops and want your projects to "just work" — `git clone`, restore envs, keep coding.
- You don't want to paste secrets into chat, email, or notes that leave your control.
- Collaborators should **never be forced** to install this. Adoption is per-laptop, per-user,
  per-project.

## Non-goals / guarantees (no lock-in)

1. **`.env` stays the source of truth on disk.** The app is a sidecar, never a runtime dependency.
2. **Zero files added to your projects.** No `env-manager.json` in repos, no code changes, no SDK
   imports.
3. **Uninstall-safe.** Removing the app leaves all `.env` files intact.
4. **Export anytime.** Encrypted `.envmgr` bundles are yours to copy; plaintext export is an
   explicit escape hatch.
5. **No network, no telemetry.** The shipping app makes no network calls and has no account system.

## How it works

```
+-------------------+        +------------------------+        +------------------+
|  Desktop GUI      |        |  Local vault           |        |  .envmgr bundle  |
|  Tauri + Vite     | <----> |  ~/.env-manager/       | <----> |  ciphertext only |
|  React + TS       |        |  SQLite + snapshots    |  move  |  (manual copy)   |
+-------------------+        +------------------------+        +------------------+
        | reads/writes plain .env files in place (comments + order preserved)
        v
  your projects (untouched repos)
```

- **Project identity:** normalized `git remote origin` (e.g. `github.com/foo/bar`) so the same repo
  auto-matches on any laptop. Monorepos add the relative folder as `identity::subpath`. Fallback:
  a manual UUID link in `~/.env-manager/links.json` for non-git folders.
- **Local vault:** `~/.env-manager/vault.db` holds project rows and append-only encrypted snapshots.
  `links.json` and `config.json` hold local metadata. Nothing is written into target repos.
- **No server, no account.** Moving a project between machines happens through encrypted `.envmgr`
  bundles you copy yourself.
- **Encryption (zero-knowledge):** passphrase → Argon2id → master key → portable per-file keys
  (`BLAKE2b(master, "identity:fileName")`) → XChaCha20-Poly1305 via libsodium. The passphrase is
  typed at launch, never persisted, and never leaves the device.
- **Automatic backups:** saving writes the `.env` file first and then an encrypted snapshot. Restore
  and import always show a key-level diff and write `.env.backup-<ts>` before changing anything.
- **Parent-folder scan:** pick a folder, walk it read-only, review the
  `repo` / `repo::apps/web` candidates, then bulk-add them with optional backups. Scanning never
  reads env contents.
- **Plaintext escape hatch:** explicit plaintext export/import with a diff preview. It warns that
  the exported file is unencrypted.

## Status

**v0.1.0 — distribution build.** The hosted-backend experiment was removed; this release is the
local SQLite vault, manual encrypted bundles, parent-folder scan, dark mode, and cross-platform
packaging. See [docs/ROADMAP.md](docs/ROADMAP.md) and
[docs/plan/env-manager-rework/](docs/plan/env-manager-rework/).

- [x] Project list, add project, parent-folder scan
- [x] Lossless editor, file tabs, on-disk change detection
- [x] SQLite vault with encrypted snapshots + restore diff
- [x] Encrypted bundle export/import + plaintext escape hatch
- [x] System / Light / Dark theme
- [ ] Signed installers and auto-update (post-0.1.0)

## Install

Download the artifact for your OS from the GitHub Releases page. Builds are **unsigned** for
v0.1.0:

- **Windows:** run the `.msi` / `.exe`; SmartScreen may warn — choose "More info → Run anyway".
- **macOS:** open the `.dmg`, drag to Applications, then right-click → Open (or allow it in System
  Settings → Privacy & Security). The macOS build is universal (Intel + Apple Silicon).
- **Linux:** use the `.AppImage` (mark executable) or the `.deb` / `.rpm` package.

See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for artifact names, checksums, and the release
checklist.

## Quick start (dev)

Prerequisites: Node 20+, pnpm, Rust toolchain + Tauri system deps (see
[Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```powershell
pnpm install
pnpm dev          # Vite frontend only
pnpm test         # unit tests
pnpm build        # typecheck + production bundle
pnpm tauri dev    # full desktop app (needs Rust)
pnpm tauri build  # installers for the host OS only
```

> Rust is not installed in every dev environment. `pnpm dev`, `pnpm test`, and `pnpm build` work
> without it; only `pnpm tauri dev` / `pnpm tauri build` need it.

## Project structure

```
src/               # Vite React UI
src/lib/           # pure TS: identity, dotenv, crypto, vault, store, sync, bundle, scan,
                   # env-files, theme, paths, config
src-tauri/         # thin Rust: fs, git remote, file stats, SQLite rows, dialogs, scan walk
docs/              # architecture, roadmap, distribution
```

The Tauri backend stays thin by design — product logic lives in `src/lib` (TypeScript) so it stays
testable without Rust. `src/lib/tauri.ts` is the only module that imports Tauri APIs.

## Contributing

PRs and issues welcome. Please:

1. Don't commit real `.env` files, `vault.db`, `*.envmgr`, or `*.backup-*`.
2. Use fixtures under `src/lib/__fixtures__/` with fake values only.
3. Keep target-project repos untouched in tests — use fixtures or temp dirs.
4. Run `pnpm test` and `pnpm build` before opening a PR, and check both themes at 360px.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

License: [MIT](LICENSE).
