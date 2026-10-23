import { afterEach, describe, expect, it } from 'vitest'
import { lock, setupPassphrase } from './crypto'
import { sha256Hex } from './hash'
import { createMemoryStore } from './store'
import {
  applyImportedText,
  applyRestore,
  backupToVault,
  planRestore,
  previewDiff,
  projectStatus,
  type FileIO,
  type FileTarget,
  type SyncContext,
} from './sync'

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

const target: FileTarget = {
  projectId: 'p1',
  identity: 'github.com/a/b',
  filePath: '/p/.env',
  fileName: '.env',
}

afterEach(() => lock())

describe('snapshot engine (memory store + memory fs)', () => {
  it('backup stores ciphertext only; the store never sees plaintext', async () => {
    await setupPassphrase('sync-passphrase-1')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'API_KEY=example-secret\n']])
    const ctx: SyncContext = { store, io: memoryIO(files) }

    const { sha256 } = await backupToVault(ctx, target)

    expect(sha256).toBe(await sha256Hex('API_KEY=example-secret\n'))
    expect(store.rows).toHaveLength(1)
    const blob = JSON.stringify(store.rows)
    expect(blob).not.toContain('example-secret')
    expect(blob).toContain('ciphertext')
    expect(store.rows[0]?.plaintextSha256).toBe(sha256)
    expect(store.rows[0]?.source).toBe('local')
  })

  it('changed file → planRestore diff → applyRestore backs up before writing', async () => {
    await setupPassphrase('sync-passphrase-2')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'K=cloud\n']])
    const io = memoryIO(files)
    const ctx: SyncContext = { store, io }

    const pushed = await backupToVault(ctx, target)
    expect(await projectStatus(ctx, target)).toBe('backed-up')

    files.set('/p/.env', 'K=local-edit\n')
    expect(await projectStatus(ctx, target)).toBe('changed')

    const plan = await planRestore(ctx, target)
    expect(plan?.diff.changed).toEqual(['K'])
    expect(plan?.conflict).toBe(true)
    expect(plan?.sha256).toBe(pushed.sha256)
    expect(plan?.source).toBe('local')

    const applied = await applyRestore(ctx, target)
    expect(applied.backupPath).not.toBeNull()
    expect(await io.readFile(applied.backupPath as string)).toBe('K=local-edit\n')
    expect(await io.readFile('/p/.env')).toBe('K=cloud\n')
    expect(await projectStatus(ctx, target)).toBe('backed-up')
    // The restore itself records a fresh local snapshot.
    expect(store.rows).toHaveLength(2)
    expect(store.rows[1]?.plaintextSha256).toBe(pushed.sha256)
  })

  it('identical re-backup keeps status backed-up and appends a row', async () => {
    await setupPassphrase('sync-passphrase-3')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'K=same\n']])
    const ctx: SyncContext = { store, io: memoryIO(files) }

    await backupToVault(ctx, target)
    await backupToVault(ctx, target)

    expect(await projectStatus(ctx, target)).toBe('backed-up')
    expect(store.rows).toHaveLength(2)
  })

  it('imported text backs up the old file first and stores source import', async () => {
    await setupPassphrase('sync-passphrase-4a')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'K=old\n']])
    const io = memoryIO(files)
    const ctx: SyncContext = { store, io }

    const applied = await applyImportedText(ctx, { ...target, text: 'K=imported\n' })

    expect(applied.backupPath).not.toBeNull()
    expect(await io.readFile(applied.backupPath as string)).toBe('K=old\n')
    expect(files.get('/p/.env')).toBe('K=imported\n')
    expect(store.rows[0]?.source).toBe('import')
    expect(JSON.stringify(store.rows)).not.toContain('imported')
    expect(await projectStatus(ctx, target)).toBe('backed-up')
  })

  it('missing snapshot → not-backed-up; restore is a no-op', async () => {
    await setupPassphrase('sync-passphrase-4')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'K=one\n']])
    const ctx: SyncContext = { store, io: memoryIO(files) }

    expect(await projectStatus(ctx, target)).toBe('not-backed-up')
    expect(await planRestore(ctx, target)).toBeNull()
    await expect(applyRestore(ctx, target)).rejects.toThrow(/no stored snapshot/)
    expect(files.get('/p/.env')).toBe('K=one\n')
  })

  it('locked → locked; no store or disk reads needed', async () => {
    await setupPassphrase('sync-passphrase-5')
    const store = createMemoryStore()
    const files = new Map([['/p/.env', 'K=one\n']])
    const ctx: SyncContext = { store, io: memoryIO(files) }
    await backupToVault(ctx, target)

    lock()
    expect(await projectStatus(ctx, target)).toBe('locked')
  })

  it('previewDiff classifies added/removed/changed', () => {
    expect(previewDiff('A=1\nB=2\nC=3\n', 'B=two\nC=3\nD=4\n')).toEqual({
      added: ['D'],
      removed: ['A'],
      changed: ['B'],
    })
  })
})
