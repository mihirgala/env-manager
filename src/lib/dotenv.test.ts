import { describe, expect, it } from 'vitest'
import basic from './__fixtures__/basic.env?raw'
import comments from './__fixtures__/comments.env?raw'
import exportPrefix from './__fixtures__/export-prefix.env?raw'
import quoted from './__fixtures__/quoted.env?raw'
import { getValue, parse, serialize, setValue } from './dotenv'

const fixtures: Record<string, string> = {
  basic,
  quoted,
  comments,
  'export-prefix': exportPrefix,
}

describe('dotenv round-trip', () => {
  for (const [name, content] of Object.entries(fixtures)) {
    it(`${name}: serialize(parse(fixture)) === fixture`, () => {
      expect(serialize(parse(content))).toBe(content)
    })
  }
})

describe('dotenv values', () => {
  it('reads effective values through quotes', () => {
    const doc = parse(quoted)
    expect(getValue(doc, 'SINGLE')).toBe('hello world')
    expect(getValue(doc, 'DOUBLE')).toBe('hello # not a comment')
  })
  it('setValue preserves quoting and order', () => {
    const doc = parse(basic)
    const next = setValue(doc, 'PORT', '4000')
    expect(serialize(next)).toContain('PORT=4000')
    // Order preserved: PORT still on line 3.
    expect(serialize(next).split('\n')[2]).toBe('PORT=4000')
  })
  it('setValue appends missing keys', () => {
    const next = setValue(parse(basic), 'NEW_KEY', 'example')
    expect(serialize(next)).toContain('NEW_KEY=example')
  })
})
