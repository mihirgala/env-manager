# Step 5 — scan a parent folder (repos + monorepo subfolders)

Goal: pick `~/projects` and get every project that has real env files, in one bulk add.
Read-only walk: names + git remotes only, never file contents, never writes.

## 5.1 Identity scheme (portable)

| Case | Identity | Display name |
|---|---|---|
| Repo root | `github.com/foo/bar` | `bar` |
| Monorepo subfolder | `github.com/foo/bar::apps/web` | `bar / apps/web` |
| Non-git folder (opt-in) | manual link id (existing `detectIdentity` fallback) | folder basename + "local" badge |

Separator is `::`. Subpath normalization: backslashes → `/`, strip leading `./`, collapse
duplicate slashes, no leading/trailing slash, preserve case.

Add to `src/lib/identity.ts`:

```ts
export function withSubpath(identity: string, subpath: string): string
export function splitSubpath(identity: string): { identity: string; subpath: string }
```

`projects.identity` remains `UNIQUE`, so each subfolder is a distinct project — which is
required anyway because crypto keys are per identity+fileName.

## 5.2 Env-file policy (`src/lib/env-files.ts`, new)

Single source of truth used by tabs, scan, status, export, bundles:

```ts
export function isTrackableEnvFile(name: string): boolean
export function trackableEnvFiles(names: string[]): string[]
```

- Accept: `.env`, `.env.local`, `.env.development`, `.env.development.local`,
  `.env.production`, `.env.test`, `.env.staging`, any `.env.<segment(s)>`.
- Reject: `.env.example`, `.env.example.*`, `.env.sample`, `.env.template`, `.env.dist`,
  `.env.backup-*`, `*.backup-*`, `.envrc`, directories.
- Case-insensitive comparison (Windows), return the original name.
- Rust's `list_env_files` may keep returning raw names; filter in TS before rendering tabs.
  (Optionally move the filter into Rust later — do not duplicate the rules.)

## 5.3 Rust scan command (`src-tauri/src/main.rs`)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanRow {
    folder_path: String,
    repo_root: String,          // nearest ancestor with .git, or the folder itself when non-git
    repo_subpath: String,       // "" for repo root, posix separators otherwise
    git_remote: Option<String>, // from repo root, one call per repo
    env_files: Vec<String>,     // raw file names found directly in this folder
}

#[tauri::command]
async fn scan_env_projects(root: String, max_depth: u32, skip_dirs: Vec<String>) -> Result<Vec<ScanRow>, String>

#[tauri::command]
fn scan_cancel(app: AppHandle) -> ()
```

- Implement as `tauri::async_runtime::spawn_blocking` so the UI stays responsive.
- Walk rules: do not follow symlinks; do not descend into `.git`; skip any directory whose
  name is in `skip_dirs` or starts with `.`; skip on permission errors; cap depth
  (default 3) and total visited dirs (~20,000) then return what was found.
- Cache `git remote get-url origin` per repo root (reuse the `Command::new("git")` pattern;
  failure → `None`, never an error).
- Progress: `app.emit("scan://progress", { scanned, found })` every 200 dirs.
- Cancel: `State<ScanCancel>` with `AtomicBool`; reset at scan start; check every N dirs.
- Return rows even when `env_files` is empty? No — only rows with ≥1 raw `.env*` name; TS
  applies the real policy. Keep the payload small.

TS adapter: `scanEnvProjects({ root, maxDepth, skipDirs })`, `cancelScan()`, plus a
`listenScanProgress(cb)` wrapper (dynamic import of `@tauri-apps/api/event`).

## 5.4 TS candidate builder (`src/lib/scan.ts`, new)

```ts
export const DEFAULT_SKIP_DIRS = [
  'node_modules','target','dist','build','out','.next','.nuxt','.turbo','.svelte-kit',
  'coverage','vendor','Pods','.venv','venv','__pycache__','.cache','.idea','.vscode',
]

export interface ScanCandidate {
  identity: string; displayName: string; folderPath: string
  repoRoot: string; subpath: string; gitRemote: string | null
  envFiles: string[]; isGit: boolean
  duplicateOf?: string      // identity already in vault → its project id
  duplicateInScan?: boolean
}

export function buildScanCandidates(raw: ScanRow[], existing: ProjectRecord[], opts: { includeNonGit: boolean }): ScanCandidate[]
```

- Filter rows with `trackableEnvFiles(row.env_files).length > 0`.
- Non-git: only when `includeNonGit`; generate/detect a manual identity and mark `isGit: false`.
- Dedupe by identity; first wins, later duplicates get `duplicateInScan: true` (the UI shows
  them disabled with "duplicate of <path>").
- Sort: repos first, then subpath, then name.

## 5.5 UI (`src/screens/add-project.tsx` rebuilt)

Two tabs: **Add one folder** (existing flow, minus cloud) and **Scan a parent folder**.

Scan tab:

1. Parent folder input + **Browse…** (`pickProjectFolder`), depth select (2/3/4), toggle
   "Include folders without git", **Scan** button.
2. While scanning: progress line "Scanning… 1,240 folders · 18 found", Cancel button.
3. Results header: "24 found · 19 new · 5 already added" + search filter + select all/none.
4. Results list — mobile cards, `min-[720px]` table rows. Each row: checkbox, name,
   `identity` in mono, path, env chips, badges (`already added`, `no git remote`,
   `duplicate`, `monorepo`).
5. Sticky action bar (wraps at 360px): "Add 19 projects" + checkbox
   "Back up their env files after adding" (disabled with hint when locked).
6. Bulk add: sequential `vault.addProject` + `links.json` entry per folder; skip
   `duplicateOf`; optional `backupToVault` per file (step 3.5). Summarize: added / skipped /
   backed up / failed. Then navigate to `/` (list), not into a single project.
7. Empty result: "No projects with env files found under <path>" + hint to raise depth or
   toggle non-git.

Accessibility/responsive: every control ≥44px, checkboxes labelled by name, status text not
color-only, list scrolls with the page, action bar stays reachable.

## 5.6 Tests (`src/lib/env-files.test.ts`, `src/lib/scan.test.ts`)

- `.env.example` / `.env.example.local` / `.env.sample` / `.env.template` / `.env.dist` /
  `.env.backup-123` rejected; `.env`, `.env.local`, `.env.development`,
  `.env.development.local`, `.env.production` accepted; `.envrc` rejected.
- Root repo identity equals normalized remote; subfolder gets `::apps/web`.
- Duplicate identity across two checkouts → one candidate, second flagged.
- `includeNonGit: false` drops non-git rows; `true` keeps them with `isGit: false`.
- Skip-list is passed to Rust verbatim (assert adapter args).
- Path normalization on Windows (`apps\web`, `./apps/web/`) → same identity.
- Scan row with only example files produces no candidate.

## Verification

Manual: create a temp tree with `repo-a/.git` + `.env`, `repo-a/.env.example`,
`repo-b/.git` + `apps/web/.env.local`, `plain-folder/.env`, `node_modules/x/.env`.
Scan → expect repo-a, `repo-a::apps/web`? (only if deep enough), plain-folder hidden until
toggled; no example rows.

```powershell
pnpm test src/lib/env-files.test.ts src/lib/scan.test.ts
pnpm build
```
