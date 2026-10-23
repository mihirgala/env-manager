# Step 2 — portable crypto (identity-keyed)

Goal: a bundle encrypted on laptop A must decrypt on laptop B, where the same repo has a
different local SQLite row id. Today it cannot: `projectDek(projectId)` keys off the local
UUID.

## 2.1 Target derivation

```
passphrase + envelope.salt --Argon2id13--> masterKey (32B, memory only)
DEK = BLAKE2b-256(key = masterKey, message = "<identity>:<fileName>")
ciphertext = XChaCha20-Poly1305(plaintext, ad = "<fileName>", nonce, DEK)
```

- `identity` = normalized repo identity, or `identity::subpath` for monorepo subfolders
  (`github.com/foo/bar::apps/web`). See step 5.
- `fileName` as AEAD additional data stops a `.env` ciphertext being relabelled
  `.env.production`.
- `envelope.salt` remains the Argon2id salt → a bundle carries everything needed to derive
  the same master key from the passphrase on another machine.
- Envelope stays `{ v, salt, nonce, algo, ciphertext }`; bump `v` to **2**. Reject `v: 1`
  (`crypto: unsupported envelope version`). No migration needed — no envelope was ever
  stored locally; only Supabase held them and those are being dropped.

## 2.2 API changes (`src/lib/crypto.ts`)

```ts
export const ENVELOPE_VERSION = 2 as const

export async function encryptFile(identity: string, fileName: string, plaintext: string): Promise<CryptoEnvelope>
export async function decryptFile(identity: string, fileName: string, env: CryptoEnvelope): Promise<string>

// Unlock the local vault (uses config.cryptoSalt)
export async function setupPassphrase(passphrase: string): Promise<{ salt: string }>
export async function unlock(passphrase: string, salt: string): Promise<void>

// Bundle import: derive the bundle's master key without touching the local session key.
export async function decryptFileWithPassphrase(
  passphrase: string, identity: string, fileName: string, env: CryptoEnvelope,
): Promise<string>
```

- `fileDek(identity, fileName)` replaces `projectDek(projectId)`; `memzero` it in `finally`.
- Keep `lock()`, `isUnlocked()`, `generateRecoveryKey()`, `recoverWithCode()` as-is (the
  recovery blob already seals the master key under a code-derived key; salt-independent).
- Never log, never persist, never send passphrase/keys. Everything is synchronous-memory
  after the libsodium ready await.

## 2.3 Import semantics (used by step 4)

Bundle envelopes may be encrypted under a *different* salt than the local vault (different
machine, different setup). Import therefore:

1. If `env.salt === local masterSalt` and unlocked → decrypt with the session key.
2. Otherwise prompt for the passphrase → `decryptFileWithPassphrase(..., env.salt)` →
   plaintext in memory.
3. Re-encrypt with the local session key before storing a local snapshot (single salt per
   vault, simpler recovery story).
4. Wipe both plaintext and derived keys as soon as the .env write is done.

## 2.4 Tests (`src/lib/crypto.test.ts`)

- round-trip per identity+file: encrypt → decrypt → same text.
- decrypt with a different identity fails.
- decrypt with a different fileName fails (AAD binding).
- tampered ciphertext / nonce / v=1 fails with a clear error.
- two "machines": encrypt with salt A, `decryptFileWithPassphrase` with salt A, decrypt
  succeeds; with the wrong passphrase fails.
- locked state: `encryptFile` throws `crypto: locked — unlock first`.
- `lock()` zeroes state: encrypt after lock throws.

## Verification

```powershell
pnpm test src/lib/crypto.test.ts
pnpm build
```

Pass: no reference to `projectDek` / `projectId` in crypto, no key material logged,
envelope `v: 2` asserted in tests.
