# Architecture — env-manager

```
+-------------------+        +------------------------+        +---------------------+
|  Desktop GUI      |        |  Local vault           |        |  env-manager .db    |
|  Tauri + Vite     | <----> |  ~/.env-manager/       | <----> |  all projects,      |
|  React + TS       |        |  SQLite + snapshots    |  move  |  ciphertext only    |
+-------------------+        +------------------------+        +---------------------+
        | reads/writes plain .env files in place (comments + order preserved)
        v
  your projects (untouched repos)
```

`.env` files on disk are the source of truth. The app is a sidecar: it never adds files,
dependencies, or code to target projects, and uninstall/export leaves every `.env` intact. There is
no server, no account, and no network call in the shipping app.

## Invariants

1. Plaintext only lives in `.env` files on disk and in memory while unlocked.
2. The vault stores opaque `CryptoEnvelope` rows plus a local `plaintext_sha256` used only for
   conflict detection. Portable vault files carry ciphertext, project metadata, and the public salt —
   never plaintext or hashes.
3. Passphrase, master key, DEKs, and plaintext are never logged and never written unencrypted.
4. Restore/import never overwrites silently: show a key-level diff, write `.env.backup-<ts>`, then
   apply.
5. Rust is thin: FS, git remote, file stats, opaque SQLite rows, dialogs, read-only scan walk.

## Data at rest

| Data | Location | Protection |
|---|---|---|
| Env values | project `.env*` files | Plaintext by design — the app is a sidecar |
| Project map | `~/.env-manager/links.json` | Local metadata only (folder → identity) |
| Device/theme/salt metadata | `~/.env-manager/config.json` | Local metadata; salt is not secret |
| Snapshots | `~/.env-manager/vault.db` | XChaCha20-Poly1305 ciphertext + local hash |
| Portable vault file | user-chosen `.db` | One file: project metadata + XChaCha20-Poly1305 ciphertext; no hashes |
| Passphrase / master key / DEK | memory only | Never persisted; wiped on lock |

## Module map

| Concern | Lives in | Notes |
|---|---|---|
| Project identity | `src/lib/identity.ts` | Normalize `git remote origin` → `github.com/foo/bar`; monorepo `identity::subpath`; manual UUID fallback in `links.json`, never in the repo |
| Lossless dotenv | `src/lib/dotenv.ts` | Preserves comments, order, quoting, blank lines, `export` prefixes; only values change on save. Fixtures in `src/lib/__fixtures__/`, round-trip tests in `dotenv.test.ts` |
| Env-file policy | `src/lib/env-files.ts` | Which `.env*` names are trackable; shared by scan, portable import/export, and UI |
| Crypto | `src/lib/crypto.ts` | libsodium in TS: passphrase → Argon2id → master key → portable per-file DEKs (`BLAKE2b(master, "identity:fileName")`) → XChaCha20-Poly1305 with `fileName` as AAD. Envelope `{ v, salt, nonce, algo, ciphertext }` |
| Local vault | `src/lib/vault.ts` | Project rows via a storage driver; default driver calls Rust SQLite commands |
| Snapshot store | `src/lib/store.ts` | Append-only encrypted rows, per-file retention (20), local `plaintext_sha256` |
| Snapshot policy | `src/lib/sync.ts` | `backupToVault`, `planRestore`, `applyRestore`, `projectStatus`, `applyImportedText`; diff-first, backup-before-write |
| Portable vault | `src/lib/portable.ts` | Strict `.db` format validation, one-file export, same-salt envelope reuse, different-salt re-encryption, merge policy; no plaintext or hashes in the file |
| Parent-folder scan | `src/lib/scan.ts` | Turns read-only Rust rows into portable candidates, duplicate/template filtering |
| Paths | `src/lib/paths.ts` | Cross-platform join + folder comparison keys |
| Theme | `src/lib/theme.ts` + `src/components/theme-provider.tsx` | System/Light/Dark, config source of truth, synchronous mirror, no-flash boot, native window theme |
| Config | `src/lib/config.ts` | `config.json` shape; TS owns the schema |
| Tauri adapter | `src/lib/tauri.ts` | **Only** module importing `@tauri-apps/*`; `pnpm dev` works without Rust |
| Rust backend (thin) | `src-tauri/src/main.rs` | FS read/write, `git remote get-url`, file stats, opaque SQLite rows, dialogs, read-only scan walk. No crypto/parsing/sync/ignore policy |
| UI | `src/screens/`, `src/components/` | Tailwind v4 + shadcn-style primitives; fluid layouts, 360px min, 44px targets, both themes |

## Flows

**Add Project:** folder picker (`pickProjectFolder`) → `git_remote_get_url` →
`detectIdentity` → `github.com/foo/bar` (or a manual UUID). Monorepos add the relative subpath.
The map is written to `links.json` + the vault, never to the repo.

**Scan a parent folder:** `scan_env_projects` walks read-only (depth/cap/skip list, progress +
cancel), returns raw folder/remote/`.env*` names only. `buildScanCandidates` applies
`trackableEnvFiles`, finds existing identities, and lets the user bulk-add with optional backups.

**Save:** edit values in place → lossless serialize → write the `.env` file on disk → hash the
plaintext locally → encrypt → append a snapshot row. A crypto failure never blocks the disk write;
the UI reports the backup failure.

**Restore:** `planRestore` loads the latest envelope, decrypts in memory, and computes added /
changed / removed keys. The user confirms "Backup + apply"; `applyRestore` writes
`.env.backup-<ts>` and then the file, and records an import snapshot.

**Export / import the vault:** `vault_export` copies every project and encrypted snapshot into one
standalone `.db` file the user moves by hand. `vault_read` returns opaque rows; `parsePortableVault`
validates the format. Import merges (never deletes): same-salt envelopes are reused, different-salt
files are decrypted once with the file passphrase and re-encrypted under the local key, and duplicate
snapshot content is skipped. Folder paths are portable metadata; a missing path must be restored
manually.

**Plaintext escape hatch:** export writes an explicit plaintext file and warns it is unencrypted.
Import validates the file name against the env-file policy, shows a diff, backs up the target, and
records an import snapshot.

**Theme:** `config.json` stores the preference; `localStorage` mirrors it so the inline boot script
can add `.dark` before first paint. The provider follows OS changes when set to System and asks
Tauri to match native chrome.

## Rust boundary

Allowed commands: `read_env_file`, `write_env_file`, `list_env_files`, `git_remote_get_url`,
`file_stat`, project/snapshot SQLite rows, `vault_export` / `vault_read` / `vault_import`,
`links_*`, `config_*`, dialogs (plugin), and `scan_env_projects` / `scan_cancel`.

Forbidden in Rust: crypto, dotenv parsing, sync/restore policy, portable vault format/merge policy,
env-file filtering, theme decisions. Those are pure TypeScript with unit tests.

## Development

`pnpm dev` runs the Vite UI without Rust. `pnpm test` runs the pure-TS suite. `pnpm build` must be
green before a PR. Only `pnpm tauri dev` and `pnpm tauri build` need the Rust toolchain; installers
build per host OS (see [DISTRIBUTION.md](DISTRIBUTION.md)).
