/**
 * Cloud + crypto config plumbing. Shape of `~/.env-manager/config.json`
 * (TS-owned; Rust only reads/writes the file):
 *
 * {
 *   deviceName?: string,
 *   cryptoSalt?: string,          // Argon2id salt from setupPassphrase
 *   recoveryBlob?: RecoveryBlob,  // sealed master key for code recovery
 *   cloudUrl?: string,            // Supabase URL (optional)
 *   cloudKey?: string,            // Supabase anon key (optional)
 *   lastSynced?: Record<string, string>  // "<projectId>:<file>" → sha256
 * }
 */

import { SupabaseCloudClient } from './cloud'
import { isTauri, configRead, configWrite } from './tauri'
import { CloudNotConfiguredError } from './sync'

export interface AppConfig {
  deviceName?: string
  cryptoSalt?: string
  recoveryBlob?: import('./crypto').RecoveryBlob
  cloudUrl?: string
  cloudKey?: string
  lastSynced?: Record<string, string>
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

export function isCloudConfigured(cfg: AppConfig): boolean {
  return (cfg.cloudUrl?.trim() ?? '') !== '' && (cfg.cloudKey?.trim() ?? '') !== ''
}

export function makeCloudClient(cfg: AppConfig): SupabaseCloudClient {
  if (!isCloudConfigured(cfg)) throw new CloudNotConfiguredError()
  return new SupabaseCloudClient((cfg.cloudUrl as string).trim(), (cfg.cloudKey as string).trim())
}

export function lastSyncedKey(projectId: string, fileName: string): string {
  return `${projectId}:${fileName}`
}
