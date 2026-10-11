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

export async function readEnvFile(path: string): Promise<string> {
  if (!isTauri()) needsTauri('readEnvFile')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('read_env_file', { path })
}

export async function writeEnvFile(path: string, content: string): Promise<void> {
  if (!isTauri()) needsTauri('writeEnvFile')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_env_file', { path, content })
}

/** Returns the `origin` remote URL, or null when the folder has no remote. */
export async function getGitRemote(folderPath: string): Promise<string | null> {
  if (!isTauri()) needsTauri('getGitRemote')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('git_remote_get_url', { path: folderPath })
}
