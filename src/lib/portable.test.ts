import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptFile,
  encryptFile,
  isUnlocked,
  lock,
  setupPassphrase,
  type CryptoEnvelope,
} from './crypto'
import { sha256Hex } from './hash'
import {
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  PortableVaultError,
  parsePortableVault,
  preparePortableImport,
  type PortableVault,
} from './portable'

const identity = 'github.com/foo/bar'
const file = '.env'
const secret = 'TOKEN=example-secret\nPORT=3000\n'

function wire(meta: Record<string, string>, projects: unknown[], snapshots: unknown[]): unknown {
  return { meta, projects, snapshots }
}

function validMeta(salt: string): Record<string, string> {
  return {
    format: PORTABLE_FORMAT,
    version: String(PORTABLE_VERSION),
    createdAt: '2026-01-01T00:00:00.000Z',
    salt,
    deviceName: 'test-device',
  }
}

function vaultFor(salt: string, envelope: CryptoEnvelope): PortableVault {
  return {
    meta: {
      format: PORTABLE_FORMAT,
      version: PORTABLE_VERSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      salt,
      deviceName: 'test-device',
    },
    projects: [
      {
        identity,
        displayName: 'Example',
        folderPath: 'C:\\projects\\example',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    snapshots: [
      {
        identity,
        fileName: file,
        envelope,
        source: 'local',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  }
}

afterEach(() => lock())

describe('portable vault format', () => {
  it('accepts a well-formed file and keeps the envelope opaque', async () => {
    const { salt } = await setupPassphrase('portable-format-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    const parsed = parsePortableVault(
      wire(
        validMeta(salt),
        [
          {
            identity,
            displayName: 'Example',
            folderPath: 'C:\\projects\\example',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          {
            identity,
            fileName: file,
            envelope: JSON.stringify(envelope),
            source: 'local',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      ),
    )
    expect(parsed.meta.salt).toBe(salt)
    expect(parsed.snapshots[0]?.envelope.ciphertext).toBe(envelope.ciphertext)
    expect(JSON.stringify(parsed)).not.toContain('example-secret')
  })

  it('rejects files that are not env-manager vaults', () => {
    expect(() => parsePortableVault(null)).toThrow(PortableVaultError)
    expect(() => parsePortableVault({ meta: {}, projects: [], snapshots: [] })).toThrow(
      /not an env-manager vault/,
    )
  })

  it('rejects newer versions, bad salts, and unsupported file names', async () => {
    const { salt } = await setupPassphrase('portable-reject-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    const projects = [
      {
        identity,
        displayName: 'Example',
        folderPath: 'C:\\projects\\example',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const snapshots = [
      {
        identity,
        fileName: file,
        envelope: JSON.stringify(envelope),
        source: 'local',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]
    expect(() =>
      parsePortableVault(
        wire(validMeta(salt), projects, [
          { ...snapshots[0], fileName: 'notes.txt' },
        ]),
      ),
    ).toThrow(/unsupported file name/)
    expect(() =>
      parsePortableVault(
        wire(validMeta(salt), projects, [
          { ...snapshots[0], envelope: JSON.stringify({ ...envelope, salt: 'other-salt' }) },
        ]),
      ),
    ).toThrow(/different passphrase salt/)
    expect(() =>
      parsePortableVault(wire({ ...validMeta(salt), version: '99' }, projects, snapshots)),
    ).toThrow(/newer version/)
    expect(() => parsePortableVault(wire(validMeta(''), projects, snapshots))).toThrow(
      /passphrase salt/,
    )
  })

  it('rejects duplicate projects and snapshots for unknown projects', async () => {
    const { salt } = await setupPassphrase('portable-identity-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    const project = {
      identity,
      displayName: 'Example',
      folderPath: 'C:\\projects\\example',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(() =>
      parsePortableVault(wire(validMeta(salt), [project, project], [])),
    ).toThrow(/twice/)
    expect(() =>
      parsePortableVault(
        wire(
          validMeta(salt),
          [project],
          [
            {
              identity: 'github.com/other/repo',
              fileName: file,
              envelope: JSON.stringify(envelope),
              source: 'local',
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        ),
      ),
    ).toThrow(/unknown project/)
  })
})

describe('portable vault import preparation', () => {
  it('reuses envelopes when the file was made with the local salt', async () => {
    const { salt } = await setupPassphrase('portable-same-salt-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    const prepared = await preparePortableImport(vaultFor(salt, envelope))

    expect(prepared.projects).toHaveLength(1)
    expect(prepared.snapshots).toHaveLength(1)
    const row = prepared.snapshots[0]
    expect(row?.envelope).toBe(JSON.stringify(envelope))
    expect(row?.plaintextSha256).toBe(await sha256Hex(secret))
    expect(row?.source).toBe('import')
    expect(await decryptFile(identity, file, envelope)).toBe(secret)
  })

  it('decrypts with the file passphrase and re-encrypts under the local key', async () => {
    const source = await setupPassphrase('portable-file-passphrase')
    const sourceEnvelope = await encryptFile(identity, file, secret)
    lock()
    const local = await setupPassphrase('portable-local-passphrase')
    expect(local.salt).not.toBe(source.salt)

    const prepared = await preparePortableImport(vaultFor(source.salt, sourceEnvelope), {
      passphrase: 'portable-file-passphrase',
    })
    const row = prepared.snapshots[0]
    expect(row).toBeDefined()
    const imported = JSON.parse(row?.envelope ?? '{}') as CryptoEnvelope
    expect(imported.salt).toBe(local.salt)
    expect(imported.ciphertext).not.toBe(sourceEnvelope.ciphertext)
    expect(row?.envelope).not.toContain('example-secret')
    expect(row?.plaintextSha256).toBe(await sha256Hex(secret))
    expect(await decryptFile(identity, file, imported)).toBe(secret)
  })

  it('requires the file passphrase when salts differ', async () => {
    const source = await setupPassphrase('portable-needed-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    lock()
    await setupPassphrase('portable-other-local-passphrase')

    await expect(preparePortableImport(vaultFor(source.salt, envelope))).rejects.toThrow(
      /another passphrase/,
    )
    await expect(
      preparePortableImport(vaultFor(source.salt, envelope), {
        passphrase: 'wrong-passphrase',
      }),
    ).rejects.toThrow(/decrypt failed/)
    expect(isUnlocked()).toBe(true)
  })

  it('requires an unlocked local vault', async () => {
    const { salt } = await setupPassphrase('portable-locked-passphrase')
    const envelope = await encryptFile(identity, file, secret)
    lock()
    await expect(preparePortableImport(vaultFor(salt, envelope))).rejects.toThrow(/unlock/i)
  })
})
