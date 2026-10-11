/**
 * Zero-knowledge crypto — P2. Typed stubs only.
 *
 * Design (implemented in P2 with `libsodium-wrappers` in TS):
 * passphrase → Argon2id → master key → per-project DEKs
 * (XChaCha20-Poly1305). The server only ever sees envelopes plus
 * `plaintext_sha256` for conflict detection.
 *
 * Invariants: passphrase / master key / DEK / plaintext never leave the
 * device, are never logged, and are never sent to Supabase.
 */

export const ENVELOPE_VERSION = 1 as const
export const ENVELOPE_ALGO = 'xchacha20poly1305' as const

export interface CryptoEnvelope {
  v: typeof ENVELOPE_VERSION
  salt: string
  nonce: string
  algo: typeof ENVELOPE_ALGO
  ciphertext: string
}

function notImplemented(name: string): never {
  throw new Error(`crypto: ${name} not implemented until P2`)
}

export async function unlock(_passphrase: string, _salt: string): Promise<void> {
  return notImplemented('unlock')
}

export async function generateRecoveryKey(): Promise<string> {
  return notImplemented('generateRecoveryKey')
}

export async function encryptProject(_projectId: string, _plaintext: string): Promise<CryptoEnvelope> {
  return notImplemented('encryptProject')
}

export async function decryptProject(_projectId: string, _envelope: CryptoEnvelope): Promise<string> {
  return notImplemented('decryptProject')
}

export function lock(): void {
  // P2: wipe unlocked keys from memory on lock.
}
