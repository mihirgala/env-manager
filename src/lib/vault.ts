/**
 * Local vault — P1. Pure TS client over a storage driver.
 *
 * The default driver calls the Tauri backend (SQLite `~/.env-manager/vault.db`
 * + `links.json`), so this module keeps zero Tauri imports and stays
 * testable with the in-memory driver. Nothing is ever written into target
 * user repos; `removeProject` unlinks vault rows only and leaves `.env`
 * files intact.
 */

import * as tauri from './tauri'

export interface ProjectRecord {
  id: string
  /** Normalized identity, e.g. `github.com/foo/bar`, or a manual UUID. */
  identity: string
  displayName: string
  folderPath: string
  localOnly: boolean
  createdAt: string
}

export interface EnvSetRecord {
  id: string
  projectId: string
  /** e.g. `.env`, `.env.local` (multi-file sets land in P3). */
  fileName: string
  sha256: string
  updatedAt: string
}

export interface VaultDriver {
  projectAdd(input: { identity: string; displayName: string; folderPath: string }): Promise<ProjectRecord>
  projectList(): Promise<ProjectRecord[]>
  projectGet(id: string): Promise<ProjectRecord | null>
  projectRemove(id: string): Promise<void>
  projectSetLocalOnly(id: string, localOnly: boolean): Promise<void>
  envsetUpsert(input: { projectId: string; fileName: string; sha256: string }): Promise<EnvSetRecord>
  envsetList(projectId: string): Promise<EnvSetRecord[]>
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

  async setLocalOnly(id: string, localOnly: boolean): Promise<ProjectRecord | null> {
    await this.driver.projectSetLocalOnly(id, localOnly)
    return this.driver.projectGet(id)
  }

  recordEnvSet(projectId: string, fileName: string, sha256: string): Promise<EnvSetRecord> {
    return this.driver.envsetUpsert({ projectId, fileName, sha256 })
  }

  listEnvSets(projectId: string): Promise<EnvSetRecord[]> {
    return this.driver.envsetList(projectId)
  }
}

/** In-memory driver for tests and `npm run dev` without Tauri. */
export function createMemoryDriver(): VaultDriver & { projects: ProjectRecord[] } {
  const projects: ProjectRecord[] = []
  const envSets: EnvSetRecord[] = []
  let n = 0
  const nextId = (): string => `mem-${++n}`

  return {
    projects,
    async projectAdd(input) {
      const existing = projects.find((p) => p.identity === input.identity)
      if (existing !== undefined) {
        existing.folderPath = input.folderPath
        return existing
      }
      const row: ProjectRecord = {
        id: nextId(),
        createdAt: new Date(0).toISOString(),
        localOnly: false,
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
      for (let j = envSets.length - 1; j >= 0; j--) {
        if (envSets[j]?.projectId === id) envSets.splice(j, 1)
      }
    },
    async projectSetLocalOnly(id, localOnly) {
      const row = projects.find((p) => p.id === id)
      if (row !== undefined) row.localOnly = localOnly
    },
    async envsetUpsert(input) {
      const existing = envSets.find(
        (e) => e.projectId === input.projectId && e.fileName === input.fileName,
      )
      if (existing !== undefined) {
        existing.sha256 = input.sha256
        return existing
      }
      const row: EnvSetRecord = {
        id: nextId(),
        updatedAt: new Date(0).toISOString(),
        ...input,
      }
      envSets.push(row)
      return row
    },
    async envsetList(projectId) {
      return envSets.filter((e) => e.projectId === projectId)
    },
  }
}

/** Default driver — live Tauri backend. Throws a clear error under `npm run dev`. */
export function createTauriDriver(): VaultDriver {
  // Static import is safe: `./tauri` (the only module allowed to touch
  // `@tauri-apps/*`) imports those packages dynamically at call time only.
  return {
    projectAdd: (input) => tauri.projectAdd(input),
    projectList: () => tauri.projectList(),
    projectGet: (id) => tauri.projectGet(id),
    projectRemove: (id) => tauri.projectRemove(id),
    projectSetLocalOnly: (id, localOnly) => tauri.projectSetLocalOnly(id, localOnly),
    envsetUpsert: (input) => tauri.envsetUpsert(input),
    envsetList: (projectId) => tauri.envsetList(projectId),
  }
}
