/**
 * Encrypted snapshot engine — pure TS over an injected snapshot store and
 * injected file IO, so every path is unit-testable. The store is local
 * (`~/.env-manager/vault.db`); nothing here touches a network.
 *
 * Rules (repo guardrails): restore shows a diff preview and never silently
 * overwrites — it writes `.env.backup-<ts>` first. Plaintext / keys never
 * leave this module except into the caller's files.
 */

import { decryptFile, encryptFile, isUnlocked } from './crypto'
import { effectiveValue, parse } from './dotenv'
import { sha256Hex } from './hash'
import type { SnapshotSource, SnapshotStore } from './store'

export type VaultStatus = 'locked' | 'not-backed-up' | 'backed-up' | 'changed'

export interface DiffPreview {
  added: string[]
  removed: string[]
  changed: string[]
}

export interface FileIO {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  backupFile(path: string): Promise<string>
}

/** Leaf name of a path (the DEK/AAD binding for a file). */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? '.env'
}

function keyValues(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const entry of parse(text).entries) {
    if (entry.type === 'pair') values.set(entry.key, effectiveValue(entry))
  }
  return values
}

/** Key-level diff between local plaintext and decrypted snapshot plaintext. */
export function previewDiff(localText: string, remoteText: string): DiffPreview {
  const localKeys = keyValues(localText)
  const remoteKeys = keyValues(remoteText)
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
  store: SnapshotStore
  io: FileIO
}

async function readIfPresent(io: FileIO, path: string): Promise<{ text: string; exists: boolean }> {
  try {
    return { text: await io.readFile(path), exists: true }
  } catch {
    return { text: '', exists: false }
  }
}

export interface FileTarget {
  projectId: string
  identity: string
  filePath: string
  fileName: string
}

/**
 * Back up: read file → sha → encrypt under `identity:fileName` → append row.
 * Throws while locked (crypto) — callers keep the disk write independent.
 */
export async function backupToVault(
  ctx: SyncContext,
  opts: FileTarget,
): Promise<{ sha256: string }> {
  const text = await ctx.io.readFile(opts.filePath)
  const sha256 = await sha256Hex(text)
  const envelope = await encryptFile(opts.identity, opts.fileName, text)
  await ctx.store.put({
    projectId: opts.projectId,
    fileName: opts.fileName,
    envelope,
    plaintextSha256: sha256,
    source: 'local',
  })
  return { sha256 }
}

export interface RestorePlan {
  diff: DiffPreview
  conflict: boolean
  snapshotAt: string
  source: SnapshotSource
  sha256: string
}

/**
 * Plan a restore: decrypt the latest snapshot and compare it with disk.
 * Applying is the caller's explicit step — see `applyRestore` — so nothing
 * is ever silently overwritten.
 */
export async function planRestore(
  ctx: SyncContext,
  opts: FileTarget,
): Promise<RestorePlan | null> {
  const snap = await ctx.store.latest(opts.projectId, opts.fileName)
  if (snap === null) return null
  const storedText = await decryptFile(opts.identity, opts.fileName, snap.envelope)
  const local = await readIfPresent(ctx.io, opts.filePath)
  const diff = previewDiff(local.text, storedText)
  // Local edits exist that the latest snapshot does not know about.
  const conflict =
    local.exists &&
    (await sha256Hex(local.text)) !== snap.plaintextSha256 &&
    !isCleanDiff(diff)
  return {
    diff,
    conflict,
    snapshotAt: snap.createdAt,
    source: snap.source,
    sha256: snap.plaintextSha256,
  }
}

/**
 * Write a complete dotenv document after backing up the existing file, then
 * append a snapshot under `source`. Never overwrites without a backup (when
 * a file exists) and never stores plaintext.
 */
async function commitText(
  ctx: SyncContext,
  opts: FileTarget,
  text: string,
  source: SnapshotSource,
): Promise<{ backupPath: string | null; sha256: string }> {
  let backupPath: string | null = null
  try {
    await ctx.io.readFile(opts.filePath)
    backupPath = await ctx.io.backupFile(opts.filePath)
  } catch {
    backupPath = null
  }
  await ctx.io.writeFile(opts.filePath, text)
  const sha256 = await sha256Hex(text)
  const envelope = await encryptFile(opts.identity, opts.fileName, text)
  await ctx.store.put({
    projectId: opts.projectId,
    fileName: opts.fileName,
    envelope,
    plaintextSha256: sha256,
    source,
  })
  return { backupPath, sha256 }
}

/**
 * Apply the latest snapshot: back up the existing file, write decrypted
 * text, then record a fresh local snapshot so status returns to `backed-up`.
 */
export async function applyRestore(
  ctx: SyncContext,
  opts: FileTarget,
): Promise<{ backupPath: string | null; sha256: string }> {
  const snap = await ctx.store.latest(opts.projectId, opts.fileName)
  if (snap === null) throw new Error('sync: no stored snapshot to restore')
  const storedText = await decryptFile(opts.identity, opts.fileName, snap.envelope)
  return commitText(ctx, opts, storedText, 'local')
}

/**
 * Apply text from a plaintext import. Backs up an existing file
 * first and records the snapshot as `source: 'import'`.
 */
export async function applyImportedText(
  ctx: SyncContext,
  opts: FileTarget & { text: string },
): Promise<{ backupPath: string | null; sha256: string }> {
  return commitText(ctx, opts, opts.text, 'import')
}

/** `locked` | `not-backed-up` | `backed-up` | `changed` — exactly four states. */
export async function projectStatus(
  ctx: SyncContext,
  opts: FileTarget,
): Promise<VaultStatus> {
  if (!isUnlocked()) return 'locked'
  const snap = await ctx.store.latest(opts.projectId, opts.fileName)
  if (snap === null) return 'not-backed-up'
  const local = await readIfPresent(ctx.io, opts.filePath)
  if (!local.exists) return 'changed'
  return (await sha256Hex(local.text)) === snap.plaintextSha256 ? 'backed-up' : 'changed'
}
