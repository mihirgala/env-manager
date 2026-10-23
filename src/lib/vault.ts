/**
 * Local vault — project rows only. Pure TS client over a storage driver.
 *
 * The default driver calls the Tauri backend (SQLite `~/.env-manager/vault.db`
 * + `links.json`), so this module keeps zero Tauri imports and stays
 * testable with the in-memory driver. Nothing is ever written into target
 * user repos; `removeProject` unlinks vault rows only and leaves `.env`
 * files intact. Encrypted snapshots live in `./store`.
 */

import * as tauri from './tauri'

export interface ProjectRecord {
  id: string
  /** Normalized identity, e.g. `github.com/foo/bar`, or a manual UUID. */
  identity: string
  displayName: string
  folderPath: string
  createdAt: string
}

export interface VaultDriver {
  projectAdd(input: { identity: string; displayName: string; folderPath: string }): Promise<ProjectRecord>
  projectList(): Promise<ProjectRecord[]>
  projectGet(id: string): Promise<ProjectRecord | null>
  projectRemove(id: string): Promise<void>
}

export class Vault {
  private readonly driver: VaultDriver

  constructor(driver: VaultDriver) {
    this.driver = driver
  }

  listProjects(): Promise<ProjectRecord[]> {
    return this.driver.projectList()
  }

  async addProject(input: { identity: string; displayName: string; folderPath: string }): Promise<ProjectRecord> {
    if (input.identity.trim() === '') throw new Error('vault: identity is required')
    if (input.folderPath.trim() === '') throw new Error('vault: folderPath is required')
    return this.driver.projectAdd(input)
  }

  getProject(id: string): Promise<ProjectRecord | null> {
    return this.driver.projectGet(id)
  }

  /** Unlink only — `.env` files on disk are never touched. */
  removeProject(id: string): Promise<void> {
    return this.driver.projectRemove(id)
  }
}

/** In-memory driver for tests and `pnpm dev` without Tauri. */
export function createMemoryDriver(): VaultDriver & { projects: ProjectRecord[] } {
  const projects: ProjectRecord[] = []
  let n = 0
  const nextId = (): string => `mem-${++n}`

  return {
    projects,
    async projectAdd(input) {
      const existing = projects.find((p) => p.identity === input.identity)
      // Duplicate identities keep their original folder — re-pointing would
      // move snapshots to the wrong repo (the scan UI explains duplicates).
      if (existing !== undefined) return existing
      const row: ProjectRecord = {
        id: nextId(),
        createdAt: new Date(0).toISOString(),
        ...input,
      }
      projects.push(row)
      return row
    },
    async projectList() {
      return [...projects].sort((a, b) => a.displayName.localeCompare(b.displayName))
    },
    async projectGet(id) {
      return projects.find((p) => p.id === id) ?? null
    },
    async projectRemove(id) {
      const i = projects.findIndex((p) => p.id === id)
      if (i !== -1) projects.splice(i, 1)
    },
  }
}

/** Default driver — live Tauri backend. Throws a clear error under `pnpm dev`. */
export function createTauriDriver(): VaultDriver {
  // Static import is safe: `./tauri` (the only module allowed to touch
  // `@tauri-apps/*`) imports those packages dynamically at call time only.
  return {
    projectAdd: (input) => tauri.projectAdd(input),
    projectList: () => tauri.projectList(),
    projectGet: (id) => tauri.projectGet(id),
    projectRemove: (id) => tauri.projectRemove(id),
  }
}
