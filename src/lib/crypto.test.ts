import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptFile,
  decryptFileWithPassphrase,
  encryptFile,
  generateRecoveryKey,
  isUnlocked,
  lock,
  recoverWithCode,
  setupPassphrase,
  unlock,
  type CryptoEnvelope,
} from './crypto'

const identity = 'github.com/foo/bar'
const file = '.env'
const pass = 'correct horse 123'

function tamper(value: string): string {
  // Flip the last base64 character without changing the length.
  const last = value.at(-1) ?? 'A'
  return value.slice(0, -1) + (last === 'A' ? 'B' : 'A')
}

afterEach(() => lock())

describe('crypto (libsodium, real)', () => {
  it('setup → lock → unlock round-trips', async () => {
    const { salt } = await setupPassphrase(pass)
    expect(isUnlocked()).toBe(true)
    lock()
    expect(isUnlocked()).toBe(false)
    await unlock(pass, salt)
    expect(isUnlocked()).toBe(true)
  })

  it('rejects short passphrases', async () => {
    await expect(setupPassphrase('short')).rejects.toThrow()
  })

  it('encrypt/decrypt round-trips per identity + file', async () => {
    await setupPassphrase('another-passphrase-1')
    const text = 'API_KEY=example-secret\nPORT=3000\n'
    const env = await encryptFile(identity, file, text)
    expect(env.v).toBe(2)
    expect(env.algo).toBe('xchacha20poly1305')
    expect(env.salt).not.toBe('')
    expect(env.nonce).not.toBe('')
    expect(await decryptFile(identity, file, env)).toBe(text)
  })

  it('a different identity fails to decrypt', async () => {
    await setupPassphrase('another-passphrase-2')
    const env = await encryptFile(identity, file, 'SECRET=example')
    await expect(decryptFile('github.com/foo/other', file, env)).rejects.toThrow()
  })

  it('a different fileName fails to decrypt (AAD binding)', async () => {
    await setupPassphrase('another-passphrase-2b')
    const env = await encryptFile(identity, file, 'SECRET=example')
    await expect(decryptFile(identity, '.env.production', env)).rejects.toThrow()
  })

  it('rejects tampered payloads and old envelope versions', async () => {
    await setupPassphrase('another-passphrase-2c')
    const env = await encryptFile(identity, file, 'SECRET=example')
    await expect(
      decryptFile(identity, file, { ...env, ciphertext: tamper(env.ciphertext) }),
    ).rejects.toThrow(/decrypt failed/)
    await expect(
      decryptFile(identity, file, { ...env, nonce: tamper(env.nonce) }),
    ).rejects.toThrow()
    const v1 = { ...env, v: 1 } as unknown as CryptoEnvelope
    await expect(decryptFile(identity, file, v1)).rejects.toThrow(/unsupported envelope version/)
  })

  it('same plaintext encrypts differently each time (random nonce)', async () => {
    await setupPassphrase('another-passphrase-3')
    const a = await encryptFile(identity, file, 'SAME=example')
    const b = await encryptFile(identity, file, 'SAME=example')
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('recovery code restores the same master key', async () => {
    const { salt } = await setupPassphrase('recoverable-pass-1')
    const before = await encryptFile(identity, file, 'DATA=example')
    const { code, blob } = await generateRecoveryKey()
    lock()
    await recoverWithCode(code, blob, salt)
    expect(isUnlocked()).toBe(true)
    expect(await decryptFile(identity, file, before)).toBe('DATA=example')
  })

  it('wrong recovery code fails', async () => {
    await setupPassphrase('recoverable-pass-2')
    const { blob } = await generateRecoveryKey()
    lock()
    await expect(recoverWithCode('aaaa-bbbb-cccc-dddd-eeee-ffff', blob)).rejects.toThrow()
    expect(isUnlocked()).toBe(false)
  })

  it('encrypt while locked throws', async () => {
    await expect(encryptFile(identity, file, 'X=1')).rejects.toThrow(/locked/)
  })

  it('second machine: portable envelope decrypts with its own salt + passphrase', async () => {
    // Machine A: set up with salt A and encrypt a file.
    const { salt: saltA } = await setupPassphrase('machine-a-passphrase')
    const env = await encryptFile(identity, file, 'TOKEN=example\n')
    lock()

    // Machine B: different local salt, same passphrase as machine A.
    await setupPassphrase('machine-b-local-passphrase')
    expect(await decryptFileWithPassphrase('machine-a-passphrase', identity, file, env)).toBe(
      'TOKEN=example\n',
    )

    // The wrong passphrase must not open the file.
    await expect(
      decryptFileWithPassphrase('not-the-passphrase', identity, file, env),
    ).rejects.toThrow(/decrypt failed/)

    // Sanity: the envelope records machine A's salt, so it is self-contained.
    expect(env.salt).toBe(saltA)
    // Importing with the local session key would be wrong (different salt).
    expect(isUnlocked()).toBe(true)
    await expect(decryptFile(identity, file, env)).rejects.toThrow()
  })

  it('requires identity and fileName', async () => {
    await setupPassphrase('validation-passphrase')
    await expect(encryptFile('', file, 'X=1')).rejects.toThrow(/identity/)
    await expect(encryptFile(identity, '  ', 'X=1')).rejects.toThrow(/fileName/)
  })
})
