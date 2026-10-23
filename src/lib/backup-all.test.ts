import { describe, expect, it } from 'vitest'
import { backupAllProjects, describeBackupResult } from './backup-all'
import type { ProjectRecord } from './vault'

function project(id: string, displayName: string, folderPath: string): ProjectRecord {
  return {
    id,
    identity: `github.com/me/${id}`,
    displayName,
    folderPath,
    createdAt: new Date(0).toISOString(),
  }
}

describe('backupAllProjects', () => {
  it('backs up every trackable file and ignores templates', async () => {
    const calls: { project: string; fileName: string; filePath: string }[] = []
    const rows = new Map<string, string[]>([
      ['C:\\projects\\api', ['.env', '.env.example', '.env.local']],
      ['C:\\projects\\web', ['.env.production']],
      ['C:\\projects\\empty', ['.env.example']],
    ])

    const result = await backupAllProjects({
      listProjects: async () => [
        project('api', 'api', 'C:\\projects\\api'),
        project('web', 'web', 'C:\\projects\\web'),
        project('empty', 'empty', 'C:\\projects\\empty'),
      ],
      listEnvFiles: async (folder) => rows.get(folder) ?? [],
      backup: async ({ project: p, fileName, filePath }) => {
        calls.push({ project: p.id, fileName, filePath })
      },
    })

    expect(result).toEqual({
      backedUp: 3,
      failed: 0,
      skippedProjects: 1,
      failures: [],
    })
    expect(calls.map((c) => c.fileName)).toEqual(['.env', '.env.local', '.env.production'])
    expect(calls.find((c) => c.fileName === '.env')?.filePath).toBe('C:\\projects\\api\\.env')
  })

  it('keeps going when one file fails and reports the failure', async () => {
    const result = await backupAllProjects({
      listProjects: async () => [project('api', 'api', 'C:\\projects\\api')],
      listEnvFiles: async () => ['.env', '.env.local'],
      backup: async ({ fileName }) => {
        if (fileName === '.env') throw new Error('read failed')
      },
    })

    expect(result.backedUp).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([
      { project: 'api', fileName: '.env', message: 'read failed' },
    ])
  })

  it('treats an unreadable folder as skipped instead of failing the run', async () => {
    const result = await backupAllProjects({
      listProjects: async () => [project('gone', 'gone', 'C:\\projects\\gone')],
      listEnvFiles: async () => {
        throw new Error('ENOENT')
      },
      backup: async () => {
        throw new Error('should not run')
      },
    })

    expect(result).toEqual({ backedUp: 0, failed: 0, skippedProjects: 1, failures: [] })
  })

  it('does nothing when no projects are linked', async () => {
    const result = await backupAllProjects({
      listProjects: async () => [],
      listEnvFiles: async () => [],
      backup: async () => {},
    })

    expect(result).toEqual({ backedUp: 0, failed: 0, skippedProjects: 0, failures: [] })
  })
})

describe('describeBackupResult', () => {
  it('summarizes counts with correct plurals', () => {
    expect(
      describeBackupResult({ backedUp: 1, failed: 0, skippedProjects: 0, failures: [] }),
    ).toBe('Backed up 1 file')
    expect(
      describeBackupResult({ backedUp: 4, failed: 2, skippedProjects: 1, failures: [] }),
    ).toBe('Backed up 4 files · 1 project had no env files · 2 failed')
  })
})
