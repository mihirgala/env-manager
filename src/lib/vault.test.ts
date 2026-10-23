import { describe, expect, it } from 'vitest'
import { Vault, createMemoryDriver } from './vault'

describe('Vault (memory driver)', () => {
  it('adds and lists projects', async () => {
    const vault = new Vault(createMemoryDriver())
    await vault.addProject({
      identity: 'github.com/foo/bar',
      displayName: 'bar',
      folderPath: '/tmp/bar',
    })
    const all = await vault.listProjects()
    expect(all).toHaveLength(1)
    expect(all[0]?.identity).toBe('github.com/foo/bar')
  })

  it('re-adding an identity keeps the original folder instead of re-pointing', async () => {
    const vault = new Vault(createMemoryDriver())
    const a = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/a' })
    const b = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/b' })
    expect(a.id).toBe(b.id)
    expect(await vault.listProjects()).toHaveLength(1)
    // Moving the link silently would point existing snapshots at another repo.
    expect((await vault.getProject(a.id))?.folderPath).toBe('/a')
  })

  it('removes projects without touching anything else', async () => {
    const vault = new Vault(createMemoryDriver())
    const p = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/a' })
    await vault.removeProject(p.id)
    expect(await vault.listProjects()).toHaveLength(0)
    expect(await vault.getProject(p.id)).toBeNull()
  })

  it('rejects empty identity / folder', async () => {
    const vault = new Vault(createMemoryDriver())
    await expect(vault.addProject({ identity: '', displayName: 'x', folderPath: '/a' })).rejects.toThrow()
    await expect(vault.addProject({ identity: 'x', displayName: 'x', folderPath: '' })).rejects.toThrow()
  })
})
