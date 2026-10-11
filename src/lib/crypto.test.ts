import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptProject,
  encryptProject,
  generateRecoveryKey,
  isUnlocked,
  lock,
  recoverWithCode,
  setupPassphrase,
  unlock,
} from './crypto'

afterEach(() => lock())

describe('crypto (libsodium, real)', () => {
  it('setup → lock → unlock round-trips', async () => {
    const { salt } = await setupPassphrase('correct horse 123')
    expect(isUnlocked()).toBe(true)
    lock()
    expect(isUnlocked()).toBe(false)
    await unlock('correct horse 123', salt)
    expect(isUnlocked()).toBe(true)
  })

  it('rejects short passphrases', async () => {
    await expect(setupPassphrase('short')).rejects.toThrow()
  })

  it('encrypt/decrypt round-trips per project', async () => {
    await setupPassphrase('another-passphrase-1')
    const env = await encryptProject('proj-a', 'API_KEY=example-secret\nPORT=3000\n')
    expect(env.v).toBe(1)
    expect(env.algo).toBe('xchacha20poly1305')
    expect(env.nonce).not.toBe('')
    expect(await decryptProject('proj-a', env)).toBe('API_KEY=example-secret\nPORT=3000\n')
  })

  it('wrong project id fails to decrypt', async () => {
    await setupPassphrase('another-passphrase-2')
    const env = await encryptProject('proj-a', 'SECRET=example')
    await expect(decryptProject('proj-b', env)).rejects.toThrow()
  })

  it('same plaintext encrypts differently each time (random nonce)', async () => {
    await setupPassphrase('another-passphrase-3')
    const a = await encryptProject('proj-a', 'SAME=example')
    const b = await encryptProject('proj-a', 'SAME=example')
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('recovery code restores the master key', async () => {
    const { salt } = await setupPassphrase('recoverable-pass-1')
    const before = await encryptProject('proj-a', 'DATA=example')
    const { code, blob } = await generateRecoveryKey()
    lock()
    await recoverWithCode(code, blob, salt)
    expect(isUnlocked()).toBe(true)
    // Same master key → old envelopes still open.
    expect(await decryptProject('proj-a', before)).toBe('DATA=example')
  })

  it('wrong recovery code fails', async () => {
    await setupPassphrase('recoverable-pass-2')
    const { blob } = await generateRecoveryKey()
    lock()
    await expect(recoverWithCode('aaaa-bbbb-cccc-dddd-eeee-ffff', blob)).rejects.toThrow()
    expect(isUnlocked()).toBe(false)
  })

  it('encrypt while locked throws', async () => {
    await expect(encryptProject('proj-a', 'X=1')).rejects.toThrow()
  })
})
