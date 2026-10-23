import { describe, expect, it } from 'vitest'
import {
  detectIdentity,
  normalizeGitRemote,
  normalizeSubpath,
  splitSubpath,
  withSubpath,
} from './identity'

describe('normalizeGitRemote', () => {
  it('normalizes scp-like SSH remotes', () => {
    expect(normalizeGitRemote('git@github.com:Foo/bar.git')).toBe('github.com/foo/bar')
  })
  it('normalizes https remotes', () => {
    expect(normalizeGitRemote('https://github.com/foo/bar')).toBe('github.com/foo/bar')
  })
  it('strips trailing .git and slashes', () => {
    expect(normalizeGitRemote('https://github.com/foo/bar.git/')).toBe('github.com/foo/bar')
  })
  it('handles ssh:// with user and port', () => {
    expect(normalizeGitRemote('ssh://git@github.com:22/Foo/Bar.git')).toBe('github.com/foo/bar')
  })
  it('handles https with credentials', () => {
    expect(normalizeGitRemote('https://user:token@gitlab.com/Org/Repo.git')).toBe(
      'gitlab.com/org/repo',
    )
  })
  it('rejects empty and invalid remotes', () => {
    expect(() => normalizeGitRemote('')).toThrow()
    expect(() => normalizeGitRemote('just-a-name')).toThrow()
  })
})

describe('monorepo subpaths', () => {
  it('normalizes Windows separators and ./ prefixes', () => {
    expect(normalizeSubpath('apps\\web')).toBe('apps/web')
    expect(normalizeSubpath('./apps/web/')).toBe('apps/web')
    expect(normalizeSubpath('apps//web')).toBe('apps/web')
    expect(normalizeSubpath('Apps/Web')).toBe('Apps/Web')
  })

  it('appends and splits :: identities', () => {
    expect(withSubpath('github.com/foo/bar', 'apps/web')).toBe('github.com/foo/bar::apps/web')
    expect(withSubpath('github.com/foo/bar', './apps\\web/')).toBe(
      'github.com/foo/bar::apps/web',
    )
    expect(withSubpath('github.com/foo/bar::old', 'new')).toBe('github.com/foo/bar::new')
    expect(splitSubpath('github.com/foo/bar::apps/web')).toEqual({
      identity: 'github.com/foo/bar',
      subpath: 'apps/web',
    })
    expect(splitSubpath('github.com/foo/bar')).toEqual({
      identity: 'github.com/foo/bar',
      subpath: '',
    })
  })
})

describe('detectIdentity', () => {
  it('returns git identity when a remote is given', () => {
    const id = detectIdentity({
      folderPath: '/projects/demo',
      gitRemoteUrl: 'git@github.com:Foo/bar.git',
    })
    expect(id).toEqual({
      kind: 'git',
      identity: 'github.com/foo/bar',
      remoteUrl: 'git@github.com:Foo/bar.git',
    })
  })
  it('returns a manual UUID without a remote', () => {
    const id = detectIdentity({ folderPath: '/projects/demo' })
    expect(id.kind).toBe('manual')
  })
  it('throws on empty folder path', () => {
    expect(() => detectIdentity({ folderPath: '   ' })).toThrow()
  })
})
