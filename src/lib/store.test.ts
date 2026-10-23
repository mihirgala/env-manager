import { describe, expect, it } from 'vitest'
import type { CryptoEnvelope } from './crypto'
import { SNAPSHOT_RETENTION, createMemoryStore } from './store'

function envelope(tag: string): CryptoEnvelope {
  return {
    v: 2,
    salt: 'salt',
    nonce: `nonce-${tag}`,
    algo: 'xchacha20poly1305',
    ciphertext: `ciphertext-${tag}`,
  }
}

function row(tag: string) {
  return {
    projectId: 'p1',
    fileName: '.env',
    envelope: envelope(tag),
    plaintextSha256: `sha-${tag}`,
    source: 'local' as const,
  }
}

describe('SnapshotStore (memory)', () => {
  it('put/latest/list return newest first, scoped per file', async () => {
    const store = createMemoryStore()
    await store.put(row('one'))
    await store.put(row('two'))
    await store.put({ ...row('other'), fileName: '.env.local' })

    expect((await store.latest('p1', '.env'))?.plaintextSha256).toBe('sha-two')
    expect((await store.list('p1', '.env')).map((r) => r.plaintextSha256)).toEqual([
      'sha-two',
      'sha-one',
    ])
    expect((await store.list('p1', '.env.local')).map((r) => r.plaintextSha256)).toEqual([
      'sha-other',
    ])
    expect(await store.list('p1', '.env', 1)).toHaveLength(1)
    expect(await store.latest('p2', '.env')).toBeNull()
  })

  it('retention keeps only the newest 20 rows per file', async () => {
    const store = createMemoryStore()
    for (let i = 1; i <= SNAPSHOT_RETENTION + 5; i++) {
      await store.put(row(String(i)))
    }

    const kept = await store.list('p1', '.env', 100)
    expect(kept).toHaveLength(SNAPSHOT_RETENTION)
    expect(kept[0]?.plaintextSha256).toBe(`sha-${SNAPSHOT_RETENTION + 5}`)
    expect(kept.at(-1)?.plaintextSha256).toBe('sha-6')
    expect(store.rows).toHaveLength(SNAPSHOT_RETENTION)
  })

  it('removing a project cascades its snapshots only', async () => {
    const store = createMemoryStore()
    await store.put(row('p1'))
    await store.put({ ...row('p2'), projectId: 'p2' })

    store.removeProject('p1')

    expect(await store.latest('p1', '.env')).toBeNull()
    expect((await store.latest('p2', '.env'))?.plaintextSha256).toBe('sha-p2')
    expect(store.rows).toHaveLength(1)
  })
})
