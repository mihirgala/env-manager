/**
 * Encrypted sync — P2. Pure TS engine over an injected `CloudClient` and
 * injected file IO, so every path is unit-testable without Supabase.
 *
 * Rules (repo guardrails): push/pull show a diff preview and never silently
 * overwrite — on conflict the caller writes `.env.backup-<ts>` first.
 * Plaintext / keys never leave this module except into the caller's files.
 */

import { decryptProject, encryptProject, type CryptoEnvelope } from './crypto'
import { getValue, parse } from './dotenv'
import { sha256Hex } from './hash'

export type SyncStatus = 'clean' | 'behind' | 'ahead' | 'diverged' | 'local-only'

export interface DiffPreview {
  added: string[]
  removed: string[]
  changed: string[]
}

export interface CloudProject {
  id: string
  identity: string
  displayName: string | null
}

export interface CloudSnapshot {
  envelope: CryptoEnvelope
  plaintextSha256: string
  deviceName: string | null
  createdAt: string
}

export interface CloudClient {
  listProjects(): Promise<CloudProject[]>
  upsertProject(identity: string, displayName: string): Promise<CloudProject>
  latestSnapshot(projectId: string): Promise<CloudSnapshot | null>
  pushSnapshot(projectId: string, snap: Omit<CloudSnapshot, 'createdAt'>): Promise<void>
}

export class CloudNotConfiguredError extends Error {
  constructor() {
    super('sync: cloud not configured — check Settings → Cloud')
  }
}

export interface FileIO {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  backupFile(path: string): Promise<string>
}

/** Key-level diff between local plaintext and decrypted remote plaintext. */
export function previewDiff(localText: string, remoteText: string): DiffPreview {
  const localKeys = new Map<string, string>()
  for (const e of parse(localText).entries) {
    if (e.type === 'pair') localKeys.set(e.key, getValue(parse(localText), e.key) ?? '')
  }
  const remoteKeys = new Map<string, string>()
  for (const e of parse(remoteText).entries) {
    if (e.type === 'pair') remoteKeys.set(e.key, getValue(parse(remoteText), e.key) ?? '')
  }
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [k, v] of remoteKeys) {
    if (!localKeys.has(k)) added.push(k)
    else if (localKeys.get(k) !== v) changed.push(k)
  }
  for (const k of localKeys.keys()) {
    if (!remoteKeys.has(k)) removed.push(k)
  }
  return { added, removed, changed }
}

function isCleanDiff(d: DiffPreview): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0
}

export interface SyncContext {
  cloud: CloudClient
  io: FileIO
  /** Last cloud sha we successfully pushed/pulled (persisted per env set in P1 vault terms). */
  lastSyncedSha: string | null
}

/**
 * Push: encrypt local file → upload envelope + sha.
 * Returns the new sha. Throws when locked (crypto) or unconfigured (cloud).
 */
export async function pushProject(
  ctx: SyncContext,
  opts: { identity: string; displayName: string; projectId: string; filePath: string; deviceName: string },
): Promise<{ sha256: string }> {
  const localText = await ctx.io.readFile(opts.filePath)
  const sha = await sha256Hex(localText)
  const envelope = await encryptProject(opts.projectId, localText)
  const project = await ctx.cloud.upsertProject(opts.identity, opts.displayName)
  await ctx.cloud.pushSnapshot(project.id, {
    envelope,
    plaintextSha256: sha,
    deviceName: opts.deviceName,
  })
  return { sha256: sha }
}

export interface PullPlan {
  diff: DiffPreview
  conflict: boolean
  remoteSha256: string
}

/**
 * Pull: download + decrypt, compare with local, report a plan.
 * Applying the plan (backup + write) is the caller's explicit step —
 * see `applyPull` — so nothing is ever silently overwritten.
 */
export async function planPull(
  ctx: SyncContext,
  opts: { identity: string; projectId: string; filePath: string },
): Promise<PullPlan | null> {
  const projects = await ctx.cloud.listProjects()
  const match = projects.find((p) => p.identity === opts.identity)
  if (match === undefined) return null
  const snap = await ctx.cloud.latestSnapshot(match.id)
  if (snap === null) return null
  const remoteText = await decryptProject(opts.projectId, snap.envelope)
  let localText = ''
  try {
    localText = await ctx.io.readFile(opts.filePath)
  } catch {
    localText = ''
  }
  const localSha = await sha256Hex(localText)
  const diff = previewDiff(localText, remoteText)
  // Conflict = local edits exist that the cloud doesn't know about.
  const conflict =
    localText !== '' &&
    localSha !== snap.plaintextSha256 &&
    !isCleanDiff(diff) &&
    ctx.lastSyncedSha !== null &&
    localSha !== ctx.lastSyncedSha
  return { diff, conflict, remoteSha256: snap.plaintextSha256 }
}

/** Explicit apply step: backup the local file, then write the decrypted remote text. */
export async function applyPull(
  ctx: SyncContext,
  opts: { identity: string; projectId: string; filePath: string },
): Promise<{ backupPath: string | null; sha256: string }> {
  const projects = await ctx.cloud.listProjects()
  const match = projects.find((p) => p.identity === opts.identity)
  if (match === undefined) throw new Error('sync: project not found in cloud')
  const snap = await ctx.cloud.latestSnapshot(match.id)
  if (snap === null) throw new Error('sync: no cloud snapshot')
  const remoteText = await decryptProject(opts.projectId, snap.envelope)
  let backupPath: string | null = null
  try {
    await ctx.io.readFile(opts.filePath)
    backupPath = await ctx.io.backupFile(opts.filePath)
  } catch {
    backupPath = null
  }
  // Lossless application: remote text is already a complete dotenv document.
  await ctx.io.writeFile(opts.filePath, remoteText)
  return { backupPath, sha256: snap.plaintextSha256 }
}

export async function projectStatus(
  ctx: SyncContext,
  opts: { identity: string; filePath: string; localOnly: boolean },
): Promise<SyncStatus> {
  if (opts.localOnly) return 'local-only'
  let localText = ''
  try {
    localText = await ctx.io.readFile(opts.filePath)
  } catch {
    return 'clean'
  }
  const localSha = await sha256Hex(localText)
  const projects = await ctx.cloud.listProjects().catch(() => null)
  if (projects === null) return 'clean'
  const match = projects.find((p) => p.identity === opts.identity)
  if (match === undefined) return ctx.lastSyncedSha === null ? 'clean' : 'ahead'
  const snap = await ctx.cloud.latestSnapshot(match.id).catch(() => null)
  if (snap === null) return 'ahead'
  if (localSha === snap.plaintextSha256) return 'clean'
  if (ctx.lastSyncedSha === null) return 'diverged'
  if (ctx.lastSyncedSha === snap.plaintextSha256) return 'ahead'
  if (ctx.lastSyncedSha === localSha) return 'behind'
  return 'diverged'
}
