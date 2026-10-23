import { afterEach, describe, expect, it } from 'vitest'
import {
  BUNDLE_FORMAT,
  BundleFormatError,
  buildBundle,
  decryptBundle,
  parseBundle,
  serializeBundle,
  type Bundle,
} from './bundle'
import { encryptFile, lock, setupPassphrase, type CryptoEnvelope } from './crypto'
import { createMemoryStore } from './store'

const identity = 'github.com/example/app'
const displayName = 'app'
const envFiles = {
  '.env': 'API_KEY=example-secret\nPORT=3000\n',
  '.env.local': '# local only\nLOCAL_ONLY=example-local\n',
}

function raw(bundle: Bundle): Record<string, unknown> {
  return JSON.parse(serializeBundle(bundle)) as Record<string, unknown>
}

function invalid(mutate: (value: Record<string, unknown>) => void, overrides: Record<string, unknown> = {}): string {
  const value: Record<string, unknown> = {
    format: BUNDLE_FORMAT,
    version: 1,
    createdAt: '2026-10-23T12:00:00.000Z',
    project: { identity, displayName },
    files: {
      '.env': {
        v: 2,
        salt: 'salt',
        nonce: 'nonce',
        algo: 'xchacha20poly1305',
        ciphertext: 'ciphertext',
      },
    },
    ...overrides,
  }
  mutate(value)
  return JSON.stringify(value)
}

afterEach(() => lock())

describe('encrypted bundles', () => {
  it('round-trips and never serializes plaintext or a plaintext hash', async () => {
    await setupPassphrase('bundle-passphrase-1')
    const bundle = await buildBundle({ identity, displayName, files: envFiles })
    const text = serializeBundle(bundle)

    expect(text).not.toContain('example-secret')
    expect(text).not.toContain('example-local')
    expect(text).not.toContain('plaintext_sha256')

    const parsed = parseBundle(text)
    expect(parsed.format).toBe(BUNDLE_FORMAT)
    expect(parsed.version).toBe(1)
    expect(parsed.project).toEqual({ identity, displayName })
    expect(Object.keys(parsed.files).sort()).toEqual(['.env', '.env.local'])
    expect(await decryptBundle(parsed)).toEqual(envFiles)
  })

  it('ignores template files and refuses an export with no trackable file', async () => {
    await setupPassphrase('bundle-passphrase-2')
    const bundle = await buildBundle({
      identity,
      displayName,
      files: { '.env': 'K=example\n', '.env.example': 'K=placeholder\n' },
    })
    expect(Object.keys(bundle.files)).toEqual(['.env'])

    await expect(
      buildBundle({ identity, displayName, files: { '.env.example': 'K=placeholder\n' } }),
    ).rejects.toThrow(/no trackable env files/)
  })

  it('rejects wrong format, newer versions, missing identity, empty files and v1 envelopes', async () => {
    await setupPassphrase('bundle-passphrase-3')
    const bundle = await buildBundle({ identity, displayName, files: envFiles })

    expect(() => parseBundle(invalid((v) => { v.format = 'other' }))).toThrow(BundleFormatError)
    expect(() => parseBundle(invalid((v) => { v.version = 99 }))).toThrow(/newer version/)
    expect(() => parseBundle(invalid((v) => { v.project = { displayName } }))).toThrow(
      /project identity/,
    )
    expect(() => parseBundle(invalid((v) => { v.files = {} }))).toThrow(/no env files/)

    const v1 = raw(bundle)
    const env = v1.files as Record<string, Record<string, unknown>>
    env['.env']!.v = 1
    expect(() => parseBundle(JSON.stringify(v1))).toThrow(/older encryption format/)
  })

  it('rejects path traversal file names', async () => {
    await setupPassphrase('bundle-passphrase-4')
    const bundle = await buildBundle({ identity, displayName, files: envFiles })
    const value = raw(bundle)
    value.files = {
      ['../evil.env']: {
        v: 2,
        salt: 'salt',
        nonce: 'nonce',
        algo: 'xchacha20poly1305',
        ciphertext: 'ciphertext',
      },
    }
    expect(() => parseBundle(JSON.stringify(value))).toThrow(/unsupported file name/)
  })

  it('portable: another vault decrypts with the bundle passphrase, wrong keys change nothing', async () => {
    await setupPassphrase('machine-a-passphrase')
    const text = serializeBundle(await buildBundle({ identity, displayName, files: envFiles }))

    // Simulate machine B: different vault salt and session key.
    lock()
    await setupPassphrase('machine-b-passphrase')
    const store = createMemoryStore()
    const parsed = parseBundle(text)

    await expect(decryptBundle(parsed)).rejects.toThrow(/another passphrase/)
    await expect(decryptBundle(parsed, { passphrase: 'wrong-passphrase' })).rejects.toThrow(
      /wrong passphrase/,
    )
    expect(store.rows).toHaveLength(0)

    expect(await decryptBundle(parsed, { passphrase: 'machine-a-passphrase' })).toEqual(envFiles)
  })

  it('re-encrypts imported text under the local vault without extra plaintext', async () => {
    await setupPassphrase('import-passphrase')
    const bundle = await buildBundle({ identity, displayName, files: envFiles })
    const parsed = parseBundle(serializeBundle(bundle))
    const decrypted = await decryptBundle(parsed)

    // Machine B stores a source:'import' snapshot with its own envelope.
    const store = createMemoryStore()
    const envelope: CryptoEnvelope = await encryptFile(identity, '.env', decrypted['.env'] ?? '')
    await store.put({
      projectId: 'mem-9',
      fileName: '.env',
      envelope,
      plaintextSha256: 'sha',
      source: 'import',
    })

    expect(JSON.stringify(store.rows)).not.toContain('example-secret')
    expect(store.rows[0]?.source).toBe('import')
  })
})
