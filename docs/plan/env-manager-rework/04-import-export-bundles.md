# Step 4 — import / export (encrypted bundle + plaintext)

Goal: move env sets between machines without a server. Default path is an encrypted
`.envmgr` project bundle; plaintext `.env` import/export exists as an explicit escape hatch.

## 4.1 Bundle format (`src/lib/bundle.ts`, new)

File extension: `.envmgr` (JSON, UTF-8). Name: sanitized `<displayName>.envmgr`.

```json
{
  "format": "env-manager-bundle",
  "version": 1,
  "createdAt": "2026-10-23T12:00:00.000Z",
  "project": {
    "identity": "github.com/foo/bar::apps/web",
    "displayName": "bar / apps/web"
  },
  "files": {
    ".env":          { "v": 2, "salt": "...", "nonce": "...", "algo": "xchacha20poly1305", "ciphertext": "..." },
    ".env.local":    { "v": 2, "salt": "...", "nonce": "...", "algo": "xchacha20poly1305", "ciphertext": "..." }
  }
}
```

Rules:

- **No plaintext**, and **no `plaintext_sha256`** inside the bundle (a hash of secret values
  is a guessing oracle; conflict detection is local-only).
- `identity` is the portable key. Root repos use the plain identity, monorepo subfolders use
  `identity::subpath`.
- Export includes only trackable files (`.env`, `.env.*` minus templates — see step 5's
  `isTrackableEnvFile`), and refuses to run while locked.
- Import validates: extension/format/version, required fields, envelope `v === 2`,
  non-empty `files`, identity present. Unknown versions → "This bundle was made by a newer
  version" (no partial writes).

## 4.2 API

```ts
buildBundle(input: { identity; displayName; files: Record<string, string> }): Promise<Bundle>
serializeBundle(bundle: Bundle): string
parseBundle(text: string): Bundle            // throws BundleFormatError with a friendly message
decryptBundle(bundle: Bundle, opts: { passphrase?: string }): Promise<Record<string, string>>
```

`decryptBundle` uses the session key when the envelope salt matches the local master salt,
otherwise derives from `opts.passphrase` via `decryptFileWithPassphrase` (step 2.3). If a
bundle contains mixed salts, prompt once per distinct salt.

## 4.3 Native file dialogs

Browser downloads (`<a download>`) are unreliable inside Tauri. Use the dialog plugin:

- `src/lib/tauri.ts` add:
  - `pickSaveFile(defaultName, filters): Promise<string | null>` → `save()` from
    `@tauri-apps/plugin-dialog`
  - `pickOpenFile(filters): Promise<string | null>` → `open({ multiple: false })`
  - `pickFolder()` already exists as `pickProjectFolder()`; reuse for "export all".
- Write with the existing `write_env_file`; read with `read_env_file` (both are plain
  `std::fs`, no scope restrictions).
- `capabilities/default.json`: add `dialog:allow-save` (keep `dialog:allow-open`).

Filters: bundle → `[{ name: 'env-manager bundle', extensions: ['envmgr'] }]`,
plaintext → `[{ name: 'env file', extensions: ['env', 'local', 'development', 'production', 'test', 'staging'] }, { name: 'all files', extensions: ['*'] }]`.

## 4.4 Flows

**Export bundle (project page)**
1. Require unlocked + ≥1 trackable file.
2. For each file: `encryptFile(identity, fileName, text)` (bundle embeds master salt).
3. Save dialog → write. Toast includes the path. Warn if the file lands inside the project
   repo ("bundles are encrypted but prefer a folder outside your repos").

**Import bundle (project page)**
1. Open dialog → parse → confirm identity matches this project (or show mismatch warning and
   allow "import anyway" with a note that it will be re-encrypted under this project's identity).
2. Decrypt (prompt passphrase if salt differs) → per-file diff preview → **Apply**:
   backup each existing file, write, store a `source: 'import'` snapshot.
3. Never overwrite without the preview step; never write files that are absent from the
   bundle.

**Export all (Settings)** → folder picker → one `.envmgr` per project (skip locked/empty with
a summary toast).

**Import bundle from Settings** → open dialog → read identity → if a project with that
identity exists, route to that project's import flow; otherwise offer "Add project folder
first" (pick folder → `vault.addProject` → import).

**Plaintext export** — same save dialog, writes current file text verbatim; UI must state
it is unencrypted. **Plaintext import** — open dialog → diff preview → backup + write +
snapshot. Both are secondary buttons with a warning style, not the primary action.

## 4.5 Tests (`src/lib/bundle.test.ts`)

- round-trip: build → serialize → parse → decrypt → identical text.
- serialized bundle never contains fixture secret values nor `plaintext_sha256`.
- rejects wrong `format`, `version: 99`, missing `project.identity`, empty `files`,
  `v: 1` envelopes.
- wrong passphrase → friendly error, no partial apply.
- portability: build with store A/project id `mem-1`, import into store B/project id
  `mem-9` with the same identity → restores.
- import writes nothing when the user cancels the preview.

## Verification

```powershell
pnpm test src/lib/bundle.test.ts
pnpm build
```

Pass: `.envmgr` files round-trip; grep the exported JSON for a fixture secret → 0 hits;
every apply path has a backup assertion.
