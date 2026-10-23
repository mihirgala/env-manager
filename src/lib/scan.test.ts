import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanRow } from './tauri'
import type { ProjectRecord } from './vault'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { DEFAULT_SKIP_DIRS, buildScanCandidates } from './scan'
import { scanEnvProjects } from './tauri'

function row(overrides: Partial<ScanRow> & { folderPath: string }): ScanRow {
  return {
    repoRoot: overrides.folderPath,
    repoSubpath: '',
    gitRemote: null,
    envFiles: ['.env'],
    isGit: true,
    ...overrides,
  }
}

function project(identity: string, id = 'proj-1'): ProjectRecord {
  return {
    id,
    identity,
    displayName: identity,
    folderPath: '/existing',
    createdAt: '2026-10-23T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildScanCandidates', () => {
  it('builds repo-root and monorepo identities from normalized remotes', () => {
    const candidates = buildScanCandidates(
      [
        row({
          folderPath: '/p/repo',
          repoRoot: '/p/repo',
          repoSubpath: '',
          gitRemote: 'git@github.com:Foo/bar.git',
          envFiles: ['.env', '.env.example'],
        }),
        row({
          folderPath: '/p/repo/apps/web',
          repoRoot: '/p/repo',
          repoSubpath: 'apps\\web',
          gitRemote: 'git@github.com:Foo/bar.git',
          envFiles: ['.env.local', '.env.template'],
        }),
      ],
      [],
      { includeNonGit: false },
    )

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      identity: 'github.com/foo/bar',
      displayName: 'bar',
      envFiles: ['.env'],
      subpath: '',
      isGit: true,
    })
    expect(candidates[1]).toMatchObject({
      identity: 'github.com/foo/bar::apps/web',
      displayName: 'bar / apps/web',
      envFiles: ['.env.local'],
      subpath: 'apps/web',
    })
  })

  it('flags vault duplicates and later duplicates in the same scan', () => {
    const remote = 'github.com/foo/bar'
    const candidates = buildScanCandidates(
      [
        row({ folderPath: '/p/a', gitRemote: `git@${remote}.git` }),
        row({ folderPath: '/p/b', gitRemote: `https://${remote}` }),
      ],
      [project(remote)],
      { includeNonGit: false },
    )

    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.duplicateOf).toBe('proj-1')
    expect(candidates[0]?.duplicateInScan).toBeUndefined()
    expect(candidates[1]?.duplicateInScan).toBe(true)
  })

  it('drops non-git folders unless opted in', () => {
    const plain = row({
      folderPath: '/p/plain',
      gitRemote: null,
      isGit: false,
      envFiles: ['.env'],
    })

    expect(buildScanCandidates([plain], [], { includeNonGit: false })).toHaveLength(0)
    const kept = buildScanCandidates([plain], [], { includeNonGit: true })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.isGit).toBe(false)
    expect(kept[0]?.identity).not.toBe('/p/plain')
  })

  it('reuses an existing manual link for the same non-git folder', () => {
    const plain = row({
      folderPath: '/p/plain',
      gitRemote: null,
      isGit: false,
      envFiles: ['.env'],
    })
    const existing = { ...project('manual-1'), folderPath: '/p/plain' }

    const candidates = buildScanCandidates([plain], [existing], { includeNonGit: true })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.identity).toBe('manual-1')
    expect(candidates[0]?.duplicateOf).toBe('proj-1')
  })

  it('keeps a git repo without origin as a manual link', () => {
    const candidates = buildScanCandidates(
      [row({ folderPath: '/p/gitless', gitRemote: null, isGit: true })],
      [],
      { includeNonGit: false },
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.isGit).toBe(true)
    expect(candidates[0]?.identity).not.toBe('/p/gitless')
  })

  it('drops rows with only template files', () => {
    const candidates = buildScanCandidates(
      [row({ folderPath: '/p/tpl', envFiles: ['.env.example', '.env.sample'] })],
      [],
      { includeNonGit: true },
    )
    expect(candidates).toHaveLength(0)
  })

  it('sorts git repos before non-git folders', () => {
    const candidates = buildScanCandidates(
      [
        row({ folderPath: '/p/plain', isGit: false, envFiles: ['.env'] }),
        row({
          folderPath: '/p/repo',
          gitRemote: 'https://github.com/a/b',
          envFiles: ['.env'],
        }),
      ],
      [],
      { includeNonGit: true },
    )
    expect(candidates.map((c) => c.isGit)).toEqual([true, false])
  })
})

describe('scan adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  })

  it('passes root, depth and the skip-list to Rust verbatim', async () => {
    invokeMock.mockResolvedValue([])
    const skipDirs = [...DEFAULT_SKIP_DIRS]

    await scanEnvProjects({ root: '/projects', maxDepth: 3, skipDirs })

    expect(invokeMock).toHaveBeenCalledWith('scan_env_projects', {
      root: '/projects',
      maxDepth: 3,
      skipDirs,
    })
  })
})
