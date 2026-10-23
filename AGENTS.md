# AGENTS.md — env-manager

GUI-only, local-first env manager. Tauri v2 + Vite React + TypeScript. Open source (MIT).

## Stack

- Frontend: Vite React + TypeScript in `src/`. Product logic lives in `src/lib/` — `identity`,
  `dotenv`, `crypto`, `vault`, `store`, `sync`, `portable`, `scan`, `env-files`, `theme`, `paths`,
  `config` — so it stays testable without Rust.
- Backend: Tauri v2 Rust in `src-tauri/` — thin only: fs read/write, `git remote get-url`, file
  stats, opaque SQLite snapshot rows, dialogs, and the read-only parent-folder scan walk. No
  crypto, parsing, sync policy, or ignore-rule policy in Rust.
- Storage: local SQLite vault at `~/.env-manager/vault.db` (projects + append-only encrypted
  snapshots), plus `links.json` / `config.json` metadata. No server, no accounts, no network calls.
- Crypto: libsodium in TS (`libsodium-wrappers-sumo`) — passphrase → Argon2id → master key →
  portable per-file DEKs (`BLAKE2b(master, "identity:fileName")`) → XChaCha20-Poly1305 with the
  file name as additional data.

## Commands

```powershell
pnpm install
pnpm dev          # Vite frontend only, no Rust needed
pnpm test         # vitest unit tests
pnpm build        # typecheck + production bundle — must pass before a PR
pnpm tauri dev    # full desktop app (needs Rust + Tauri system deps)
pnpm tauri build  # installers for the host OS only
```

Rust is optional for most frontend work. `dev`, `test`, and `build` work without it; only
`tauri dev` / `tauri build` need the Rust toolchain.

## Structure

```
src/                  # Vite React UI + src/lib/ (identity, dotenv, crypto, vault, store, sync,
                      # portable, scan, env-files, theme, paths, config)
src-tauri/            # thin Rust: fs, git remote, file stats, SQLite rows, dialogs, scan walk
docs/                 # architecture, roadmap
docs/DISTRIBUTION.md  # artifacts, unsigned install, signing, checksums
docs/plan/            # step-by-step rework plan (historical)
.opencode/skills/     # agent skills (responsive-design, repo-rules)
src/lib/__fixtures__/ # dotenv fixtures for tests — never real secrets
```

## Rules (must follow)

1. **No lock-in, ever.** `.env` stays the source of truth on disk. The app is a sidecar. Never add
   files, deps, or code to target user projects. Never write `env-manager.json` into a repo.
2. **Never commit secrets.** No real `.env` files, `vault.db`, exported vault `.db` files,
   `*.backup-*`, tokens, or passphrases. Use fixtures under `src/lib/__fixtures__/` only; no template
   env files. Tests must use temp dirs / fixtures, never real user repos.
3. **Lossless dotenv.** The parser in `src/lib` must preserve comments, order, quoting, blank lines,
   and `export` prefixes. Only values change on save. Round-trip tests are required.
4. **Thin Rust.** All product logic is in TS. Rust does FS, `git remote get-url`, file stats,
   opaque SQLite rows, dialogs, and the read-only scan walk only. No crypto, dotenv parsing, sync
   policy, or file-name filtering in Rust.
5. **Zero-knowledge.** The passphrase, master key, DEKs, and plaintext never leave the device, are
   never logged, and are never stored. The vault stores `{ v, salt, nonce, algo, ciphertext }`
   envelopes plus a local `plaintext_sha256` for conflict detection only. Portable vault files
   carry ciphertext, project metadata, and the public salt — never hashes or plaintext.
6. **No account, no server.** Sync is manual: one encrypted `.db` vault file the user moves by hand.
   There is no per-project opt-out. Uninstall / unlink / export must leave `.env` files intact.
7. **Project identity.** Normalize `git remote origin` (`git@github.com:Foo/bar.git` and
   `https://github.com/foo/bar` → `github.com/foo/bar`). Monorepos use `identity::subpath`.
   Fallback: manual UUID link in `~/.env-manager/links.json`, never in the repo.
8. **GUI-only.** No CLI. Flows are buttons/screens: Add Project (folder picker), Scan a parent
   folder (read-only, bulk add), status badges (`locked | not-backed-up | backed-up | changed`),
   Back up now, Restore with diff, single-file encrypted vault export/import, plaintext escape
   hatch, and Settings → Remove (keeps `.env`). No push/pull, no cloud account.
9. **Responsive + dark parity.** All screens must follow
   `.opencode/skills/responsive-design/SKILL.md` — fluid layouts, 360px minimum, 44px targets, no
   fixed-px page widths. Both light and dark themes are required deliverables.
10. **Repo guardrails + pnpm.** Load `.opencode/skills/repo-rules/SKILL.md` for security and
    no-lock-in checklists before touching vault, crypto, sync, scan, or Rust code. Use `pnpm` only.

## Conventions

- TypeScript strict. Functional React components + hooks. No class components.
- Keep `src/lib` pure (no static `@tauri-apps/*` imports) so it runs in Vite + tests. Tauri calls go
  through `src/lib/tauri.ts`.
- On restore/import: never silent overwrite — show a diff and write `.env.backup-<ts>` before the
  new content.
- Snapshots are append-only with per-file retention. Status is computed locally from the latest
  snapshot + the current file hash.
- Commit scope: `pnpm build` and `pnpm test` green, no `.env` / `vault.db` / exported vault `.db` /
  `*.backup-*` / `src-tauri/target/` committed.

## Packaging

- Target version **0.1.0**, first distributable build.
- Installers are unsigned for now; macOS ships a universal binary. See
  [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).
- CI builds per host OS (Tauri does not cross-compile). Signing material belongs in CI secrets only —
  never in the repo.
- Version bumps: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, then a
  `v0.1.0` tag.

## External instructions

- Product + security details: [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Distribution: [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).
