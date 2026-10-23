# AGENTS.md — env-manager

GUI-only, local-first env manager. Tauri v2 + Vite React + TypeScript. Open source (MIT).

## Stack

- Frontend: Vite React + TypeScript in `src/` (planned). Product logic lives in `src/lib/` (identity, dotenv, vault, crypto, sync) so it stays testable without Rust.
- Backend: Tauri v2 Rust in `src-tauri/` — thin only: fs read/write, `git remote get-url`, file watcher, SQLite rows, dialogs. No crypto or product logic in Rust.
- Storage: local encrypted vault in `~/.env-manager/vault.db`. No server, no accounts, no network calls.
- Crypto: libsodium in TS (`libsodium-wrappers`) — Argon2id → master key → per-project DEKs (XChaCha20-Poly1305).

## Commands

```powershell
pnpm install
pnpm dev        # Vite frontend only, no Rust needed
pnpm tauri dev  # full desktop app (needs Rust + Tauri system deps)
pnpm build      # must pass before opening a PR
```

Rust is optional in most dev environments. `dev` / `build` work without it; only `tauri dev` / `tauri build` need it.

## Structure (target)

```
src/               # Vite React UI + src/lib (identity, dotenv, vault, crypto, sync)
src-tauri/         # Rust backend: fs, git, watcher, SQLite rows (thin)
docs/              # roadmap, architecture notes
.opencode/skills/  # agent skills (responsive-design, repo-rules)
src/lib/__fixtures__/  # dotenv fixtures for tests — never real secrets
```

## Rules (must follow)

1. **No lock-in, ever.** `.env` stays source of truth on disk. App is a sidecar. Never add files, deps, or code to target user projects. Never write `env-manager.json` into a repo.
2. **Never commit secrets.** No real `.env` files. Use fixtures under `src/lib/__fixtures__/` only. Tests must use temp dirs / fixtures, never touch real user repos.
3. **Lossless dotenv.** Parser in `src/lib` must preserve comments, order, quoting, blank lines. Only values change on pull. Round-trip tests required.
4. **Thin Rust.** All product logic in TS. Rust does FS + git-remote + watcher + SQLite rows + dialogs only.
5. **Zero-knowledge.** Passphrase / master key / plaintext never leave the device, never
   logged. Encrypted snapshots store `{ salt, nonce, ciphertext }` + `plaintext_sha256`
   for conflict detection only, inside the local vault.
6. **No account, no server.** Sync is manual: encrypted `.envmgr` bundles the user moves by hand. Uninstall / unlink / export must leave `.env` files intact.
7. **Project identity.** Normalize `git remote origin` (`git@github.com:Foo/bar.git` and `https://github.com/foo/bar` → `github.com/foo/bar`). Fallback: manual UUID link in `~/.env-manager/links.json`, never in the repo.
8. **GUI-only.** No CLI. All flows are buttons/screens: Add Project (folder picker), Push/Pull with diff preview, status badges (`clean | behind | ahead | diverged | local-only`), Settings → Export / Remove (keeps `.env`).
9. **Responsive UI.** All screens must follow `.opencode/skills/responsive-design/SKILL.md` — fluid layouts, min 360px width, 44px touch targets, no fixed-px page widths. Load that skill for any UI work.
10. **Repo guardrails.** Load `.opencode/skills/repo-rules/SKILL.md` for security + no-lock-in checklists before pushing cloud/sync code.

## Conventions

- TypeScript strict. Functional React components + hooks. No class components.
- Keep `src/lib` pure (no Tauri imports) so it runs in Vite + tests. Tauri calls go through a thin adapter.
- On pull conflict: never silent overwrite — prompt with diff, backup to `.env.backup-<ts>`.
- Commit scope: `pnpm build` green, no `.env` / `vault.db` / `cache/` committed.

## External instructions

- Crypto/sync details: see `README.md` (How it works) until `docs/ARCHITECTURE.md` exists.
- Roadmap phases: P0 scaffold → P1 local → P2 cloud E2E → P3 polish.
