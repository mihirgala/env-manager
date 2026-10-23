# Architecture — env-manager

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

`.env` files on disk are the source of truth. The app is a sidecar: it never
adds files, dependencies, or code to target projects, and uninstall/export
leaves every `.env` intact. There is no server, no account, and no network
call in the shipping app.

## Module map

| Concern | Lives in | Notes |
|---|---|---|
| Project identity | `src/lib/identity.ts` | Normalize `git remote origin` → `github.com/foo/bar`; manual UUID fallback (stored in `~/.env-manager/links.json`, never in the repo) |
| Lossless dotenv | `src/lib/dotenv.ts` | Preserves comments, order, quoting, blank lines, `export` prefixes; only values change on pull. Fixtures in `src/lib/__fixtures__/`; round-trip tests in `src/lib/dotenv.test.ts` |
| Local vault | `src/lib/vault.ts` | SQLite `~/.env-manager/vault.db` via `rusqlite`, plus `links.json` + `config.json` |
| Crypto | `src/lib/crypto.ts` | `libsodium-wrappers` in TS: passphrase → Argon2id → master key → per-project DEKs (XChaCha20-Poly1305). Envelope `{ v, salt, nonce, algo, ciphertext }` |
| Snapshots / bundles | `src/lib/sync.ts` | Push/Pull with diff preview; conflicts back up to `.env.backup-<ts>` and prompt — never silent overwrite |
| Tauri adapter | `src/lib/tauri.ts` | **Only** module importing `@tauri-apps/*`; mock fallback so `pnpm dev` works without Rust |
| Rust backend (thin) | `src-tauri/src/main.rs` | FS read/write, `git remote get-url`, file stats, SQLite rows, dialogs. No crypto/parsing/sync logic in Rust |
| UI | `src/screens/`, `src/components/ui/` | shadcn-style primitives + Tailwind v4; fluid layouts, 360px min, 44px targets (see responsive-design skill) |

## Flows

**Add Project:** folder picker (`pickProjectFolder`) → `git_remote_get_url` →
`detectIdentity` shows `github.com/foo/bar` or a manual link id → saves the
mapping to `links.json` + vault.

**Save:** edit values in place → lossless serialize → write the `.env` file on
disk → store an encrypted snapshot in the local vault.

**Move between machines:** export an encrypted bundle from the vault, copy it
by hand, import it on the other machine. Import of plaintext always backs up
any existing `.env` first.

## Sharing note (future)

Sharing one project's envs with teammates needs per-recipient key wrapping.
The envelope shape already carries `v`/`algo` so wrapped-key envelopes can
version forward without a migration. Not in v1.
