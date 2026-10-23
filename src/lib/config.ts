/**
 * Local config plumbing. Shape of `~/.env-manager/config.json`
 * (TS-owned; Rust only reads/writes the file):
 *
 * {
 *   deviceName?: string,          // label written into vault-file metadata
 *   theme?: 'system' | 'light' | 'dark',
 *   cryptoSalt?: string,          // Argon2id salt from setupPassphrase
 *   recoveryBlob?: RecoveryBlob,  // sealed master key for code recovery
 *   seenOnboarding?: boolean
 * }
 *
 * Everything stays on this device. There is no hosted backend and no
 * account: sync happens through one encrypted vault file the user moves by hand.
 */

import type { RecoveryBlob } from './crypto'
import type { ThemePreference } from './theme'
import { isTauri, configRead, configWrite, getDeviceName } from './tauri'

export interface AppConfig {
  deviceName?: string
  theme?: ThemePreference
  cryptoSalt?: string
  recoveryBlob?: RecoveryBlob
  seenOnboarding?: boolean
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

/**
 * Device label for vault-file metadata. A name the user set wins; otherwise
 * the OS hostname is adopted and saved so exports identify their origin
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
