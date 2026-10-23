import { describe, expect, it } from 'vitest'
import { folderKey, joinPath } from './paths'

describe('paths', () => {
  it('joins with the folder separator and drops trailing separators', () => {
    expect(joinPath('/home/me/project', '.env')).toBe('/home/me/project/.env')
    expect(joinPath('/home/me/project/', '.env.local')).toBe('/home/me/project/.env.local')
    expect(joinPath('C:\\Users\\me\\project', '.env')).toBe('C:\\Users\\me\\project\\.env')
    expect(joinPath('C:\\Users\\me\\project\\', '.env')).toBe('C:\\Users\\me\\project\\.env')
  })

  it('normalizes folder comparison keys', () => {
    expect(folderKey('C:\\Users\\me\\project\\')).toBe('C:/Users/me/project')
    expect(folderKey('/home/me/project/')).toBe('/home/me/project')
  })
})
