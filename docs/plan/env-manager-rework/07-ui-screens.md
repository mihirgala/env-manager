# Step 7 — screen rewiring

Goal: no cloud/auth/keychain UI remains; every action maps to the local vault, bundles, or
the scan. Follow `.opencode/skills/responsive-design/SKILL.md` (360px, 44px targets, fluid).

## 7.1 Project detail (`src/screens/project-detail.tsx`)

Remove: `CloudUpload`/`CloudDownload` push/pull, `syncContext`, `handlePush`,
`handlePlanPull`, `handleApplyPull`, `handleToggleLocalOnly`, `local-only` badge,
`lastSynced` config writes, cloud imports.

Keep: lossless editor (value-only edits), file tabs, disk-change watcher, Save, Backup now,
Export, Unlink.

Add:

| Control | Behaviour |
|---|---|
| Status badge | `backed-up` / `changed` / `not-backed-up` / `locked` from `projectStatus` |
| **Back up now** | `backupToVault` for the current file; disabled while locked with hint |
| **Restore…** | `planRestore` → diff card (added/changed/removed) → "Backup + apply" |
| **Export bundle…** | step 4 flow, primary-ish secondary button |
| **Import bundle…** | step 4 flow, diff preview + per-file apply |
| **Export plaintext…** | warning-tinted outline; toast states it's unencrypted |
| **Import plaintext…** | dialog → diff → backup + write + snapshot |

Layout: action row is `flex flex-wrap gap-2`, primary Save first, destructive Unlink last and
visually separated by `sm:ml-auto`. Diff preview cards remain full-width and wrap at 360px.

Snapshot history (nice-to-have, only if cheap): "Restore older…" `<details>` listing
`store.list(...)` timestamps with "Backup + apply" per row.

## 7.2 Settings (`src/screens/settings.tsx`)

Remove: Cloud sync card, custom Supabase fields, Test connection, GitHub sign-in/out,
Devices card and device registry logic, `local-only` mentions, cloud imports.

Keep/reshape:

1. **Appearance** (new, step 6): System / Light / Dark.
2. **Encryption**: set up passphrase (min 8), recovery code show-once + confirm, unlocked /
   locked status, Lock now. Copy: "Your passphrase is entered at every launch and never
   stored — not in the OS keychain, not on disk."
3. **Vault**: path `~/.env-manager/vault.db`, snapshot count/size (via a small
   `vault_stats` command or computed from `snapshot_list` counts), last backup time.
4. **Import / export**: "Export all bundles…" (folder picker, one `.envmgr` per project,
   summary toast) and "Import bundle…" (identity match → route to project, else offer add).
5. **Projects / Remove**: list with unlink; copy stresses `.env` files stay on disk.
6. **Device name**: keep as an optional label used in bundle metadata; not a sync identity.

Mobile: cards stack; buttons full-width under `sm`; no horizontal scroll.

## 7.3 Projects list (`src/screens/projects.tsx`)

- Statuses: `backed-up` (success), `changed` (warning), `not-backed-up` (secondary/outline),
  `locked` (outline). Compute per project with `projectStatus` over the first trackable file
  (or show aggregate: worst of the project's files).
- Remove `isCloudConfigured`/`makeCloudClient` branches and `lastSyncedKey`.
- Add header actions: **Scan folder** (→ `/add?tab=scan`) beside **Add Project**.
- Onboarding copy: "local-first, encrypted local vault, no account, export anytime".
- Empty state: "No projects yet — add one folder or scan a parent folder."

## 7.4 Add Project (`src/screens/add-project.tsx`)

Rebuild per step 5: tabs **Add one folder** / **Scan a parent folder**; deep-link
`/add?tab=scan`; remove cloud-match auto-pull; keep folder picker, git detect, manual link
id display. Duplicate identity → inline error "Already linked to <path>" with a link to that
project instead of silently re-pointing.

## 7.5 Layout / sidebar / copy

- `layout.tsx`: add `<ThemeToggle />` in the header (44px, hidden label under 420px).
- `app-sidebar.tsx`: tooltip "Device, encryption, vault, appearance"; footer copy
  "Sidecar mode — `.env` stays the source of truth. Encrypted backups live in
  `~/.env-manager/vault.db`." Remove the `local` badge.
- Global copy sweep: replace "cloud", "Supabase", "server sees ciphertext", "sign in",
  "push/pull" with "vault", "back up/restore", "bundle", "import/export".
- All in-app shell hints → pnpm (`pnpm tauri dev`).

## 7.6 Invariants to preserve while touching screens

- Never write to disk without an explicit user action (Save, Restore, Import).
- Every overwrite path backs up first.
- Locked state disables crypto actions but never the editor/save.
- No action re-reads `.env` contents into any store unencrypted.
- Keep `joinPath` / Windows separator handling centralised (consider moving to
  `src/lib/paths.ts` and testing it).

## Verification

- `Select-String` for `Supabase|cloud|Cloud|GitHub|sign in|local-only|keychain` over `src/`
  → only harmless words like "cloud" in comments must be gone.
- Keyboard: Tab reaches every action; Enter activates; Escape closes diff/preview cards
  where provided.
- 360px: no horizontal scroll on any screen; long paths truncate with `truncate` + `title`.
- Locked → Save works, Back up/Restore/Export disabled with a visible hint.
```