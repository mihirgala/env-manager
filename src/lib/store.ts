/**
 * Snapshot store — append-only encrypted backup rows.
 *
 * The store only ever holds an opaque `CryptoEnvelope` plus the local
 * `plaintext_sha256` used for conflict detection. Envelope JSON is parsed /
 * serialized here (TS); Rust stores it as a string and never looks inside.
 */

import type { CryptoEnvelope } from './crypto'
import * as tauri from './tauri'

export type SnapshotSource = tauri.SnapshotWire['source']

export interface SnapshotRow {
  id: string
  projectId: string
  fileName: string
  envelope: CryptoEnvelope
  /** Hash of the plaintext — local conflict detection only, never exported. */
  plaintextSha256: string
  source: SnapshotSource
  createdAt: string
}

export interface SnapshotStore {
  put(input: {
    projectId: string
    fileName: string
    envelope: CryptoEnvelope
    plaintextSha256: string
    source: SnapshotSource
  }): Promise<SnapshotRow>
  latest(projectId: string, fileName: string): Promise<SnapshotRow | null>
  list(projectId: string, fileName: string, limit?: number): Promise<SnapshotRow[]>
}

/** Rows kept per `(projectId, fileName)`, mirroring the Rust retention. */
export const SNAPSHOT_RETENTION = 20

function fromWire(row: tauri.SnapshotWire): SnapshotRow {
  return {
    id: row.id,
    projectId: row.projectId,
    fileName: row.fileName,
    envelope: JSON.parse(row.envelope) as CryptoEnvelope,
    plaintextSha256: row.plaintextSha256,
    source: row.source,
    createdAt: row.createdAt,
  }
}

/** Default store — live Tauri backend (`~/.env-manager/vault.db`). */
export function createTauriStore(): SnapshotStore {
  return {
    async put(input) {
      const row = await tauri.snapshotPut({
        projectId: input.projectId,
        fileName: input.fileName,
        envelope: JSON.stringify(input.envelope),
        plaintextSha256: input.plaintextSha256,
        source: input.source,
      })
      return fromWire(row)
    },
    async latest(projectId, fileName) {
      const row = await tauri.snapshotLatest(projectId, fileName)
      return row === null ? null : fromWire(row)
    },
    async list(projectId, fileName, limit = SNAPSHOT_RETENTION) {
      const rows = await tauri.snapshotList(projectId, fileName, limit)
      return rows.map(fromWire)
    },
  }
}

export interface MemorySnapshotStore extends SnapshotStore {
  rows: SnapshotRow[]
  /** Mirrors the SQLite `ON DELETE CASCADE` for project-remove tests. */
  removeProject(projectId: string): void
}

/** In-memory store for tests and `pnpm dev` paths that need one. */
export function createMemoryStore(): MemorySnapshotStore {
  const rows: SnapshotRow[] = []
  const order = new Map<string, number>()
  let n = 0
  let seq = 0

  function compare(a: SnapshotRow, b: SnapshotRow): number {
    const byTime = b.createdAt.localeCompare(a.createdAt)
    if (byTime !== 0) return byTime
    return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)
  }

  function matching(projectId: string, fileName: string): SnapshotRow[] {
    return rows.filter((r) => r.projectId === projectId && r.fileName === fileName).sort(compare)
  }

  function trim(projectId: string, fileName: string): void {
    for (const row of matching(projectId, fileName).slice(SNAPSHOT_RETENTION)) {
      const i = rows.findIndex((r) => r.id === row.id)
      if (i !== -1) rows.splice(i, 1)
      order.delete(row.id)
    }
  }

  return {
    rows,
    async put(input) {
      const row: SnapshotRow = {
        id: `mem-snap-${++n}`,
        projectId: input.projectId,
        fileName: input.fileName,
        envelope: input.envelope,
        plaintextSha256: input.plaintextSha256,
        source: input.source,
        createdAt: new Date(0).toISOString(),
      }
      order.set(row.id, ++seq)
      rows.push(row)
      trim(input.projectId, input.fileName)
      return row
    },
    async latest(projectId, fileName) {
      return matching(projectId, fileName)[0] ?? null
    },
    async list(projectId, fileName, limit = SNAPSHOT_RETENTION) {
      return matching(projectId, fileName).slice(0, Math.max(0, limit))
    },
    removeProject(projectId) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]
        if (row !== undefined && row.projectId === projectId) {
          order.delete(row.id)
          rows.splice(i, 1)
        }
      }
    },
  }
}
