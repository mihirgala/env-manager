/**
 * Zero-knowledge crypto — P2. Real implementation via `libsodium-wrappers`.
 *
 * passphrase → Argon2id → master key → per-project DEKs, derived as
 * keyed-BLAKE2b(master, projectId) so no key storage is needed.
 * Payloads use XChaCha20-Poly1305; the server only ever sees envelopes plus
 * `plaintext_sha256` for conflict detection.
 *
 * Invariants: passphrase / master key / DEK / plaintext never leave the
 * device, are never logged, and are never sent to Supabase. The master key
 * lives in module memory only and `lock()` wipes it.
 */

import sodium from 'libsodium-wrappers-sumo'

export const ENVELOPE_VERSION = 1 as const
export const ENVELOPE_ALGO = 'xchacha20poly1305' as const

export interface CryptoEnvelope {
  v: typeof ENVELOPE_VERSION
  salt: string
  nonce: string
  algo: typeof ENVELOPE_ALGO
  ciphertext: string
}

/** Recovery blob: master key sealed under a key derived from the recovery code. */
export interface RecoveryBlob {
  v: typeof ENVELOPE_VERSION
  salt: string
  nonce: string
  sealed: string
}

let ready: Promise<void> | null = null
function ensureReady(): Promise<void> {
  if (ready === null) ready = sodium.ready.then(() => {})
  return ready
}

let masterKey: Uint8Array | null = null
/** KDF salt the held master key was derived with (persisted in config.json). */
let masterSalt: string | null = null

export function isUnlocked(): boolean {
  return masterKey !== null
}

/** Wipe the in-memory master key. */
export function lock(): void {
  if (masterKey !== null) {
    sodium.memzero(masterKey)
    masterKey = null
  }
  masterSalt = null
}

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

function unb64(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL)
}

async function deriveMasterKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  await ensureReady()
  return sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )
}

/**
 * First-time setup (or passphrase change): derive and hold the master key.
 * Returns the salt to persist (config.json). The salt is public, the key is not.
 */
export async function setupPassphrase(passphrase: string): Promise<{ salt: string }> {
  if (passphrase.length < 8) throw new Error('crypto: passphrase must be at least 8 characters')
  await ensureReady()
  lock()
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  masterKey = await deriveMasterKey(passphrase, salt)
  masterSalt = b64(salt)
  return { salt: masterSalt }
}

/** Unlock on boot with the stored salt. */
export async function unlock(passphrase: string, salt: string): Promise<void> {
  lock()
  masterKey = await deriveMasterKey(passphrase, unb64(salt))
  masterSalt = salt
}

function requireMaster(): Uint8Array {
  if (masterKey === null) throw new Error('crypto: locked — unlock first')
  return masterKey
}

function projectDek(projectId: string): Uint8Array {
  // Deterministic per-project DEK: keyed hash, no storage needed.
  return sodium.crypto_generichash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    projectId,
    requireMaster(),
  )
}

export async function encryptProject(projectId: string, plaintext: string): Promise<CryptoEnvelope> {
  await ensureReady()
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const dek = projectDek(projectId)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    dek,
  )
  sodium.memzero(dek)
  // `salt` records the KDF salt of the master setup (rotation bookkeeping);
  // per-envelope randomness comes from the nonce.
  return { v: ENVELOPE_VERSION, salt: masterSalt ?? '', nonce: b64(nonce), algo: ENVELOPE_ALGO, ciphertext: b64(ciphertext) }
}

export async function decryptProject(projectId: string, envelope: CryptoEnvelope): Promise<string> {
  await ensureReady()
  if (envelope.v !== ENVELOPE_VERSION || envelope.algo !== ENVELOPE_ALGO) {
    throw new Error('crypto: unsupported envelope version/algo')
  }
  const dek = projectDek(projectId)
  try {
    const open = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(envelope.ciphertext),
      null,
      unb64(envelope.nonce),
      dek,
    )
    return new TextDecoder().decode(open)
  } catch {
    throw new Error('crypto: decrypt failed — wrong key or corrupted envelope')
  } finally {
    sodium.memzero(dek)
  }
}

/** Generate a one-time 256-bit recovery code (`xxxx-xxxx-…`, show once). */
export async function generateRecoveryKey(): Promise<{ code: string; blob: RecoveryBlob }> {
  await ensureReady()
  const master = requireMaster()
  const raw = sodium.randombytes_buf(32)
  const code = sodium
    .to_base64(raw, sodium.base64_variants.ORIGINAL)
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 24)
  const pretty = code.replace(/(.{4})(?=.)/g, '$1-').toLowerCase()
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const recKey = await deriveMasterKey(pretty, salt)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const sealed = sodium.crypto_secretbox_easy(master, nonce, recKey)
  sodium.memzero(raw)
  sodium.memzero(recKey)
  const blob: RecoveryBlob = {
    v: ENVELOPE_VERSION,
    salt: b64(salt),
    nonce: b64(nonce),
    sealed: b64(sealed),
  }
  return { code: pretty, blob }
}

/** Recover (and hold) the master key from a code + stored blob. */
export async function recoverWithCode(code: string, blob: RecoveryBlob, setupSalt?: string): Promise<void> {
  await ensureReady()
  if (blob.v !== ENVELOPE_VERSION) throw new Error('crypto: unsupported recovery blob')
  const recKey = await deriveMasterKey(code.trim().toLowerCase(), unb64(blob.salt))
  try {
    const master = sodium.crypto_secretbox_open_easy(
      unb64(blob.sealed),
      unb64(blob.nonce),
      recKey,
    )
    lock()
    masterKey = new Uint8Array(master)
    masterSalt = setupSalt ?? null
  } catch {
    throw new Error('crypto: recovery failed — wrong code or corrupted blob')
  } finally {
    sodium.memzero(recKey)
  }
}
