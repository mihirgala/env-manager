/**
 * Manual sync — encrypted `.envmgr` project bundles.
 *
 * A bundle carries the portable identity plus one envelope per env file. It
 * never contains plaintext and never contains `plaintext_sha256` (a hash of
 * secret values is a guessing oracle; conflict detection stays local).
 *
 * There is no server: the user moves the file by hand. Parsing is strict and
 * happens before any write, so a bad bundle cannot partially apply.
 */

import {
  ENVELOPE_ALGO,
  ENVELOPE_VERSION,
  currentSalt,
  decryptFile,
  decryptFileWithPassphrase,
  encryptFile,
  isUnlocked,
  type CryptoEnvelope,
} from './crypto'
import { isTrackableEnvFile } from './env-files'

export const BUNDLE_FORMAT = 'env-manager-bundle' as const
export const BUNDLE_VERSION = 1 as const

export interface BundleProject {
  identity: string
  displayName: string
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  createdAt: string
  project: BundleProject
  files: Record<string, CryptoEnvelope>
}

/** Friendly, user-facing bundle validation failure. */
export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleFormatError'
  }
}

function fail(message: string): never {
  throw new BundleFormatError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEnvelope(fileName: string, value: unknown): CryptoEnvelope {
  if (!isRecord(value)) fail(`The bundle's ${fileName} entry is not a valid encrypted file.`)
  if (value.v !== ENVELOPE_VERSION) {
    fail(
      value.v === 1
        ? 'This bundle uses an older encryption format. Re-export it with this version of env-manager.'
        : 'The bundle contains an unsupported encryption format.',
    )
  }
  if (value.algo !== ENVELOPE_ALGO) fail(`The bundle's ${fileName} entry uses an unsupported cipher.`)
  if (typeof value.salt !== 'string' || value.salt === '') {
    fail(`The bundle's ${fileName} entry is missing its passphrase salt.`)
  }
  if (typeof value.nonce !== 'string' || value.nonce === '') {
    fail(`The bundle's ${fileName} entry is missing its nonce.`)
  }
  if (typeof value.ciphertext !== 'string' || value.ciphertext === '') {
    fail(`The bundle's ${fileName} entry is missing its ciphertext.`)
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
 * Encrypt the given files under the held session key. Non-trackable names
 * (templates, backups) are ignored; an export with none throws.
 */
export async function buildBundle(input: {
  identity: string
  displayName: string
  files: Record<string, string>
}): Promise<Bundle> {
  const identity = input.identity.trim()
  if (identity === '') throw new Error('bundle: identity is required')
  const names = Object.keys(input.files).filter(isTrackableEnvFile)
  if (names.length === 0) throw new Error('bundle: no trackable env files to export')

  const files: Record<string, CryptoEnvelope> = {}
  for (const fileName of names) {
    const text = input.files[fileName]
    if (text === undefined) continue
    const envelope = await encryptFile(identity, fileName, text)
    if (envelope.salt === '') {
      throw new Error('bundle: cannot export without a vault passphrase salt')
    }
    files[fileName] = envelope
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    project: { identity, displayName: input.displayName.trim() || identity },
    files,
  }
}

export function serializeBundle(bundle: Bundle): string {
  return JSON.stringify(bundle, null, 2)
}

/** Strict parse. Never touches disk; throws `BundleFormatError` when invalid. */
export function parseBundle(text: string): Bundle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail('This file is not a valid env-manager bundle (invalid JSON).')
  }
  if (!isRecord(raw)) fail('This file is not a valid env-manager bundle.')
  if (raw.format !== BUNDLE_FORMAT) fail('This file is not an env-manager bundle.')
  if (typeof raw.version !== 'number') fail('The bundle is missing its version.')

  if (raw.version > BUNDLE_VERSION) {
    fail('This bundle was made by a newer version of env-manager. Update the app, then try again.')
  }
  if (raw.version !== BUNDLE_VERSION) fail('This bundle version is not supported.')

  if (!isRecord(raw.project)) fail('The bundle is missing its project details.')
  if (typeof raw.project.identity !== 'string' || raw.project.identity.trim() === '') {
    fail('The bundle is missing the project identity.')
  }
  const identity = raw.project.identity.trim()
  const displayName =
    typeof raw.project.displayName === 'string' && raw.project.displayName.trim() !== ''
      ? raw.project.displayName.trim()
      : identity

  if (!isRecord(raw.files) || Object.keys(raw.files).length === 0) {
    fail('The bundle contains no env files.')
  }
  const files: Record<string, CryptoEnvelope> = {}
  for (const [fileName, value] of Object.entries(raw.files)) {
    // Also blocks path traversal: only `.env[.<segment>]` names pass.
    if (!isTrackableEnvFile(fileName)) {
      fail(`The bundle contains an unsupported file name: ${fileName}`)
    }
    files[fileName] = parseEnvelope(fileName, value)
  }

  if (typeof raw.createdAt !== 'string' || raw.createdAt === '') {
    fail('The bundle is missing its creation time.')
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: raw.createdAt,
    project: { identity, displayName },
    files,
  }
}

/**
 * Decrypt every file in memory. Uses the session key when the salt matches;
 * otherwise derives from `opts.passphrase`. Returns all text or throws — no
 * partial apply, no writes.
 */
export async function decryptBundle(
  bundle: Bundle,
  opts: { passphrase?: string } = {},
): Promise<Record<string, string>> {
  const localSalt = currentSalt()
  const out: Record<string, string> = {}
  for (const [fileName, envelope] of Object.entries(bundle.files)) {
    if (isUnlocked() && localSalt !== null && envelope.salt === localSalt) {
      out[fileName] = await decryptFile(bundle.project.identity, fileName, envelope)
      continue
    }
    if (opts.passphrase === undefined || opts.passphrase === '') {
      throw new Error(
        "This bundle was encrypted with another passphrase. Enter this bundle's passphrase to import it.",
      )
    }
    out[fileName] = await decryptFileWithPassphrase(
      opts.passphrase,
      bundle.project.identity,
      fileName,
      envelope,
    )
  }
  return out
}
