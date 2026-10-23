# Contributing to env-manager

Thanks for helping — this app only works if developers trust it with secrets. The rules below protect that trust.

## No-secrets pledge

- **Never commit real `.env` files, tokens, passphrases, or recovery codes.** Use fixtures under `src/lib/__fixtures__/` (fake values only, e.g. `EXAMPLE_KEY=example-value`).
- Tests must use fixtures or temp dirs — never read/write real home or project `.env` files.
- Logs and error messages must never print plaintext secrets. Log keys and hashes only.
- Encrypted snapshots hold ciphertext + `plaintext_sha256` only. No plaintext columns or fields, ever.

## No lock-in

- Never write files, dependencies, or code into target user projects. No `env-manager.json` in repos.
- `.env` stays the source of truth. Export / Remove / Uninstall must leave `.env` files intact.
- The dotenv parser must round-trip: `serialize(parse(fixture)) === fixture`. Add or extend a round-trip test with every parser change.

## Architecture rules

- **Thin Rust:** `src-tauri/` does FS read/write, `git remote get-url`, file stats, SQLite rows, `links.json`/`config.json`, dialogs. No crypto, dotenv parsing, or sync logic — those live in `src/lib` (TypeScript).
- **Zero-knowledge:** passphrase / master key / DEK / plaintext never leave the device, are never logged, and are never written to disk in plaintext.
- **Conflicts:** never silently overwrite — show a diff, write `.env.backup-<ts>`, then apply.
- Load `.opencode/skills/repo-rules/SKILL.md` before touching vault, sync, crypto, dotenv, or Tauri code. Load `.opencode/skills/responsive-design/SKILL.md` for any UI work.

## Workflow

```powershell
pnpm install
pnpm dev        # Vite frontend only (works without Rust)
pnpm tauri dev  # full desktop app (needs Rust + VS Build Tools + WebView2)
pnpm build      # must pass before opening a PR
pnpm test       # unit tests
```

TypeScript strict. Functional React components + hooks. Keep `src/lib` pure (no static `@tauri-apps/*` imports — Tauri calls go through `src/lib/tauri.ts`).

## Commit scope

`pnpm build` green, tests green, no `.env` / `vault.db` / `cache/` / `*.backup-*` in the diff.
