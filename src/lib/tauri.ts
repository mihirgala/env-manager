/**
 * Tauri ↔ TS adapter — the ONLY module allowed to import `@tauri-apps/*`.
 *
 * Everything else in `src/lib` stays pure so `pnpm dev` works without
 * Rust: outside Tauri this module falls back to mocks / clear errors.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function needsTauri(what: string): never {
  throw new Error(`${what} needs the desktop app — run \`pnpm tauri dev\` (Tauri + Rust)`)
}

/** Folder picker. Returns the selected path, or null when cancelled. */
export async function pickProjectFolder(): Promise<string | null> {
  if (!isTauri()) {
    // Dev fallback so `pnpm dev` works without Rust: a real `<button>`
    // already triggered this, `prompt` keeps it keyboard-accessible.
    const manual = window.prompt('Project folder path (dev fallback — picker needs `tauri dev`):')
    return manual?.trim() ? manual.trim() : null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

export interface DialogFilter {
  name: string
  extensions: string[]
}

/** Save dialog (bundles / plaintext exports). Returns null when cancelled. */
export async function pickSaveFile(
  defaultName: string,
  filters: DialogFilter[],
): Promise<string | null> {
  if (!isTauri()) {
    const manual = window.prompt('Save to path (dev fallback — dialog needs `tauri dev`):', defaultName)
    return manual?.trim() ? manual.trim() : null
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const picked = await save({ defaultPath: defaultName, filters })
  return typeof picked === 'string' ? picked : null
}

/** Open dialog (bundle / plaintext import). Returns null when cancelled. */
export async function pickOpenFile(filters: DialogFilter[]): Promise<string | null> {
  if (!isTauri()) {
    const manual = window.prompt('File path (dev fallback — dialog needs `tauri dev`):')
    return manual?.trim() ? manual.trim() : null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ multiple: false, filters })
  return typeof picked === 'string' ? picked : null
}

export interface ProjectRow {
  id: string
  identity: string
  displayName: string
  folderPath: string
  createdAt: string
}

/** Opaque snapshot row as stored in SQLite (`envelope` is JSON text). */
export interface SnapshotWire {
  id: string
  projectId: string
  fileName: string
  envelope: string
  plaintextSha256: string
  source: 'local' | 'import'
  createdAt: string
}

export interface FileStat {
  mtimeMs: number
  size: number
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) needsTauri(command)
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export async function readEnvFile(path: string): Promise<string> {
  return invoke<string>('read_env_file', { path })
}

export async function writeEnvFile(path: string, content: string): Promise<void> {
  await invoke('write_env_file', { path, content })
}

/** Returns the `origin` remote URL, or null when the folder has no remote. */
export async function getGitRemote(folderPath: string): Promise<string | null> {
  return invoke<string | null>('git_remote_get_url', { path: folderPath })
}

/** OS device name (hostname) for snapshot labels. */
export async function getDeviceName(): Promise<string> {
  return invoke<string>('device_name')
}

/** `.env*` file names directly inside a folder, sorted. */
export async function listEnvFiles(folderPath: string): Promise<string[]> {
  return invoke<string[]>('list_env_files', { folderPath })
}

/** mtime + size, or null when missing. Basis of the P1 watcher poll. */
export async function fileStat(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>('file_stat', { path })
}

/** One folder produced by the read-only parent-folder scan. */
export interface ScanRow {
  folderPath: string
  repoRoot: string
  repoSubpath: string
  gitRemote: string | null
  /** Raw `.env*` names directly in the folder — TS applies the policy. */
  envFiles: string[]
  /** Present from Rust; optional so tests can use minimal rows. */
  isGit?: boolean
}

export interface ScanProgress {
  scanned: number
  found: number
}

export async function scanEnvProjects(input: {
  root: string
  maxDepth: number
  skipDirs: string[]
}): Promise<ScanRow[]> {
  return invoke<ScanRow[]>('scan_env_projects', input)
}

export async function cancelScan(): Promise<void> {
  await invoke('scan_cancel')
}

/** Subscribe to progress; returns the unlisten function. */
export async function listenScanProgress(
  callback: (progress: ScanProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<ScanProgress>('scan://progress', (event) => callback(event.payload))
}

/** Copies `<path>` to `<path>.backup-<ts>`; returns the backup path. */
export async function backupEnvFile(path: string): Promise<string> {
  return invoke<string>('backup_env_file', { path })
}

export async function projectAdd(input: {
  identity: string
  displayName: string
  folderPath: string
}): Promise<ProjectRow> {
  return invoke<ProjectRow>('project_add', input)
}

export async function projectList(): Promise<ProjectRow[]> {
  return invoke<ProjectRow[]>('project_list')
}

export async function projectGet(id: string): Promise<ProjectRow | null> {
  return invoke<ProjectRow | null>('project_get', { id })
}

/** Unlinks the project. Vault rows only — `.env` files stay intact. */
export async function projectRemove(id: string): Promise<void> {
  await invoke('project_remove', { id })
}

export async function snapshotPut(input: {
  projectId: string
  fileName: string
  envelope: string
  plaintextSha256: string
  source: 'local' | 'import'
}): Promise<SnapshotWire> {
  return invoke<SnapshotWire>('snapshot_put', input)
}

export async function snapshotLatest(
  projectId: string,
  fileName: string,
): Promise<SnapshotWire | null> {
  return invoke<SnapshotWire | null>('snapshot_latest', { projectId, fileName })
}

export async function snapshotList(
  projectId: string,
  fileName: string,
  limit = 20,
): Promise<SnapshotWire[]> {
  return invoke<SnapshotWire[]>('snapshot_list', { projectId, fileName, limit })
}

export async function snapshotDelete(id: string): Promise<void> {
  await invoke('snapshot_delete', { id })
}

export async function linksRead(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('links_read')
}

export async function linksWrite(value: Record<string, string>): Promise<void> {
  await invoke('links_write', { value })
}

/** Whole `config.json` as a plain object (TS owns the shape). */
export async function configRead(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('config_read')
}

export async function configWrite(value: Record<string, unknown>): Promise<void> {
  await invoke('config_write', { value })
}
