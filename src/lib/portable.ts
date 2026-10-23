/**
 * Single-file portable vault — one SQLite `.db` carrying every project and
 * encrypted snapshot. This replaces the old one-`.envmgr`-per-project model.
 *
 * The file is built/read by Rust as opaque rows. This module owns the format
 * validation, crypto, and merge policy:
 *   - no plaintext values and no plaintext hashes in the file;
 *   - project identities + folder paths are portable metadata;
 *   - envelopes keep the source vault's salt, so an import from another
 *     passphrase setup is decrypted once and re-encrypted under the local key.
 */

import { ensureDeviceName } from './config'
import {
  ENVELOPE_ALGO,
  ENVELOPE_VERSION,
  currentSalt,
  decryptFile,
  decryptFilesWithPassphrase,
  encryptFile,
  isUnlocked,
  type CryptoEnvelope,
  type EnvelopeItem,
} from './crypto'
import { isTrackableEnvFile } from './env-files'
import { sha256Hex } from './hash'
import * as tauri from './tauri'

export const PORTABLE_FORMAT = 'env-manager-vault' as const
export const PORTABLE_VERSION = 1 as const

export interface PortableMeta {
  format: typeof PORTABLE_FORMAT
  version: typeof PORTABLE_VERSION
  createdAt: string
  /** Public Argon2id salt the envelopes were encrypted with. */
  salt: string
  deviceName: string
}

export interface PortableProject {
  identity: string
  displayName: string
  folderPath: string
  createdAt: string
}

export interface PortableSnapshot {
  identity: string
  fileName: string
  envelope: CryptoEnvelope
  source: 'local' | 'import'
  createdAt: string
}

export interface PortableVault {
  meta: PortableMeta
  projects: PortableProject[]
  snapshots: PortableSnapshot[]
}

/** Friendly, user-facing validation failure. */
export class PortableVaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortableVaultError'
  }
}

