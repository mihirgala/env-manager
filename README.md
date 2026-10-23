# env-manager

A local-first, GUI-only env manager for developers with many projects across many laptops.

It keeps your `.env` files safe and portable — **without ever locking you in**. If you stop using
this app tomorrow, your projects still work exactly as before: plain `.env` files, no dependencies,
no config committed to your repos.

## Why

- You switch laptops and want your projects to "just work" — `git clone`, restore envs, keep coding.
- You don't want to paste secrets into chat, email, or plain cloud notes.
- Collaborators should **never be forced** to install this. Adoption is per-laptop, per-user,
  per-project.

## Non-goals / guarantees (no lock-in)

1. **`.env` stays the source of truth on disk.** The app is a sidecar, never a runtime dependency.
2. **Zero files added to your projects.** No `env-manager.json` in repos, no code changes, no SDK imports.
3. **Uninstall-safe.** Removing the app leaves all `.env` files intact.
4. **Export anytime.** Settings → Export gives you plaintext backups per project.

## How it works

```
+-------------------+        +------------------------+        +------------------+
|  Desktop GUI      |        |  Local vault           |        |  .envmgr bundle  |
|  Tauri + Vite     | <----> |  ~/.env-manager/       | <----> |  ciphertext only |
|  React + TS       |        |  SQLite + snapshots    |  E2E   |  (manual move)   |
+-------------------+        +------------------------+        +------------------+
        | reads/writes plain .env files in place (comments + order preserved)
        v
  your projects (untouched repos)
```

- **Project identity:** normalized `git remote origin` URL (e.g. `github.com/foo/bar`) so the same
  repo auto-matches on any laptop. Fallback: manual link with a local UUID for non-git folders.
- **Local vault:** `~/.env-manager/vault.db` (projects, env sets, encrypted snapshots) +
  `links.json` (folder → project mapping). Nothing is written into target repos.
- **No server, no account.** There is no hosted backend and no auth. Moving a project between
  machines happens through encrypted `.envmgr` bundles you copy yourself.
- **Encryption (zero-knowledge):** passphrase → Argon2id → master key → per-project data keys
  (XChaCha20-Poly1305 via libsodium). The passphrase is typed manually each session — it is never
  persisted and never leaves the device.

## Status / roadmap

> v0.1 (P0) — scaffold: Tauri shell boots, folder picker + git-remote detect. **DONE** — see
> [docs/ROADMAP.md](docs/ROADMAP.md).

- [x] **P0 — scaffold:** app boots, add-project flow skeleton
- [x] **P1 — local:** SQLite vault, lossless `.env` view/edit, status badges, file watcher
- [x] **P2 — encryption:** passphrase unlock + recovery key, encrypted snapshots, conflict backups
- [x] **P3 — polish:** multi-file sets (`.env`, `.env.local`), export/unlink

See [docs/ROADMAP.md](docs/ROADMAP.md) for details.

## Quick start (dev)

Prerequisites: Node 20+, pnpm, Rust toolchain + Tauri system deps (see
[Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```powershell
pnpm install
pnpm dev        # Vite frontend only
pnpm tauri dev  # full desktop app (needs Rust)
```

> Rust is not installed in every dev environment. `pnpm dev` / `pnpm build` work without it; only
> `pnpm tauri dev` / `pnpm tauri build` need it.

## Project structure

```
src/               # Vite React UI + src/lib (identity, dotenv, vault, crypto, sync)
src-tauri/         # Rust backend: fs, git, watcher, SQLite rows (thin)
docs/              # roadmap, architecture notes
```

Tauri backend stays thin by design — all product logic lives in `src/lib` (TypeScript) so it stays
testable without Rust.

## Contributing

PRs and issues welcome. Please:

1. Don't commit real `.env` files or secrets (use fixtures under `src/lib/__fixtures__/`).
2. Keep target-project repos untouched in tests — use fixtures under `src/lib/__fixtures__/`.
3. Run `pnpm build` before opening a PR.

License: [MIT](LICENSE).
