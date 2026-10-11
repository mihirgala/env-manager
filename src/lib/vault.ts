/**
 * Local vault — P1. Typed stubs only.
 *
 * P1 will back this with SQLite at `~/.env-manager/vault.db` (via `rusqlite`
 * in the Tauri backend) plus `links.json` (folder → project mapping) and
 * `config.json`. Nothing is ever written into target user repos.
 */

export interface ProjectRecord {
  id: string
  /** Normalized identity, e.g. `github.com/foo/bar`, or a manual UUID. */
  identity: string
  displayName: string
  folderPath: string
  localOnly: boolean
}

export interface EnvSetRecord {
  id: string
  projectId: string
  /** e.g. `.env`, `.env.local` (multi-file sets land in P3). */
  fileName: string
  sha256: string
  updatedAt: string
}

function notImplemented(name: string): never {
  throw new Error(`vault: ${name} not implemented until P1`)
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return notImplemented('listProjects')
}

export async function addProject(
  _input: Pick<ProjectRecord, 'identity' | 'displayName' | 'folderPath'>,
): Promise<ProjectRecord> {
  return notImplemented('addProject')
}

export async function getProject(_id: string): Promise<ProjectRecord | null> {
  return notImplemented('getProject')
}

export async function removeProject(_id: string): Promise<void> {
  // P1 must keep the `.env` files on disk intact — unlink only.
  return notImplemented('removeProject')
}
