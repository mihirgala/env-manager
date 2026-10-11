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

  it('re-adding an identity updates the folder instead of duplicating', async () => {
    const vault = new Vault(createMemoryDriver())
    const a = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/a' })
    const b = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/b' })
    expect(a.id).toBe(b.id)
    expect((await vault.listProjects())).toHaveLength(1)
    expect((await vault.getProject(a.id))?.folderPath).toBe('/b')
  })

  it('removes projects and their env sets, toggles local-only', async () => {
    const vault = new Vault(createMemoryDriver())
    const p = await vault.addProject({ identity: 'x', displayName: 'x', folderPath: '/a' })
    await vault.recordEnvSet(p.id, '.env', 'abc')
    expect(await vault.listEnvSets(p.id)).toHaveLength(1)
    const toggled = await vault.setLocalOnly(p.id, true)
    expect(toggled?.localOnly).toBe(true)
    await vault.removeProject(p.id)
    expect(await vault.listProjects()).toHaveLength(0)
    expect(await vault.listEnvSets(p.id)).toHaveLength(0)
  })

  it('rejects empty identity / folder', async () => {
    const vault = new Vault(createMemoryDriver())
    await expect(vault.addProject({ identity: '', displayName: 'x', folderPath: '/a' })).rejects.toThrow()
    await expect(vault.addProject({ identity: 'x', displayName: 'x', folderPath: '' })).rejects.toThrow()
  })
})
