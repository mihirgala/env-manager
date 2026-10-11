/**
 * Cloud + crypto config plumbing. Shape of `~/.env-manager/config.json`
 * (TS-owned; Rust only reads/writes the file):
 *
 * {
 *   deviceName?: string,
 *   cryptoSalt?: string,          // Argon2id salt from setupPassphrase
 *   recoveryBlob?: RecoveryBlob,  // sealed master key for code recovery
 *   cloudUrl?: string,            // Self-host override (optional)
 *   cloudKey?: string,            // Self-host anon key (optional)
 *   lastSynced?: Record<string, string>  // "<projectId>:<file>" → sha256
 * }
 *
 * Hosted backend: the maintainer bakes `VITE_SUPABASE_URL` /
 * `VITE_SUPABASE_ANON_KEY` in at build time so users get cloud sync with
 * zero setup (just email OTP sign-in). The anon key is public by design —
 * isolation comes from owner-only RLS, and the server still sees ciphertext
 * only. A custom `cloudUrl`+`cloudKey` in config always wins (self-host).
 */

import { SupabaseCloudClient } from './cloud'
import { isTauri, configRead, configWrite, getDeviceName } from './tauri'
import { CloudNotConfiguredError } from './sync'

export interface KnownDevice {
  name: string
  lastSeen: string
}

export interface AppConfig {
  deviceName?: string
  cryptoSalt?: string
  recoveryBlob?: import('./crypto').RecoveryBlob
  /** Self-host override — when both are set, the hosted backend is ignored. */
  cloudUrl?: string
  cloudKey?: string
  lastSynced?: Record<string, string>
  /** Local registry of devices seen pushing (P3 display; cloud truth is snapshots). */
  devices?: KnownDevice[]
  seenOnboarding?: boolean
}

export interface CloudEndpoint {
  url: string
  key: string
  source: 'custom' | 'hosted'
}

/** Maintainer-baked managed backend, or null when built without one. */
export function hostedCloudEndpoint(): CloudEndpoint | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''
  if (url === '' || key === '') return null
  return { url, key, source: 'hosted' }
}

/** Effective endpoint: self-host override wins, hosted backend is the fallback. */
export function effectiveCloudEndpoint(cfg: AppConfig): CloudEndpoint | null {
  const url = cfg.cloudUrl?.trim() ?? ''
  const key = cfg.cloudKey?.trim() ?? ''
  if (url !== '' && key !== '') return { url, key, source: 'custom' }
  return hostedCloudEndpoint()
}

/** Where the effective endpoint comes from, or null when cloud is unavailable. */
export function cloudSource(cfg: AppConfig): CloudEndpoint['source'] | null {
  return effectiveCloudEndpoint(cfg)?.source ?? null
}

export async function loadConfig(): Promise<AppConfig> {
  if (!isTauri()) return {}
  const raw = await configRead().catch((): Record<string, unknown> => ({}))
  return raw as AppConfig
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig()
  const next: AppConfig = { ...current, ...patch }
  await configWrite(next as Record<string, unknown>)
  return next
}

/** Clear a self-host override and fall back to the hosted backend (if any). */
export async function clearCustomCloud(): Promise<AppConfig> {
  const current = await loadConfig()
  const next: AppConfig = { ...current }
  delete next.cloudUrl
  delete next.cloudKey
  await configWrite(next as Record<string, unknown>)
  return next
}

/**
 * Device label for snapshot metadata. A name the user set wins; otherwise
 * the OS hostname is adopted and saved so every device identifies itself
 * without manual setup. Never throws — falls back to a placeholder.
 */
export async function ensureDeviceName(): Promise<string> {
  try {
    const cfg = await loadConfig()
    const existing = cfg.deviceName?.trim() ?? ''
    if (existing !== '') return existing
    if (!isTauri()) return 'unknown-device'
    const osName = (await getDeviceName()).trim()
    if (osName === '' || osName === 'unknown-device') return 'unknown-device'
    await saveConfig({ deviceName: osName }).catch(() => {})
    return osName
  } catch {
    return 'unknown-device'
  }
}

export function isCloudConfigured(cfg: AppConfig): boolean {
  return effectiveCloudEndpoint(cfg) !== null
}

export function makeCloudClient(cfg: AppConfig): SupabaseCloudClient {
  const endpoint = effectiveCloudEndpoint(cfg)
  if (endpoint === null) throw new CloudNotConfiguredError()
  return new SupabaseCloudClient(endpoint.url, endpoint.key)
}

export function lastSyncedKey(projectId: string, fileName: string): string {
  return `${projectId}:${fileName}`
}
