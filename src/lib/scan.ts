/**
 * Parent-folder scan → project candidates. Pure TS: Rust walks the tree and
 * returns names/git remotes only; this module applies the env-file policy,
 * builds portable identities, drops template-only folders and flags
 * duplicates. No file contents are read and nothing is written.
 */

import { trackableEnvFiles } from './env-files'
import {
  detectIdentity,
  normalizeGitRemote,
  normalizeSubpath,
  withSubpath,
} from './identity'
import { folderKey } from './paths'
import type { ScanRow } from './tauri'
import type { ProjectRecord } from './vault'

export const DEFAULT_SKIP_DIRS = [
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.svelte-kit',
  'coverage',
  'vendor',
  'Pods',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.idea',
  '.vscode',
]

export interface ScanCandidate {
  identity: string
  displayName: string
  folderPath: string
  repoRoot: string
  subpath: string
  gitRemote: string | null
  envFiles: string[]
  isGit: boolean
  /** Identity already in the vault → existing project id. */
  duplicateOf?: string
  /** Another row in this scan claimed the same identity first. */
  duplicateInScan?: boolean
}

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) ?? path
}

function displayFor(repoName: string, subpath: string): string {
  return subpath === '' ? repoName : `${repoName} / ${subpath}`
}

/** Manual UUID link for a folder without a usable remote. */
function manualIdentity(folderPath: string): string {
  const detected = detectIdentity({ folderPath })
  return detected.kind === 'manual' ? detected.id : detected.identity
}

export function buildScanCandidates(
  raw: ScanRow[],
  existing: ProjectRecord[],
  opts: { includeNonGit: boolean },
): ScanCandidate[] {
  const existingByIdentity = new Map(existing.map((project) => [project.identity, project]))
  // Manual (non-git / no-origin) identities are random UUIDs, so a re-scan
  // matches the existing link by folder instead of minting a new one.
  const existingByFolder = new Map(existing.map((project) => [folderKey(project.folderPath), project]))
  const firstByIdentity = new Map<string, ScanCandidate>()
  const out: ScanCandidate[] = []

  for (const row of raw) {
    const envFiles = trackableEnvFiles(row.envFiles)
    if (envFiles.length === 0) continue

    const subpath = normalizeSubpath(row.repoSubpath)
    const isGit = row.isGit ?? (row.gitRemote !== null || subpath !== '')
    if (!isGit && !opts.includeNonGit) continue

    let identity: string
    let displayName: string
    let gitRemote: string | null = row.gitRemote

    let remoteIdentity: string | null = null
    if (isGit && row.gitRemote !== null && row.gitRemote.trim() !== '') {
      try {
        remoteIdentity = normalizeGitRemote(row.gitRemote)
      } catch {
        remoteIdentity = null
        gitRemote = null
      }
    }

    if (remoteIdentity !== null) {
      const repoName = remoteIdentity.split('/').at(-1) ?? baseName(row.repoRoot)
      identity = withSubpath(remoteIdentity, subpath)
      displayName = displayFor(repoName, subpath)
    } else {
      // Non-git folder, or a git repo without a usable origin: portable
      // identity falls back to the manual UUID link (never in the repo).
      // Reuse the existing link when this folder is already in the vault.
      const prior = existingByFolder.get(folderKey(row.folderPath))
      identity = prior?.identity ?? manualIdentity(row.folderPath)
      const repoName = subpath === '' ? baseName(row.folderPath) : baseName(row.repoRoot)
      displayName = displayFor(repoName, subpath)
    }

    const candidate: ScanCandidate = {
      identity,
      displayName,
      folderPath: row.folderPath,
      repoRoot: row.repoRoot,
      subpath,
      gitRemote,
      envFiles,
      isGit,
    }

    if (firstByIdentity.has(identity)) {
      candidate.duplicateInScan = true
      out.push(candidate)
      continue
    }

    const vaultMatch = existingByIdentity.get(identity)
    if (vaultMatch !== undefined) candidate.duplicateOf = vaultMatch.id

    firstByIdentity.set(identity, candidate)
    out.push(candidate)
  }

  return out.sort(
    (a, b) =>
      Number(b.isGit) - Number(a.isGit) ||
      a.subpath.localeCompare(b.subpath) ||
      a.displayName.localeCompare(b.displayName),
  )
}
