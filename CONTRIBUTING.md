# Contributing to env-manager

Thanks for helping — this app only works if developers trust it with secrets. The rules below
protect that trust.

## No-secrets pledge

- **Never commit real `.env` files, tokens, passphrases, or recovery codes.** Use fixtures under
  `src/lib/__fixtures__/` with fake values only (`EXAMPLE_KEY=example-value`). Don't add template
  env files to the repo.
- Never commit `vault.db`, exported vault `.db` files, `*.backup-*`, or `src-tauri/target/`.
- Tests must use fixtures or temp dirs — never read/write real home or project `.env` files.
- Logs and error messages must never print plaintext secrets. Log keys and hashes only.
- The vault stores ciphertext envelopes plus `plaintext_sha256` for local conflict detection only.
  Portable vault files contain ciphertext, project metadata, and the public salt — **no hashes** and
  no plaintext columns or fields, ever.

## No lock-in

- Never write files, dependencies, or code into target user projects. No `env-manager.json` in
  repos. The parent-folder scan is read-only and never reads env contents.
- `.env` stays the source of truth. Export / Remove / Uninstall must leave `.env` files intact.
- The dotenv parser must round-trip: `serialize(parse(fixture)) === fixture`. Add or extend a
  round-trip test with every parser change.

## Architecture rules

- **Thin Rust:** `src-tauri/` does FS read/write, `git remote get-url`, file stats, opaque SQLite
  snapshot rows, `links.json` / `config.json`, dialogs, and the read-only scan walk. No crypto,
  dotenv parsing, sync policy, or file-name filtering — those live in `src/lib` (TypeScript).
- **Zero-knowledge:** passphrase / master key / DEK / plaintext never leave the device, are never
  logged, and are never written to disk in plaintext. Envelopes are
  `{ v, salt, nonce, algo, ciphertext }`; no keys are stored.
- **Portable identity:** DEKs derive from `identity:fileName`, not a local database id, so a vault
  file decrypts on another machine. Monorepo identities use `identity::subpath`.
- **Conflicts:** never silently overwrite — show a diff, write `.env.backup-<ts>`, then apply.
- **Dark mode:** check both themes at 360px before a PR. Use CSS variables, never hardcoded colors.
- Load `.opencode/skills/repo-rules/SKILL.md` before touching vault, sync, crypto, dotenv, scan, or
  Tauri code. Load `.opencode/skills/responsive-design/SKILL.md` for any UI work.

## Workflow

```powershell
pnpm install
pnpm dev          # Vite frontend only (works without Rust)
pnpm test         # unit tests
pnpm build        # typecheck + production bundle
pnpm tauri dev    # full desktop app (needs Rust + VS Build Tools + WebView2)
pnpm tauri build  # installers for the host OS only
```

TypeScript strict. Functional React components + hooks. Keep `src/lib` pure (no static
`@tauri-apps/*` imports — Tauri calls go through `src/lib/tauri.ts`).

## Commit scope

`pnpm test` and `pnpm build` green, no `.env` / `vault.db` / exported vault `.db` /
`*.backup-*` / `src-tauri/target/` in the diff.