function fail(message: string): never {
  throw new PortableVaultError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEnvelope(fileName: string, value: unknown, salt: string): CryptoEnvelope {
  if (!isRecord(value)) fail(`The vault file's ${fileName} entry is not a valid encrypted file.`)
  if (value.v !== ENVELOPE_VERSION) {
    fail(
      value.v === 1
        ? 'This vault file uses an older encryption format. Re-export it with this version of env-manager.'
        : 'The vault file contains an unsupported encryption format.',
    )
  }
  if (value.algo !== ENVELOPE_ALGO) fail(`The vault file's ${fileName} entry uses an unsupported cipher.`)
  if (typeof value.salt !== 'string' || value.salt === '') {
    fail(`The vault file's ${fileName} entry is missing its passphrase salt.`)
  }
  if (value.salt !== salt) {
    fail(`The vault file's ${fileName} entry uses a different passphrase salt.`)
  }
  if (typeof value.nonce !== 'string' || value.nonce === '') {
    fail(`The vault file's ${fileName} entry is missing its nonce.`)
  }
  if (typeof value.ciphertext !== 'string' || value.ciphertext === '') {
    fail(`The vault file's ${fileName} entry is missing its ciphertext.`)
  }
  return {
    v: ENVELOPE_VERSION,
    salt: value.salt,
    nonce: value.nonce,
    algo: ENVELOPE_ALGO,
    ciphertext: value.ciphertext,
  }
}

/**
 * Validate a `vault_read` payload. Never touches disk or crypto; throws a
 * `PortableVaultError` with a message suitable for the UI.
 */
export function parsePortableVault(raw: unknown): PortableVault {
  if (!isRecord(raw)) fail('This is not an env-manager vault (.db) file.')
  const metaRaw = raw.meta
  if (!isRecord(metaRaw)) fail('This vault file is missing its metadata.')
  if (metaRaw.format !== PORTABLE_FORMAT) fail('This is not an env-manager vault (.db) file.')

  const version = typeof metaRaw.version === 'string' ? Number(metaRaw.version) : NaN
  if (!Number.isInteger(version)) fail('This vault file is missing its version.')
  if (version > PORTABLE_VERSION) {
    fail('This vault file was made by a newer version of env-manager. Update the app, then try again.')
  }
  if (version !== PORTABLE_VERSION) fail('This vault file version is not supported.')

  if (typeof metaRaw.salt !== 'string' || metaRaw.salt === '') {
    fail('This vault file is missing its passphrase salt.')
  }
  if (typeof metaRaw.createdAt !== 'string' || metaRaw.createdAt === '') {
    fail('This vault file is missing its creation time.')
  }
  const salt = metaRaw.salt
  const meta: PortableMeta = {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    createdAt: metaRaw.createdAt,
    salt,
    deviceName:
      typeof metaRaw.deviceName === 'string' && metaRaw.deviceName.trim() !== ''
        ? metaRaw.deviceName.trim()
        : 'unknown device',
  }

  if (!Array.isArray(raw.projects) || raw.projects.length === 0) {
    fail('This vault file contains no projects.')
  }
  const projects: PortableProject[] = []
  const identities = new Set<string>()
  for (const value of raw.projects) {
    if (!isRecord(value)) fail('This vault file contains an invalid project entry.')
    if (typeof value.identity !== 'string' || value.identity.trim() === '') {
      fail('This vault file contains a project without an identity.')
    }
    const identity = value.identity.trim()
    if (identities.has(identity)) {
      fail(`This vault file contains the project identity twice: ${identity}`)
    }
    identities.add(identity)
    if (typeof value.folderPath !== 'string' || value.folderPath.trim() === '') {
      fail(`This vault file's project ${identity} is missing its folder path.`)
    }
    const displayName =
      typeof value.displayName === 'string' && value.displayName.trim() !== ''
        ? value.displayName.trim()
        : identity
    if (typeof value.createdAt !== 'string' || value.createdAt === '') {
      fail(`This vault file's project ${identity} is missing its creation time.`)
    }
    projects.push({
      identity,
      displayName,
      folderPath: value.folderPath,
      createdAt: value.createdAt,
    })
  }

  if (!Array.isArray(raw.snapshots)) fail('This vault file is missing its snapshot list.')
  const snapshots: PortableSnapshot[] = []
  for (const value of raw.snapshots) {
    if (!isRecord(value)) fail('This vault file contains an invalid snapshot entry.')
    if (typeof value.identity !== 'string' || !identities.has(value.identity)) {
      fail('This vault file contains a snapshot for an unknown project.')
    }
    if (typeof value.fileName !== 'string' || !isTrackableEnvFile(value.fileName)) {
      fail(`This vault file contains an unsupported file name: ${String(value.fileName)}`)
    }
    if (value.source !== 'local' && value.source !== 'import') {
      fail(`This vault file's ${value.fileName} snapshot has an unknown source.`)
    }
    if (typeof value.createdAt !== 'string' || value.createdAt === '') {
      fail(`This vault file's ${value.fileName} snapshot is missing its creation time.`)
    }
    if (typeof value.envelope !== 'string' || value.envelope === '') {
      fail(`This vault file's ${value.fileName} snapshot is missing its ciphertext.`)
    }
    let envelopeRaw: unknown
    try {
      envelopeRaw = JSON.parse(value.envelope)
    } catch {
      fail(`This vault file's ${value.fileName} snapshot is corrupted.`)
    }
    snapshots.push({
      identity: value.identity,
      fileName: value.fileName,
      envelope: parseEnvelope(value.fileName, envelopeRaw, salt),
      source: value.source,
      createdAt: value.createdAt,
    })
  }

  return { meta, projects, snapshots }
}

/** Read + validate a chosen `.db` without modifying it. */
export async function readPortableVault(path: string): Promise<PortableVault> {
  return parsePortableVault(await tauri.vaultRead(path))
}

/** Export the live vault to one file. Requires an unlocked session. */
export async function exportVaultFile(path: string): Promise<tauri.VaultExportSummary> {
  if (!isUnlocked()) throw new Error('Unlock encryption to export the vault.')
  const salt = currentSalt()
  if (salt === null || salt === '') throw new Error('Unlock encryption to export the vault.')
  const deviceName = await ensureDeviceName().catch(() => 'unknown-device')
  return tauri.vaultExport({
    path,
    salt,
    deviceName,
    createdAt: new Date().toISOString(),
  })
}

/**
 * Decrypt every snapshot in memory and prepare rows for the local vault.
 * Same-salt files reuse their envelopes; different-salt files are decrypted
 * once with the file's passphrase, then re-encrypted under the local key.
 */
export async function preparePortableImport(
  vault: PortableVault,
  opts: { passphrase?: string } = {},
): Promise<tauri.VaultImportPayload> {
  if (!isUnlocked()) throw new Error('Unlock encryption to import a vault.')
  const localSalt = currentSalt()
  if (localSalt === null) throw new Error('Unlock encryption to import a vault.')

  const sameSalt = vault.meta.salt === localSalt
  const items: EnvelopeItem[] = vault.snapshots.map((snapshot) => ({
    identity: snapshot.identity,
    fileName: snapshot.fileName,
    envelope: snapshot.envelope,
  }))

  let texts: string[]
  if (items.length === 0) {
    texts = []
  } else if (sameSalt) {
    texts = []
    for (const item of items) {
      texts.push(await decryptFile(item.identity, item.fileName, item.envelope))
    }
  } else {
    const passphrase = opts.passphrase ?? ''
    if (passphrase === '') {
      throw new Error(
        "This vault file was encrypted with another passphrase. Enter its passphrase to import it.",
      )
    }
    texts = await decryptFilesWithPassphrase(passphrase, vault.meta.salt, items)
  }

  const snapshots: tauri.VaultImportSnapshot[] = []
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const snapshot = vault.snapshots[i]
    const text = texts[i]
    if (item === undefined || snapshot === undefined || text === undefined) continue
    snapshots.push({
      identity: item.identity,
      fileName: item.fileName,
      envelope: JSON.stringify(
        sameSalt ? item.envelope : await encryptFile(item.identity, item.fileName, text),
      ),
      plaintextSha256: await sha256Hex(text),
      source: 'import',
      createdAt: snapshot.createdAt,
    })
  }

  return { projects: vault.projects, snapshots }
}

/** Merge prepared rows into the live vault in one SQLite transaction. */
export async function importPortableVault(
  payload: tauri.VaultImportPayload,
): Promise<tauri.VaultImportSummary> {
  return tauri.vaultImport(payload)
}
