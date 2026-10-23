import { describe, expect, it } from 'vitest'
import { isTrackableEnvFile, trackableEnvFiles } from './env-files'

describe('env-file policy', () => {
  it('accepts real env files, including nested segments', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
      '.env.production',
      '.env.test',
      '.env.staging',
    ]) {
      expect(isTrackableEnvFile(name), name).toBe(true)
    }
  })

  it('rejects templates, backups and non-env files', () => {
    for (const name of [
      '.env.example',
      '.env.example.local',
      '.env.local.example',
      '.env.sample',
      '.env.template',
      '.env.dist',
      '.env.backup-123',
      'config.backup-1',
      '.envrc',
      '.env.local/bad',
      '.env/../evil',
      'env',
      '',
    ]) {
      expect(isTrackableEnvFile(name), name).toBe(false)
    }
  })

  it('matches case-insensitively but returns original names', () => {
    expect(isTrackableEnvFile('.ENV.Development')).toBe(true)
    expect(trackableEnvFiles(['.ENV', '.env.example', '.env.local'])).toEqual([
      '.ENV',
      '.env.local',
    ])
  })
})
