/**
 * Bulk "Back up all" over every linked project. Pure TS with injected IO so
 * the policy (which files count, how failures aggregate) is unit-testable.
 *
 * The caller supplies the encrypted backup operation — normally
 * `backupToVault` — so this module never touches crypto, Tauri, or disk.
 */

import { trackableEnvFiles } from './env-files'
import { joinPath } from './paths'
import type { ProjectRecord } from './vault'

export interface BackupAllDeps {
  listProjects(): Promise<ProjectRecord[]>
  listEnvFiles(folderPath: string): Promise<string[]>
  backup(input: { project: ProjectRecord; fileName: string; filePath: string }): Promise<void>
}

export interface BackupFailure {
  project: string
  fileName: string
  message: string
}

export interface BackupAllResult {
  /** Files written to the vault. */
  backedUp: number
  /** Files that could not be read/encrypted/stored. */
  failed: number
  /** Projects with no trackable env files (nothing to do). */
  skippedProjects: number
  failures: BackupFailure[]
}

/**
 * Back up every trackable env file in every project. A project with no
 * `.env`/`.env.*` files (templates excluded) is skipped, and one bad file
 * never stops the rest.
 */
export async function backupAllProjects(deps: BackupAllDeps): Promise<BackupAllResult> {
  const projects = await deps.listProjects()
  const result: BackupAllResult = {
    backedUp: 0,
    failed: 0,
    skippedProjects: 0,
    failures: [],
  }

  for (const project of projects) {
    let names: string[] = []
    try {
      names = trackableEnvFiles(await deps.listEnvFiles(project.folderPath))
    } catch {
      names = []
    }
    if (names.length === 0) {
      result.skippedProjects += 1
      continue
    }
    for (const fileName of names) {
      try {
        await deps.backup({
          project,
          fileName,
          filePath: joinPath(project.folderPath, fileName),
        })
        result.backedUp += 1
      } catch (err) {
        result.failed += 1
        result.failures.push({
          project: project.displayName,
          fileName,
          message: err instanceof Error ? err.message : 'Backup failed',
        })
      }
    }
  }

  return result
}

/** Human summary for a toast: `Backed up 4 files · 2 projects had no env files · 1 failed`. */
export function describeBackupResult(result: BackupAllResult): string {
  const files = `${result.backedUp} file${result.backedUp === 1 ? '' : 's'}`
  const parts = [`Backed up ${files}`]
  if (result.skippedProjects > 0) {
    parts.push(
      `${result.skippedProjects} project${result.skippedProjects === 1 ? '' : 's'} had no env files`,
    )
  }
  if (result.failed > 0) {
    parts.push(`${result.failed} failed`)
  }
  return parts.join(' · ')
}
