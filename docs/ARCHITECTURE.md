# Architecture — env-manager

```
+-------------------+        +-------------------+        +------------------+
|  Desktop GUI      |        |  Local vault      |        |  Supabase cloud  |
|  Tauri + Vite     | <----> |  ~/.env-manager/  | <----> |  ciphertext only |
|  React + TS       |        |  SQLite + cache   |  E2E   |  Postgres + Auth |
+-------------------+        +-------------------+ encrypted +------------------+
        | reads/writes plain .env files in place (comments + order preserved)
        v
  your projects (untouched repos)
```

`.env` files on disk are the source of truth. The app is a sidecar: it never
adds files, dependencies, or code to target projects, and uninstall/export
leaves every `.env` intact.

## Module map

| Concern | Lives in | Notes |
|---|---|---|
| Project identity | `src/lib/identity.ts` | Normalize `git remote origin` → `github.com/foo/bar`; manual UUID fallback (stored in `~/.env-manager/links.json` in P1, never in the repo) |
| Lossless dotenv | `src/lib/dotenv.ts` | Preserves comments, order, quoting, blank lines, `export` prefixes; only values change on pull. Fixtures in `src/lib/__fixtures__/`; round-trip tests in `src/lib/dotenv.test.ts` |
| Local vault | `src/lib/vault.ts` (P1) | SQLite `~/.env-manager/vault.db` via `rusqlite`, plus `links.json` + `config.json` |
| Crypto | `src/lib/crypto.ts` (P2) | `libsodium-wrappers` in TS: passphrase → Argon2id → master key → per-project DEKs (XChaCha20-Poly1305). Envelope `{ v, salt, nonce, algo, ciphertext }` |
| Sync | `src/lib/sync.ts` (P2) | Push/Pull with diff preview; conflicts back up to `.env.backup-<ts>` and prompt — never silent overwrite |
| Tauri adapter | `src/lib/tauri.ts` | **Only** module importing `@tauri-apps/*`; mock fallback so `npm run dev` works without Rust |
| Rust backend (thin) | `src-tauri/src/main.rs` | FS read/write, `git remote get-url`, file-watcher + keychain stubs. No crypto/parsing/sync/cloud in Rust |
| Cloud schema | `supabase/migrations/` | `profiles`, `projects`, `env_snapshots`; owner-only RLS (`owner_id = auth.uid()`); ciphertext + `plaintext_sha256` only |
| UI | `src/screens/`, `src/components/ui/` | shadcn-style primitives + Tailwind v4; fluid layouts, 360px min, 44px targets (see responsive-design skill) |

## Flows

**Add Project (P0 skeleton → P1 vault):** folder picker (`pickProjectFolder`) →
`git_remote_get_url` → `detectIdentity` shows `github.com/foo/bar` or a manual
link id → P1 saves the mapping to `links.json` + vault.

**Push/Pull (P2):** encrypt locally → upload envelope → compare
`plaintext_sha256` for `behind | ahead | diverged` → diff preview → backup +
apply on confirm.

## Team sharing (v2 design note — not in v1)

Sharing one project's envs with teammates needs per-recipient key wrapping:
each member's public key (X25519, registered in a new `member_keys` table)
gets the project DEK sealed to it; snapshots gain a `wraps` map of
`member_id → sealed DEK`. Revocation = drop the wrap + rotate the DEK and
re-push. The v1 envelope shape already carries `v`/`algo` so wrapped-key
envelopes can version forward without a migration. No shared vault, no shared
passphrase in v1 — one owner per project (RLS `owner_id = auth.uid()`).
