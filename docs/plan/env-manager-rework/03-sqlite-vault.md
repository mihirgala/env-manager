# Step 3 — SQLite vault stores ciphertext only

Goal: `~/.env-manager/vault.db` becomes the encrypted backup store. Saving a file writes an
encrypted snapshot; "restore" decrypts and applies with a diff preview. No network.

## 3.1 Schema (`src-tauri/src/main.rs`)

Replace `env_sets` with an append-only `snapshots` table. Keep `projects` unchanged
(`local_only` column becomes unused; drop it via the migration below).

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name        TEXT NOT NULL,
  envelope         TEXT NOT NULL,   -- opaque JSON: { v, salt, nonce, algo, ciphertext }
  plaintext_sha256 TEXT NOT NULL,   -- local-only conflict detection
  source           TEXT NOT NULL,   -- 'local' | 'import'
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_lookup
  ON snapshots (project_id, file_name, created_at DESC);
```

Migration: use `PRAGMA user_version`.

- `user_version < 1` (existing installs): `ALTER TABLE projects DROP COLUMN local_only;`
  `DROP TABLE IF EXISTS env_sets;` (contains only row ids + sha, no secrets).
  `PRAGMA user_version = 1;`
- Fresh DB: create the schema above, set `user_version = 1`.
- Keep `foreign_keys = ON` (project delete cascades snapshots).

## 3.2 Rust commands (still dumb storage)

```rust
snapshot_put(project_id, file_name, envelope: String, plaintext_sha256: String, source: String) -> SnapshotRow
snapshot_latest(project_id, file_name) -> Option<SnapshotRow>
snapshot_list(project_id, file_name, limit: u32) -> Vec<SnapshotRow>
snapshot_delete(id) -> ()
```

- Envelope is passed through as a `String`. Rust never base64s, parses, decrypts, or hashes.
- `now_iso()` and `new_id()` already exist; keep them.
- Retention: after insert, delete rows beyond the newest 20 for `(project_id, file_name)`.
  Bound the DB without losing the recent restore points.
- Remove `envset_upsert` / `envset_list`, `project_set_local_only`, and the `local_only`
  field from `ProjectRow`. `project_add` must **not** overwrite an existing identity's
  `folder_path` anymore (skip/return existing; the scan UI explains duplicates).

## 3.3 TS store (`src/lib/store.ts`, new)

```ts
export interface SnapshotRow {
  id: string; projectId: string; fileName: string
  envelope: CryptoEnvelope; plaintextSha256: string
  source: 'local' | 'import'; createdAt: string
}

export interface SnapshotStore {
  put(input: { projectId; fileName; envelope; plaintextSha256; source }): Promise<SnapshotRow>
  latest(projectId, fileName): Promise<SnapshotRow | null>
  list(projectId, fileName, limit?): Promise<SnapshotRow[]>
}

export function createTauriStore(): SnapshotStore      // via ./tauri
export function createMemoryStore(): SnapshotStore & { rows: SnapshotRow[] }  // tests
```

Envelope JSON is parsed/serialized in TS (`JSON.parse` / `JSON.stringify` around the Rust
string). Add matching wrappers to `src/lib/tauri.ts` (`snapshotPut`, `snapshotLatest`,
`snapshotList`, `snapshotDelete`).

## 3.4 Engine rewrite (`src/lib/sync.ts` → keep filename)

```ts
backupToVault(ctx, { identity, projectId, filePath, fileName }): Promise<{ sha256 }>
planRestore(ctx, { projectId, filePath, fileName }): Promise<RestorePlan | null>
applyRestore(ctx, ...): Promise<{ backupPath: string | null; sha256: string }>
projectStatus(ctx, { projectId, filePath, fileName }): Promise<VaultStatus>
```

- `backupToVault`: read file → sha → `encryptFile(identity, fileName, text)` → `store.put`.
- `planRestore`: `store.latest` → decrypt → key-level diff vs local (`previewDiff` stays).
  Returns `{ diff, conflict, snapshotAt, source }`.
- `applyRestore`: backup existing file (`.env.backup-<ts>`), write decrypted text, then store
  a fresh `source: 'local'` snapshot so status returns to `backed-up`.
- `projectStatus`: `locked` | `not-backed-up` | `backed-up` | `changed`
  (`latest?.plaintextSha256 !== diskSha`). No `local-only`, no ahead/behind/diverged.
- Delete `CloudClient`, `CloudProject`, `CloudSnapshot`, `CloudNotConfiguredError`,
  `lastSyncedSha`, `pushProject`, `applyPull`, `planPull`.
- Keep `previewDiff` and its tests.

## 3.5 Auto-backup on save

`src/screens/project-detail.tsx` `handleSave` → after a successful disk write, if unlocked,
call `backupToVault` for that file; toast "Saved and backed up". If locked, toast
"Saved — unlock to back up" (never block the disk write on crypto).
Same for bulk add (step 5) when the optional checkbox is on.

## 3.6 Tests

- `store.test.ts`: put/latest/list ordering, retention trims to 20, project delete cascades.
- `sync.test.ts` rewritten on `createMemoryStore`:
  ciphertext-only assertion (`JSON.stringify(rows)` never contains the secret),
  backup → tamper disk → status `changed` → planRestore diff → applyRestore backs up,
  second identical backup → `backed-up`, missing snapshot → `not-backed-up`, locked → `locked`.

## Verification

```powershell
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml   # only if Rust is installed
```

Pass: no plaintext string from any test fixture appears in serialized store rows; status
has exactly four values; `env_sets` and `local_only` references are gone.
