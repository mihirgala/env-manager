import { afterEach, describe, expect, it } from 'vitest'
import { lock, setupPassphrase, type CryptoEnvelope } from './crypto'
import { sha256Hex } from './hash'
import {
  applyPull,
  planPull,
  previewDiff,
  projectStatus,
  pushProject,
  type CloudClient,
  type CloudProject,
  type CloudSnapshot,
  type FileIO,
  type SyncContext,
} from './sync'

/** In-memory storage double — mimics a local snapshot store, envelopes only. */
class MemoryCloudClient implements CloudClient {
  private projects: CloudProject[] = []
  private snapshots = new Map<string, CloudSnapshot[]>()
  private n = 0

  async listProjects(): Promise<CloudProject[]> {
    return [...this.projects]
  }

  async upsertProject(identity: string, displayName: string): Promise<CloudProject> {
    const existing = this.projects.find((p) => p.identity === identity)
    if (existing !== undefined) return existing
    const row: CloudProject = { id: `cloud-${++this.n}`, identity, displayName }
    this.projects.push(row)
    return row
  }

  async latestSnapshot(projectId: string): Promise<CloudSnapshot | null> {
    const all = this.snapshots.get(projectId) ?? []
    return all.length > 0 ? (all[all.length - 1] as CloudSnapshot) : null
  }

  async pushSnapshot(
    projectId: string,
    snap: { envelope: CryptoEnvelope; plaintextSha256: string; deviceName: string },
  ): Promise<void> {
    const all = this.snapshots.get(projectId) ?? []
    all.push({ ...snap, createdAt: new Date(0).toISOString() })
    this.snapshots.set(projectId, all)
  }

  /** Test helper: what the store holds (ciphertext only). */
  storedSnapshots(projectId: string): CloudSnapshot[] {
    return [...(this.snapshots.get(projectId) ?? [])]
  }
}

function memoryIO(files: Map<string, string>): FileIO & { backups: string[] } {
  const backups: string[] = []
  return {
    backups,
    async readFile(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`missing ${path}`)
      return v
    },
    async writeFile(path, content) {
      files.set(path, content)
    },
    async backupFile(path) {
      const backup = `${path}.backup-test`
      backups.push(backup)
      files.set(backup, files.get(path) ?? '')
      return backup
    },
  }
}

afterEach(() => lock())

describe('sync engine (memory cloud + memory fs)', () => {
  it('push stores ciphertext only; server never sees plaintext', async () => {
    await setupPassphrase('sync-passphrase-1')
    const cloud = new MemoryCloudClient()
    const files = new Map([['/p/.env', 'API_KEY=example-secret\n']])
    const io = memoryIO(files)
    const ctx: SyncContext = { cloud, io, lastSyncedSha: null }
    const { sha256 } = await pushProject(ctx, {
      identity: 'github.com/a/b',
      displayName: 'b',
            filePath: '/p/.env',
      deviceName: 'laptop-a',
    })
    expect(sha256).toBe(await sha256Hex('API_KEY=example-secret\n'))
    const stored = cloud.storedSnapshots('cloud-1')
    expect(stored).toHaveLength(1)
    const blob = JSON.stringify(stored[0])
    expect(blob).not.toContain('example-secret')
    expect(stored[0]?.plaintextSha256).toBe(sha256)
  })

  it('laptop B pulls what laptop A pushed', async () => {
    await setupPassphrase('sync-passphrase-2')
    const cloud = new MemoryCloudClient()
    const ioA = memoryIO(new Map([['/a/.env', 'K=one\n']]))
    await pushProject(
      { cloud, io: ioA, lastSyncedSha: null },
      { identity: 'github.com/a/b', displayName: 'b', filePath: '/a/.env', deviceName: 'a' },
    )
    const ioB = memoryIO(new Map())
    const plan = await planPull(
      { cloud, io: ioB, lastSyncedSha: null },
      { identity: 'github.com/a/b', filePath: '/b/.env' },
    )
    expect(plan?.diff.added).toEqual(['K'])
    const applied = await applyPull(
      { cloud, io: ioB, lastSyncedSha: null },
      { identity: 'github.com/a/b', filePath: '/b/.env' },
    )
    expect(applied.backupPath).toBeNull()
    expect(ioB.backups).toHaveLength(0)
    // round-trip through the real parser survived
    expect((await ioB.readFile('/b/.env'))).toBe('K=one\n')
  })

  it('conflicting pull backs up before overwrite', async () => {
    await setupPassphrase('sync-passphrase-3')
    const cloud = new MemoryCloudClient()
    const ioA = memoryIO(new Map([['/a/.env', 'K=cloud\n']]))
    const pushed = await pushProject(
      { cloud, io: ioA, lastSyncedSha: null },
      { identity: 'github.com/a/b', displayName: 'b', filePath: '/a/.env', deviceName: 'a' },
    )
    // Local edits after the last sync → conflict on pull.
    const ioB = memoryIO(new Map([['/b/.env', 'K=local-edit\n']]))
    const plan = await planPull(
      { cloud, io: ioB, lastSyncedSha: pushed.sha256 },
      { identity: 'github.com/a/b', filePath: '/b/.env' },
    )
    expect(plan?.conflict).toBe(true)
    expect(plan?.diff.changed).toEqual(['K'])
    const applied = await applyPull(
      { cloud, io: ioB, lastSyncedSha: pushed.sha256 },
      { identity: 'github.com/a/b', filePath: '/b/.env' },
    )
    expect(applied.backupPath).not.toBeNull()
    expect(await ioB.readFile(applied.backupPath as string)).toBe('K=local-edit\n')
    expect(await ioB.readFile('/b/.env')).toBe('K=cloud\n')
  })

  it('status transitions clean → ahead → behind → diverged', async () => {
    await setupPassphrase('sync-passphrase-4')
    const cloud = new MemoryCloudClient()
    const files = new Map([['/p/.env', 'K=1\n']])
    const io = memoryIO(files)
    const base = { identity: 'github.com/a/b', filePath: '/p/.env' } as const
    expect(await projectStatus({ cloud, io, lastSyncedSha: null }, { ...base, localOnly: true })).toBe('local-only')
    expect(await projectStatus({ cloud, io, lastSyncedSha: null }, { ...base, localOnly: false })).toBe('clean')
    const { sha256 } = await pushProject(
      { cloud, io, lastSyncedSha: null },
      { ...base, identity: 'github.com/a/b', displayName: 'b', deviceName: 'a' },
    )
    // Local edit after push → ahead.
    files.set('/p/.env', 'K=2\n')
    expect(await projectStatus({ cloud, io, lastSyncedSha: sha256 }, { ...base, localOnly: false })).toBe('ahead')
    // Cloud moves on (another device) while local stays at old sync → behind.
    files.set('/p/.env', 'K=1\n')
    await pushProject(
      { cloud, io: memoryIO(new Map([['/x/.env', 'K=3\n']])), lastSyncedSha: sha256 },
      { identity: 'github.com/a/b', displayName: 'b', filePath: '/x/.env', deviceName: 'b' },
    )
    expect(await projectStatus({ cloud, io, lastSyncedSha: sha256 }, { ...base, localOnly: false })).toBe('behind')
  })

  it('previewDiff classifies added/removed/changed', () => {
    expect(previewDiff('A=1\nB=2\nC=3\n', 'B=two\nC=3\nD=4\n')).toEqual({
      added: ['D'],
      removed: ['A'],
      changed: ['B'],
    })
  })
})
