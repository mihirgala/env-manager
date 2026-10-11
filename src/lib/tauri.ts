/**
 * Tauri ↔ TS adapter — the ONLY module allowed to import `@tauri-apps/*`.
 *
 * Everything else in `src/lib` stays pure so `npm run dev` works without
 * Rust: outside Tauri this module falls back to mocks / clear errors.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function needsTauri(what: string): never {
  throw new Error(`${what} needs the desktop app — run \`npm run tauri dev\` (Tauri + Rust)`)
}

/** Folder picker. Returns the selected path, or null when cancelled. */
export async function pickProjectFolder(): Promise<string | null> {
  if (!isTauri()) {
    // Dev fallback so `npm run dev` works without Rust: a real `<button>`
    // already triggered this, `prompt` keeps it keyboard-accessible.
    const manual = window.prompt('Project folder path (dev fallback — picker needs `tauri dev`):')
    return manual?.trim() ? manual.trim() : null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

export interface ProjectRow {
  id: string
  identity: string
  displayName: string
  folderPath: string
  localOnly: boolean
  createdAt: string
}

export interface EnvSetRow {
  id: string
  projectId: string
  fileName: string
  sha256: string
  updatedAt: string
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

export async function projectSetLocalOnly(id: string, localOnly: boolean): Promise<void> {
  await invoke('project_set_local_only', { id, localOnly })
}

export async function envsetUpsert(input: {
  projectId: string
  fileName: string
  sha256: string
}): Promise<EnvSetRow> {
  return invoke<EnvSetRow>('envset_upsert', input)
}

export async function envsetList(projectId: string): Promise<EnvSetRow[]> {
  return invoke<EnvSetRow[]>('envset_list', { projectId })
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

export async function keychainSet(service: string, account: string, secret: string): Promise<void> {
  await invoke('keychain_set', { service, account, secret })
}

export async function keychainGet(service: string, account: string): Promise<string | null> {
  return invoke<string | null>('keychain_get', { service, account })
}

export async function keychainDelete(service: string, account: string): Promise<void> {
  await invoke('keychain_delete', { service, account })
}

/**
 * OAuth sign-in runs through the system browser + a pasted code
 * (see `src/components/github-sign-in.tsx`). Kept for a future deep-link
 * return path; the popup flow is currently unused.
 */
export async function openOAuthWindow(url: string): Promise<void> {
  await invoke('open_oauth_window', { url })
}

/** Take (and clear) the pending OAuth `code`, or null when none yet. */
export async function takeOAuthCode(): Promise<string | null> {
  return invoke<string | null>('take_oauth_code')
}

export async function closeOAuthWindow(): Promise<void> {
  await invoke('close_oauth_window').catch(() => {})
}

export async function isOAuthWindowOpen(): Promise<boolean> {
  return invoke<boolean>('is_oauth_window_open')
}

/** Open a URL in the system browser (sign-in flow). */
export async function openInBrowser(url: string): Promise<void> {
  await invoke('open_in_browser', { url })
}
